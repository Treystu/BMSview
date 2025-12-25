// @ts-nocheck
/**
 * Full Context Builder
 * Aggregates ALL available data points and tool outputs for comprehensive AI analysis
 */

const { createLogger } = require('./logger.cjs');
const { getCollection } = require('./mongodb.cjs');

// Configuration constants for feedback context
const FEEDBACK_RETENTION_DAYS = 90; // Days of feedback history to include
const FEEDBACK_DESCRIPTION_TRUNCATE_LENGTH = 200; // Max chars for description in context
const FEEDBACK_QUERY_LIMIT = 50; // Maximum feedback items to fetch

/**
 * Build complete context with all available data points
 * @param {string} systemId - BMS system ID
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Complete context package
 */
async function buildCompleteContext(systemId, options = {}) {
  const log = createLogger('full-context-builder');
  const startTime = Date.now();

  try {
    log.info('Building complete context', { systemId, options });

    // Get all raw data
    const raw = await getRawData(systemId, options);

    // IMPORTANT: Full-context mode requires at least one actual analysis record.
    // countDataPoints(raw) can be 0 even when records exist (e.g., fields missing),
    // so we gate on raw.totalDataPoints / raw.allAnalyses length instead.
    const recordCount = raw?.totalDataPoints || (Array.isArray(raw?.allAnalyses) ? raw.allAnalyses.length : 0);
    if (!raw || recordCount === 0) {
      throw new Error(`No historical data available for system ${systemId}. Ensure uploads exist and retry.`);
    }

    // Run analytical tools
    const toolOutputs = await runAnalyticalTools(systemId, raw, options);

    // Get external data sources
    const external = await getExternalData(systemId, raw, options);

    // Get system metadata
    const metadata = await getSystemMetadata(systemId, options);

    // Calculate computed metrics
    const computed = await calculateComputedMetrics(systemId, raw, options);

    // Get existing feedback to prevent duplicates
    const existingFeedback = await getExistingFeedback(systemId, options);

    const context = {
      raw,
      toolOutputs,
      external,
      metadata,
      computed,
      existingFeedback, // Include existing feedback for deduplication
      buildTimestamp: new Date().toISOString(),
      buildDurationMs: Date.now() - startTime,
      systemId
    };

    log.info('Complete context built successfully', {
      systemId,
      rawDataPoints: countDataPoints(raw),
      existingFeedbackCount: existingFeedback.length,
      totalSize: JSON.stringify(context).length,
      durationMs: Date.now() - startTime
    });

    return context;
  } catch (error) {
    log.error('Failed to build complete context', { systemId, error: error.message });
    throw error;
  }
}

/**
 * Get existing feedback items to prevent duplicates
 * @param {string} systemId - BMS system ID
 * @param {Object} options - Configuration options
 * @returns {Promise<Array>} List of existing feedback items
 */
async function getExistingFeedback(systemId, options = {}) {
  const log = createLogger('full-context-builder:existing-feedback');

  try {
    const feedbackCollection = await getCollection('ai_feedback');

    // Get recent feedback that hasn't been rejected
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() - FEEDBACK_RETENTION_DAYS);

    const existingFeedback = await feedbackCollection.find({
      $or: [
        { systemId }, // System-specific feedback
        { systemId: { $exists: false } } // Global feedback
      ],
      timestamp: { $gte: retentionDate },
      status: { $nin: ['rejected', 'implemented'] } // Only pending/approved items
    }).sort({ timestamp: -1 }).limit(FEEDBACK_QUERY_LIMIT).toArray();

    // Return summarized feedback for context (reduce token usage)
    return existingFeedback.map(fb => {
      const description = fb.suggestion?.description;
      const truncatedDescription = description
        ? (description.length > FEEDBACK_DESCRIPTION_TRUNCATE_LENGTH
          ? description.substring(0, FEEDBACK_DESCRIPTION_TRUNCATE_LENGTH) + '...'
          : description)
        : null;

      return {
        id: fb.id,
        type: fb.feedbackType,
        category: fb.category,
        priority: fb.priority,
        status: fb.status,
        title: fb.suggestion?.title,
        description: truncatedDescription,
        timestamp: fb.timestamp
      };
    });
  } catch (error) {
    log.warn('Failed to fetch existing feedback, continuing without', { error: error.message });
    return []; // Non-fatal - continue without existing feedback
  }
}

