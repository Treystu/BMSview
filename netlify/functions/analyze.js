const { errorResponse } = require('./utils/errors');
const { parseJsonBody, validateAnalyzeRequest, validateImagePayload } = require('./utils/validation');
const { createLogger, createTimer } = require('./utils/logger');
const { performAnalysisPipeline } = require('./utils/analysis-pipeline');
const { sha256HexFromBase64 } = require('./utils/hash');
const { getCollection } = require('./utils/mongodb');
const { withTimeout, retryAsync, circuitBreaker } = require('./utils/retry');

// NOTE: Database access for analysis is handled inside performAnalysisPipeline via utils/mongodb

exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // Content-Type will be set per-mode (SSE vs JSON)
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers
    };
  }

  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Method not allowed', undefined, headers);
  }

  // Logger and request-scoped context
  const log = createLogger('analyze', context);
  log.entry({ method: event.httpMethod, path: event.path, query: event.queryStringParameters });
  const isSync = (event.queryStringParameters && event.queryStringParameters.sync === 'true');
  const headersIn = event.headers || {};
  const idemKey = headersIn['Idempotency-Key'] || headersIn['idempotency-key'] || headersIn['IDEMPOTENCY-KEY'];
  let requestContext = { jobId: undefined };

  try {
    // Safe parse & validate
    const parsed = parseJsonBody(event);
    if (!parsed.ok) {
      log.warn('Invalid JSON body for analyze request.', { error: parsed.error });
      return errorResponse(400, 'invalid_request', parsed.error, undefined, headers);
    }
    if (isSync) {
      // Synchronous analyze path: expects { image: { image, mimeType, fileName, force? } }
      const timer = createTimer(log, 'sync-analysis');
      const imagePayload = parsed.value && parsed.value.image;
      const imageValidation = validateImagePayload(imagePayload);
      if (!imageValidation.ok) {
        log.warn('Sync analyze image validation failed.', { reason: imageValidation.error });
        return errorResponse(400, 'invalid_image', imageValidation.error, undefined, { ...headers, 'Content-Type': 'application/json' });
      }

      // Compute content hash for dedupe
      const contentHash = sha256HexFromBase64(imagePayload.image);

      // Idempotency short-circuit
      if (idemKey) {
        const idemCol = await getCollection('idempotent-requests');
        const existingIdem = await idemCol.findOne({ key: idemKey });
        if (existingIdem && existingIdem.response) {
          log.info('Idempotency hit: returning stored response.', { idemKey });
          const durationMs = timer.end({ idempotent: true });
          log.exit(200, { mode: 'sync', idempotent: true, durationMs });
          return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(existingIdem.response)
          };
        }
      }

      // Dedupe by content hash
      const resultsCol = await getCollection('analysis-results');
      const existing = await resultsCol.findOne({ contentHash });
      if (existing) {
        log.info('Dedupe: existing analysis found for content hash.', { contentHash });
        const responseBody = { analysis: existing.analysis, recordId: existing._id?.toString?.() || existing.id, fileName: existing.fileName, timestamp: existing.timestamp, dedupeHit: true };
        if (idemKey) {
          try {
            const idemCol = await getCollection('idempotent-requests');
            await idemCol.updateOne({ key: idemKey }, { $set: { key: idemKey, response: responseBody, createdAt: new Date() } }, { upsert: true });
          } catch (_) {}
        }
        const durationMs = timer.end({ recordId: responseBody.recordId, dedupe: true });
        log.exit(200, { mode: 'sync', dedupe: true, durationMs });
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(responseBody)
        };
      }

      log.info('Starting synchronous analysis via pipeline.', { fileName: imagePayload.fileName, mimeType: imagePayload.mimeType });
      const record = await circuitBreaker('syncAnalysis', () =>
        retryAsync(() => withTimeout(
          performAnalysisPipeline(
            { image: imagePayload.image, mimeType: imagePayload.mimeType, fileName: imagePayload.fileName, force: !!imagePayload.force },
            null,
            log,
            context
          ),
          parseInt(process.env.ANALYSIS_TIMEOUT_MS || '60000'),
          () => log.warn('performAnalysisPipeline timed out')
        ), {
          retries: parseInt(process.env.ANALYSIS_RETRIES || '2'),
          baseDelayMs: parseInt(process.env.ANALYSIS_RETRY_BASE_MS || '250'),
          jitterMs: parseInt(process.env.ANALYSIS_RETRY_JITTER_MS || '200'),
          shouldRetry: (e) => e && e.code !== 'operation_timeout' && e.code !== 'circuit_open'
        })
      , {
        failureThreshold: parseInt(process.env.CB_FAILURES || '5'),
        openMs: parseInt(process.env.CB_OPEN_MS || '30000')
      });

      // Persist new result with contentHash for future dedupe
      try {
        await resultsCol.insertOne({
          id: record.id,
          fileName: record.fileName,
          timestamp: record.timestamp,
          analysis: record.analysis,
          contentHash,
          createdAt: new Date()
        });
      } catch (e) {
        log.warn('Failed to persist analysis-results record.', { error: e && e.message ? e.message : String(e) });
      }

      const responseBody = { analysis: record.analysis, recordId: record.id, fileName: record.fileName, timestamp: record.timestamp };
      if (idemKey) {
        try {
          const idemCol = await getCollection('idempotent-requests');
          await idemCol.updateOne({ key: idemKey }, { $set: { key: idemKey, response: responseBody, createdAt: new Date(), contentHash } }, { upsert: true });
        } catch (_) {}
      }

      const durationMs = timer.end({ recordId: record.id });
      log.exit(200, { mode: 'sync', recordId: record.id, durationMs });
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(responseBody)
      };
    }

    // Legacy async/job-based path validation
    const validated = validateAnalyzeRequest(parsed.value);
    if (!validated.ok) {
      log.warn('Legacy analyze request missing parameters.', { details: validated.details });
      return errorResponse(400, 'missing_parameters', validated.error, validated.details, { ...headers, 'Content-Type': 'application/json' });
    }

    const { jobId, fileData, userId } = validated.value;
    requestContext.jobId = jobId;

    // Simulated legacy flow: log and return accepted
    log.info('Legacy analyze request received.', { jobId, userId, fileBytes: fileData ? fileData.length : 0 });
    log.exit(202, { mode: 'legacy' });
    return {
      statusCode: 202,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, jobId, message: 'Legacy analysis accepted for processing' })
    };

  } catch (error) {
    log.error('Analyze function failed.', { error: error && error.message ? error.message : String(error) });
    
    // Send error event
    // Best-effort legacy progress event logging (ignore failures)
    try {
      if (requestContext.jobId) {
        await storeProgressEvent(requestContext.jobId, {
          stage: 'error',
          progress: 0,
          message: `Analysis failed: ${error.message}`
        });
      }
    } catch (_) {}

    return errorResponse(500, 'analysis_failed', 'Analysis failed', { message: error.message }, { ...headers, 'Content-Type': 'application/json' });
  } finally {
    // DB connections are managed by utils/mongodb; nothing to close here
  }
};