/**
 * Get all raw data for the system
 */
async function getRawData(systemId, options) {
  const log = createLogger('full-context-builder:raw-data');
  const timeRange = await computeTimeRange(systemId, options);

  try {
    const analysisCollection = await getCollection('analysis-results');
    const startIso = timeRange.start;
    const endIso = timeRange.end;
    const startDate = new Date(timeRange.start);
    const endDate = new Date(timeRange.end);

    log.info('Raw data query starting', {
      systemId,
      range: timeRange,
      startIso,
      endIso,
      startDateValid: !Number.isNaN(startDate.getTime()),
      endDateValid: !Number.isNaN(endDate.getTime())
    });

    // Guard against invalid ISO strings (prevents silent empty queries)
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      log.warn('Computed time range produced invalid Date objects; falling back to loose query', {
        systemId,
        startIso,
        endIso
      });
    }

    // Query both top-level systemId (new schema) and nested analysis.systemId (legacy)
    // This ensures compatibility during migration period
    const allAnalyses = await analysisCollection.find({
      $or: [
        // String timestamps (ISO)
        { systemId, timestamp: { $gte: startIso, $lte: endIso } },
        { 'analysis.systemId': systemId, timestamp: { $gte: startIso, $lte: endIso } },
        // Date objects (legacy/variant schemas)
        { systemId, timestamp: { $gte: startDate, $lte: endDate } },
        { 'analysis.systemId': systemId, timestamp: { $gte: startDate, $lte: endDate } }
      ]
    }).sort({ timestamp: 1 }).toArray();

    log.debug('Mixed-type bounded query results', {
      systemId,
      matched: allAnalyses.length
    });

    // Fallback: some legacy records store timestamps as Dates while others are strings.
    // If the mixed-type query above returns too few records, run a normalization pass
    // without timestamp typing constraints and filter manually.
    let normalizedFallback = [];
    if (allAnalyses.length < 4) {
      const looseMatches = await analysisCollection.find({
        $or: [
          { systemId },
          { 'analysis.systemId': systemId }
        ]
      }).sort({ timestamp: 1 }).toArray();

      const rangeStartMs = startDate.getTime();
      const rangeEndMs = endDate.getTime();

      let invalidTimestampCount = 0;
      normalizedFallback = looseMatches.filter((item) => {
        const ts = item.timestamp instanceof Date ? item.timestamp.getTime() : new Date(item.timestamp).getTime();
        if (Number.isNaN(ts)) {
          invalidTimestampCount++;
          return false;
        }
        return ts >= rangeStartMs && ts <= rangeEndMs;
      });

      if (invalidTimestampCount > 0) {
        log.warn('Some records had unparseable timestamps during fallback filter', {
          systemId,
          invalidTimestampCount,
          examples: looseMatches
            .filter((item) => !(item.timestamp instanceof Date) && Number.isNaN(new Date(item.timestamp).getTime()))
            .slice(0, 3)
            .map((item) => String(item.timestamp))
        });
      }

      log.debug('Applied mixed timestamp fallback filter', {
        systemId,
        looseMatchCount: looseMatches.length,
        fallbackCount: normalizedFallback.length
      });
    }

    // Deduplicate in case records match multiple OR branches OR came from recentHistory
    const uniqueAnalyses = [];
    const seen = new Set();

    // Merge DB results with passed recent history (client-side override)
    const recentHistory = (options.recentHistory && Array.isArray(options.recentHistory))
      ? options.recentHistory
      : [];

    if (recentHistory.length > 0) {
      log.info('Merging client-provided recent history', { count: recentHistory.length });
    }

    // Process recent (client) history FIRST to ensure it takes precedence or is included
    // We reverse merge order: recent first, then DB (if not seen). 
    // Actually, usually we want to just union them. 
    // Timestamps are key.

    const combinedSource = [...recentHistory, ...allAnalyses, ...normalizedFallback];

    // Sort by timestamp to ensure chronological order is respected during seen-check if needed,
    // but for deduplication we usually just want unique keys.
    // Let's sort after unique.

    for (const item of combinedSource) {
      // Create a robust unique key
      const id = item.id || item._id;
      const ts = item.timestamp instanceof Date ? item.timestamp.toISOString() : item.timestamp;
      const sysId = item.systemId || item.analysis?.systemId || 'unknown';

      // Use ID if available for strongest dedup, fallback to composite key
      const key = id ? String(id) : `${sysId}|${ts}`;

      if (!seen.has(key)) {
        seen.add(key);
        uniqueAnalyses.push(item);
      }
    }

    // Re-sort chronologically after merging
    uniqueAnalyses.sort((a, b) => {
      const tA = new Date(a.timestamp).getTime();
      const tB = new Date(b.timestamp).getTime();
      return tA - tB;
    });

    log.debug('Raw data query completed', {
      systemId,
      timeRange,
      dbCount: allAnalyses.length,
      recentHistoryCount: recentHistory.length,
      finalRecordCount: uniqueAnalyses.length,
      queryPattern: 'merged DB + recentHistory'
    });

    // Extract specific data arrays
    const allCellData = uniqueAnalyses.map(a => ({
      timestamp: a.timestamp,
      cellVoltages: a.analysis?.cellVoltages || [],
      highestCell: a.analysis?.highestCellVoltage,
      lowestCell: a.analysis?.lowestCellVoltage,
      difference: a.analysis?.cellVoltageDifference
    }));

    const allTemperatureReadings = uniqueAnalyses.map(a => ({
      timestamp: a.timestamp,
      temperature: a.analysis?.temperature,
      temperatures: a.analysis?.temperatures,
      mosTemperature: a.analysis?.mosTemperature
    }));

    const allVoltageReadings = uniqueAnalyses.map(a => ({
      timestamp: a.timestamp,
      voltage: a.analysis?.overallVoltage
    }));

    const allCurrentReadings = uniqueAnalyses.map(a => ({
      timestamp: a.timestamp,
      current: a.analysis?.current,
      power: a.analysis?.power
    }));

    const allAlarms = uniqueAnalyses.flatMap(a =>
      (a.analysis?.alerts || []).map(alert => ({
        timestamp: a.timestamp,
        alert
      }))
    );

    const allStateChanges = detectStateChanges(uniqueAnalyses);

    return {
      allAnalyses: uniqueAnalyses,
      allCellData,
      allTemperatureReadings,
      allVoltageReadings,
      allCurrentReadings,
      allAlarms,
      allStateChanges,
      timeRange,
      totalDataPoints: uniqueAnalyses.length
    };
  } catch (error) {
    log.error('Failed to get raw data', { systemId, error: error.message });
    return {
      allAnalyses: [],
      allCellData: [],
      allTemperatureReadings: [],
      allVoltageReadings: [],
      allCurrentReadings: [],
      allAlarms: [],
      allStateChanges: [],
      timeRange,
      totalDataPoints: 0,
      error: error.message
    };
  }
}

/**
 * Run all analytical tools
 * CRITICAL FIX: Add defensive checks for rawData properties
 */
async function runAnalyticalTools(systemId, rawData, options) {
  const log = createLogger('full-context-builder:tools');

  try {
    // Import statistical tools
    const stats = require('./statistical-tools.cjs');

    // CRITICAL FIX: Ensure arrays exist before accessing
    const allVoltageReadings = Array.isArray(rawData.allVoltageReadings) ? rawData.allVoltageReadings : [];
    const allCurrentReadings = Array.isArray(rawData.allCurrentReadings) ? rawData.allCurrentReadings : [];
    const allAnalyses = Array.isArray(rawData.allAnalyses) ? rawData.allAnalyses : [];

    // Extract time series data with defensive filtering
    const voltageTimeSeries = allVoltageReadings
      .filter(r => r && r.voltage != null)
      .map(r => ({ timestamp: r.timestamp, value: r.voltage }));

    const currentTimeSeries = allCurrentReadings
      .filter(r => r && r.current != null)
      .map(r => ({ timestamp: r.timestamp, value: r.current }));

    const socTimeSeries = allAnalyses
      .filter(a => a && a.analysis && a.analysis.stateOfCharge != null)
      .map(a => ({ timestamp: a.timestamp, value: a.analysis.stateOfCharge }));

    // Run tools in parallel
    const [
      statisticalAnalysis,
      trendAnalysis,
      anomalyDetection,
      correlationAnalysis
    ] = await Promise.allSettled([
      stats.runStatisticalAnalysis(voltageTimeSeries.map(t => t.value)),
      stats.runTrendAnalysis(socTimeSeries),
      stats.runAnomalyDetection(voltageTimeSeries.map(t => t.value)),
      stats.runCorrelationAnalysis({
        voltage: voltageTimeSeries.map(t => t.value),
        current: currentTimeSeries.map(t => t.value),
        soc: socTimeSeries.map(t => t.value)
      })
    ]);

    return {
      statisticalAnalysis: statisticalAnalysis.status === 'fulfilled' ? statisticalAnalysis.value : null,
      trendAnalysis: trendAnalysis.status === 'fulfilled' ? trendAnalysis.value : null,
      anomalyDetection: anomalyDetection.status === 'fulfilled' ? anomalyDetection.value : null,
      correlationAnalysis: correlationAnalysis.status === 'fulfilled' ? correlationAnalysis.value : null,
      errors: [
        statisticalAnalysis.status === 'rejected' ? statisticalAnalysis.reason : null,
        trendAnalysis.status === 'rejected' ? trendAnalysis.reason : null,
        anomalyDetection.status === 'rejected' ? anomalyDetection.reason : null,
        correlationAnalysis.status === 'rejected' ? correlationAnalysis.reason : null
      ].filter(Boolean)
    };
  } catch (error) {
    log.error('Failed to run analytical tools', { systemId, error: error.message });
    return { error: error.message };
  }
}