async function validateAndParseFile(fileData) {
  // Simulate file validation and parsing
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  if (!fileData || fileData.length === 0) {
    throw new Error('Empty file data');
  }
  
  // Mock parsing logic
  return {
    format: 'csv',
    rows: fileData.split('\n').length,
    columns: fileData.split('\n')[0]?.split(',').length || 0,
    data: fileData
  };
}

async function extractBatteryMetrics(parsedData) {
  // Simulate metrics extraction
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return {
    totalCycles: Math.floor(Math.random() * 1000) + 100,
    avgCapacity: Math.floor(Math.random() * 50) + 50,
    maxTemperature: Math.floor(Math.random() * 20) + 25,
    efficiency: Math.random() * 0.3 + 0.7,
    healthScore: Math.floor(Math.random() * 30) + 70
  };
}

async function performAnalysis(metrics) {
  // Simulate comprehensive analysis
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return {
    degradationTrend: metrics.efficiency > 0.85 ? 'stable' : 'declining',
    riskFactors: metrics.avgCapacity < 60 ? ['low capacity'] : [],
    performanceIssues: metrics.maxTemperature > 40 ? ['high temperature'] : [],
    maintenanceNeeds: metrics.healthScore < 80 ? ['service recommended'] : []
  };
}

async function generateInsights(analysis) {
  // Simulate insights generation
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return {
    summary: `Battery health is ${analysis.degradationTrend} with ${analysis.riskFactors.length} risk factors identified.`,
    recommendations: [
      analysis.degradationTrend === 'declining' ? 'Monitor capacity closely' : 'Continue normal operation',
      analysis.riskFactors.includes('low capacity') ? 'Consider capacity calibration' : '',
      analysis.performanceIssues.includes('high temperature') ? 'Improve cooling system' : ''
    ].filter(Boolean),
    nextMaintenance: analysis.maintenanceNeeds.length > 0 ? 'Schedule service within 30 days' : 'No immediate maintenance required'
  };
}

// Legacy helpers retained for backward compatibility in error paths
async function storeProgressEvent(jobId, eventData) {
  try {
    const { getCollection } = require('./utils/mongodb');
    const collection = await getCollection('progress-events');
    await collection.insertOne({ jobId, ...eventData, timestamp: new Date() });
  } catch (error) {
    // Intentionally swallow errors to avoid masking primary failure
  }
}