/**
 * Get external data sources
 * CRITICAL FIX: Add defensive checks for rawData.allAnalyses
 */
async function getExternalData(systemId, rawData, options) {
  const log = createLogger('full-context-builder:external');

  try {
    // CRITICAL FIX: Ensure allAnalyses array exists
    const allAnalyses = Array.isArray(rawData.allAnalyses) ? rawData.allAnalyses : [];

    // Get weather history from analysis records
    const weatherHistory = allAnalyses
      .filter(a => a && a.weather)
      .map(a => ({
        timestamp: a.timestamp,
        ...a.weather
      }));

    // Solar production data (if available)
    const solarProduction = allAnalyses
      .filter(a => a && a.analysis && a.analysis.predictedSolarChargeAmphours != null)
      .map(a => ({
        timestamp: a.timestamp,
        predicted: a.analysis.predictedSolarChargeAmphours,
        actual: a.analysis.remainingCapacity
      }));

    return {
      weatherHistory,
      solarProduction,
      gridPricing: null, // Future enhancement
      maintenanceRecords: null // Future enhancement
    };
  } catch (error) {
    log.error('Failed to get external data', { systemId, error: error.message });
    return {
      weatherHistory: [],
      solarProduction: [],
      error: error.message
    };
  }
}

/**
 * Get system metadata
 */
async function getSystemMetadata(systemId, options) {
  const log = createLogger('full-context-builder:metadata');

  try {
    const systemsCollection = await getCollection('systems');
    const systemConfig = await systemsCollection.findOne({ id: systemId });

    if (!systemConfig) {
      log.warn('System not found', { systemId });
      return { error: 'System not found' };
    }

    return {
      systemConfig: {
        name: systemConfig.name,
        chemistry: systemConfig.chemistry,
        voltage: systemConfig.voltage,
        capacity: systemConfig.capacity,
        location: {
          latitude: systemConfig.latitude,
          longitude: systemConfig.longitude
        }
      },
      batterySpecs: {
        nominalVoltage: systemConfig.voltage,
        capacityAh: systemConfig.capacity,
        chemistry: systemConfig.chemistry
      },
      installationDate: null, // Future enhancement
      warrantyInfo: null, // Future enhancement
      operationalHours: null // Future enhancement
    };
  } catch (error) {
    log.error('Failed to get system metadata', { systemId, error: error.message });
    return { error: error.message };
  }
}

/**
 * Calculate computed metrics
 */
async function calculateComputedMetrics(systemId, rawData, options) {
  const log = createLogger('full-context-builder:computed');

  try {
    // CRITICAL FIX: Ensure allAnalyses array exists and has items
    const allAnalyses = Array.isArray(rawData.allAnalyses) ? rawData.allAnalyses : [];
    const latestAnalysis = allAnalyses.length > 0 ? allAnalyses[allAnalyses.length - 1] : null;

    if (!latestAnalysis || !latestAnalysis.analysis) {
      return {
        healthScore: null,
        remainingLifeExpectancy: null,
        performanceDegradation: null,
        efficiencyMetrics: null,
        costAnalysis: null
      };
    }

    // Calculate basic health score (0-100)
    const healthScore = calculateHealthScore(latestAnalysis.analysis);

    // Estimate remaining life based on cycle count
    const remainingLifeExpectancy = estimateRemainingLife(latestAnalysis.analysis);

    // Calculate degradation rate from historical data
    const performanceDegradation = calculateDegradationRate(allAnalyses);

    return {
      healthScore,
      remainingLifeExpectancy,
      performanceDegradation,
      efficiencyMetrics: null, // Future enhancement
      costAnalysis: null // Future enhancement
    };
  } catch (error) {
    log.error('Failed to calculate computed metrics', { systemId, error: error.message });
    return { error: error.message };
  }
}

/**
 * Helper functions
 */

// Health score thresholds
const HEALTH_SCORE_THRESHOLDS = {
  CELL_VOLTAGE_DIFF_MAX: 0.1,          // Maximum acceptable cell voltage difference (V)
  CELL_VOLTAGE_DIFF_PENALTY: 10,       // Points deducted for high cell voltage difference
  ALERT_PENALTY_PER_ITEM: 5,           // Points deducted per alert
  SOC_LOW_THRESHOLD: 20,               // SOC percentage considered low
  SOC_LOW_PENALTY: 15,                 // Points deducted for low SOC
  TEMP_HIGH_THRESHOLD: 45,             // Temperature (°C) considered high
  TEMP_HIGH_PENALTY: 10                // Points deducted for high temp
};

async function computeTimeRange(systemId, options) {
  // Optimization: Skip expensive DB scan for "actual" range.
  // Just use the target window ending now.
  const targetDays = options.contextWindowDays || 90;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - targetDays);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    days: targetDays
  };
}

async function getActualDateRange(systemId, log) {
  const collection = await getCollection('analysis-results');
  const pipeline = [
    { $match: { $or: [{ systemId }, { 'analysis.systemId': systemId }] } },
    { $group: { _id: null, minDate: { $min: '$timestamp' }, maxDate: { $max: '$timestamp' } } }
  ];

  const [result] = await collection.aggregate(pipeline).toArray();

  const normalizeMaybeDate = (value) => {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const aggMin = normalizeMaybeDate(result?.minDate);
  const aggMax = normalizeMaybeDate(result?.maxDate);

  // Mongo $min/$max can behave unexpectedly if timestamps are mixed string/Date.
  // If aggregation outputs are invalid, fall back to manual scan.
  if (aggMin && aggMax) {
    return { minDate: aggMin, maxDate: aggMax };
  }

  if (result?.minDate || result?.maxDate) {
    log.warn('Aggregation date range invalid (mixed timestamp types?) - falling back to manual scan', {
      systemId,
      minDateRaw: String(result?.minDate),
      maxDateRaw: String(result?.maxDate)
    });
  }

  try {
    const docs = await collection.find({ $or: [{ systemId }, { 'analysis.systemId': systemId }] }, { projection: { timestamp: 1 } }).toArray();
    let minMs = Infinity;
    let maxMs = -Infinity;
    let invalidCount = 0;
    for (const doc of docs) {
      const ts = doc.timestamp instanceof Date ? doc.timestamp.getTime() : new Date(doc.timestamp).getTime();
      if (Number.isNaN(ts)) {
        invalidCount++;
        continue;
      }
      if (ts < minMs) minMs = ts;
      if (ts > maxMs) maxMs = ts;
    }

    if (Number.isFinite(minMs) && Number.isFinite(maxMs)) {
      if (invalidCount > 0) {
        log.warn('Manual scan skipped invalid timestamps', { systemId, invalidCount, total: docs.length });
      }
      return { minDate: new Date(minMs), maxDate: new Date(maxMs) };
    }
  } catch (scanError) {
    log.warn('Manual scan for date range failed, continuing to history fallback', {
      systemId,
      error: scanError.message
    });
  }

  // Fallback to history collection
  const history = await getCollection('history');
  const [historyResult] = await history.aggregate([
    { $match: { $or: [{ systemId }, { 'analysis.systemId': systemId }] } },
    { $group: { _id: null, minDate: { $min: '$timestamp' }, maxDate: { $max: '$timestamp' } } }
  ]).toArray();

  if (historyResult?.minDate && historyResult?.maxDate) {
    return { minDate: new Date(historyResult.minDate), maxDate: new Date(historyResult.maxDate) };
  }

  return { minDate: null, maxDate: null };
}

function clampToAvailableRange(minDate, maxDate, days) {
  if (!minDate || !maxDate) return null;

  const now = Date.now();
  const maxMs = new Date(maxDate).getTime();
  const endMs = Math.min(now, maxMs);
  const startMs = Math.max(new Date(minDate).getTime(), endMs - days * 24 * 60 * 60 * 1000);

  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString()
  };
}

function detectStateChanges(analyses) {
  const changes = [];
  let prevStatus = null;

  for (const analysis of analyses) {
    const status = analysis.analysis?.status;
    if (status && status !== prevStatus) {
      changes.push({
        timestamp: analysis.timestamp,
        from: prevStatus,
        to: status
      });
      prevStatus = status;
    }
  }

  return changes;
}

function calculateHealthScore(analysis) {
  let score = 100;

  // Deduct points for issues using configurable thresholds
  if (analysis.cellVoltageDifference > HEALTH_SCORE_THRESHOLDS.CELL_VOLTAGE_DIFF_MAX) {
    score -= HEALTH_SCORE_THRESHOLDS.CELL_VOLTAGE_DIFF_PENALTY;
  }
  if (analysis.alerts && analysis.alerts.length > 0) {
    score -= analysis.alerts.length * HEALTH_SCORE_THRESHOLDS.ALERT_PENALTY_PER_ITEM;
  }
  if (analysis.stateOfCharge < HEALTH_SCORE_THRESHOLDS.SOC_LOW_THRESHOLD) {
    score -= HEALTH_SCORE_THRESHOLDS.SOC_LOW_PENALTY;
  }
  if (analysis.temperature > HEALTH_SCORE_THRESHOLDS.TEMP_HIGH_THRESHOLD) {
    score -= HEALTH_SCORE_THRESHOLDS.TEMP_HIGH_PENALTY;
  }

  return Math.max(0, Math.min(100, score));
}

function estimateRemainingLife(analysis) {
  const cycleCount = analysis.cycleCount || 0;
  const typicalLifeCycles = 3000; // LiFePO4 typical

  const remainingCycles = Math.max(0, typicalLifeCycles - cycleCount);
  const remainingYears = remainingCycles / 365; // Assuming 1 cycle per day

  return {
    remainingCycles,
    remainingYears: Math.round(remainingYears * 10) / 10,
    estimatedEndDate: new Date(Date.now() + remainingYears * 365 * 24 * 60 * 60 * 1000).toISOString()
  };
}

function calculateDegradationRate(analyses) {
  if (analyses.length < 2) return null;

  const first = analyses[0];
  const last = analyses[analyses.length - 1];

  const firstCapacity = first.analysis?.fullCapacity;
  const lastCapacity = last.analysis?.fullCapacity;

  if (!firstCapacity || !lastCapacity) return null;

  const degradation = ((firstCapacity - lastCapacity) / firstCapacity) * 100;
  const timeDays = (new Date(last.timestamp) - new Date(first.timestamp)) / (1000 * 60 * 60 * 24);
  const degradationPerYear = (degradation / timeDays) * 365;

  return {
    totalDegradation: Math.round(degradation * 100) / 100,
    degradationPerYear: Math.round(degradationPerYear * 100) / 100,
    timeRangeDays: Math.round(timeDays)
  };
}

function countDataPoints(obj) {
  // Efficiently count data points without deep traversal
  if (!obj) return 0;

  // If it's the full context object
  if (obj.raw && obj.raw.totalDataPoints) {
    return obj.raw.totalDataPoints;
  }

  // If it's a raw data object
  if (obj.allAnalyses && Array.isArray(obj.allAnalyses)) {
    return obj.allAnalyses.length;
  }

  // Fallback for generic objects (simplified)
  if (Array.isArray(obj)) return obj.length;

  // Last resort: just count keys at top level
  return Object.keys(obj).length;
}

module.exports = {
  buildCompleteContext,
  countDataPoints
};
