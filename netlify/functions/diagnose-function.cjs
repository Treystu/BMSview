// @ts-nocheck
/**
 * Diagnose Function Endpoint
 * Provides detailed diagnostics for specific Netlify functions
 * Checks collections, logs, and common issues
 */

const { createLoggerFromEvent } = require('./utils/logger.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

const FUNCTION_DIAGNOSTICS = {
  'analyze.cjs': {
    collections: ['analysis-results', 'history', 'idempotent-requests'],
    async diagnose(log) {
      const issues = [];
      const collectionStatus = {};

      // Check analysis-results collection
      try {
        const analysisResults = await getCollection('analysis-results');
        const totalCount = await analysisResults.countDocuments({});
        const recentCount = await analysisResults.countDocuments({
          timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }
        });

        collectionStatus['analysis-results'] = { count: totalCount, recentCount };

        if (totalCount === 0) {
          issues.push('CRITICAL: analysis-results collection is empty - no analyses have been saved');
        }
      } catch (error) {
        issues.push(`ERROR: Cannot access analysis-results collection: ${error.message}`);
      }

      // Check history collection (should have same data due to dual-write)
      try {
        const history = await getCollection('history');
        const totalCount = await history.countDocuments({});
        const recentCount = await history.countDocuments({
          timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }
        });

        collectionStatus['history'] = { count: totalCount, recentCount };

        if (totalCount === 0) {
          issues.push('CRITICAL: history collection is empty - dual-write may be failing');
        }

        // Check for dual-write consistency
        if (collectionStatus['analysis-results'] && 
            Math.abs(totalCount - collectionStatus['analysis-results'].count) > 10) {
          issues.push(
            `WARNING: Collection mismatch detected! ` +
            `analysis-results has ${collectionStatus['analysis-results'].count} records ` +
            `but history has ${totalCount} records. Dual-write may be failing.`
          );
        }
      } catch (error) {
        issues.push(`ERROR: Cannot access history collection: ${error.message}`);
      }

      // Check idempotent-requests
      try {
        const idemCol = await getCollection('idempotent-requests');
        const count = await idemCol.countDocuments({});
        collectionStatus['idempotent-requests'] = { count };
      } catch (error) {
        issues.push(`WARNING: Cannot access idempotent-requests: ${error.message}`);
      }

      let recommendations = '';
      if (issues.length === 0) {
        recommendations = '✅ analyze.cjs appears to be functioning correctly.\n\n';
        recommendations += 'Dual-write is working - both collections have data.';
      } else {
        recommendations = 'Issues detected:\n\n';
        if (issues.some(i => i.includes('dual-write'))) {
          recommendations += '1. Check analyze.cjs logs in storeAnalysisResults function for dual-write errors\n';
          recommendations += '2. Search logs for "Dual-write to history collection" messages\n';
          recommendations += '3. Verify MongoDB connection is stable\n';
          recommendations += '4. Run a test analysis and verify both collections update\n';
        }
        if (issues.some(i => i.includes('empty'))) {
          recommendations += '1. No analysis data found - upload a BMS screenshot to test\n';
          recommendations += '2. Check Gemini API key is configured correctly\n';
        }
      }

      return { collectionStatus, issues, recommendations };
    }
  },

  'generate-insights-with-tools.cjs': {
    collections: ['insights-jobs', 'analysis-results', 'history', 'systems'],
    async diagnose(log) {
      const issues = [];
      const collectionStatus = {};

      // Check insights-jobs
      try {
        const jobs = await getCollection('insights-jobs');
        const totalJobs = await jobs.countDocuments({});
        const completedJobs = await jobs.countDocuments({ status: 'completed' });
        const failedJobs = await jobs.countDocuments({ status: 'failed' });
        const recentJobs = await jobs.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        });

        collectionStatus['insights-jobs'] = {
          total: totalJobs,
          completed: completedJobs,
          failed: failedJobs,
          recent: recentJobs
        };

        if (failedJobs > completedJobs && totalJobs > 10) {
          issues.push(
            `WARNING: High failure rate - ${failedJobs} failed vs ${completedJobs} completed`
          );
        }
      } catch (error) {
        issues.push(`ERROR: Cannot access insights-jobs: ${error.message}`);
      }

      // Check data availability
      try {
        const history = await getCollection('history');
        const count = await history.countDocuments({});
        collectionStatus['history'] = { count };

        if (count === 0) {
          issues.push(
            'CRITICAL: history collection is empty - tools cannot fetch data! ' +
            'This is the root cause of "no data found" errors.'
          );
        }
      } catch (error) {
        issues.push(`ERROR: Cannot access history collection: ${error.message}`);
      }

      let recommendations = '';
      if (issues.some(i => i.includes('history collection is empty'))) {
        recommendations = '🔴 ROOT CAUSE IDENTIFIED:\n\n';
        recommendations += 'The history collection is empty, so request_bms_data tool returns no data.\n\n';
        recommendations += 'SOLUTION:\n';
        recommendations += '1. Upload a BMS screenshot via the main app\n';
        recommendations += '2. Verify dual-write in analyze.cjs creates records in history collection\n';
        recommendations += '3. Check analyze.cjs logs for dual-write errors\n';
        recommendations += '4. If dual-write is failing, check MongoDB connection\n';
      } else if (issues.some(i => i.includes('failure rate'))) {
        recommendations = 'High insights failure rate detected.\n\n';
        recommendations += '1. Check recent failed jobs for error patterns\n';
        recommendations += '2. Verify Gemini API quota and rate limits\n';
        recommendations += '3. Check timeout configurations\n';
      } else {
        recommendations = '✅ Insights system appears healthy.';
      }

      return { collectionStatus, issues, recommendations };
    }
  },

  'request_bms_data (tool)': {
    collections: ['history'],
    async diagnose(log) {
      const issues = [];
      const collectionStatus = {};

      try {
        const history = await getCollection('history');
        const totalRecords = await history.countDocuments({});
        const withSystemId = await history.countDocuments({ systemId: { $ne: null } });
        const recentRecords = await history.countDocuments({
          timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() }
        });

        collectionStatus['history'] = {
          total: totalRecords,
          withSystemId,
          recent: recentRecords
        };

        if (totalRecords === 0) {
          issues.push(
            '🔴 CRITICAL: history collection is EMPTY! This is why request_bms_data returns no data.'
          );
          issues.push(
            'Root cause: analyze.cjs dual-write to history collection is not working or no analyses have been run.'
          );
        } else if (recentRecords === 0) {
          issues.push(
            'WARNING: No recent data in last 7 days - tool will return empty results for recent queries'
          );
        }

        if (withSystemId === 0 && totalRecords > 0) {
          issues.push(
            'WARNING: All records have null systemId - they need to be linked to systems'
          );
        }
      } catch (error) {
        issues.push(`ERROR: Cannot access history collection: ${error.message}`);
      }

      let recommendations = '';
      if (collectionStatus['history']?.total === 0) {
        recommendations = '🔴 DIAGNOSIS: Empty history collection\n\n';
        recommendations += 'ACTION PLAN:\n';
        recommendations += '1. Upload a BMS screenshot via the main app\n';
        recommendations += '2. Check browser console and network tab for errors\n';
        recommendations += '3. Verify analyze.cjs dual-write logs show success\n';
        recommendations += '4. Query both analysis-results AND history collections to verify dual-write\n';
        recommendations += '5. If only analysis-results has data, dual-write is broken\n';
      } else {
        recommendations = `✅ history collection has ${collectionStatus['history'].total} records.\n\n`;
        recommendations += 'Tool should be able to fetch data successfully.';
      }

      return { collectionStatus, issues, recommendations };
    }
  },

  'full-context-builder.cjs': {
    collections: ['analysis-results', 'systems', 'ai_feedback'],
    async diagnose(log) {
      const issues = [];
      const collectionStatus = {};

      try {
        const analysisResults = await getCollection('analysis-results');
        const count = await analysisResults.countDocuments({});
        collectionStatus['analysis-results'] = { count };

        if (count === 0) {
          issues.push(
            'CRITICAL: analysis-results is empty - Full Context Mode has no data to load!'
          );
        }
      } catch (error) {
        issues.push(`ERROR: Cannot access analysis-results: ${error.message}`);
      }

      try {
        const systems = await getCollection('systems');
        const count = await systems.countDocuments({});
        collectionStatus['systems'] = { count };

        if (count === 0) {
          issues.push('WARNING: No systems registered - context will be limited');
        }
      } catch (error) {
        issues.push(`ERROR: Cannot access systems: ${error.message}`);
      }

      let recommendations = '';
      if (issues.some(i => i.includes('analysis-results is empty'))) {
        recommendations = '🔴 Full Context Mode cannot provide context!\n\n';
        recommendations += 'Reason: analysis-results collection is empty.\n\n';
        recommendations += 'SOLUTION:\n';
        recommendations += '1. Upload BMS screenshots to populate analysis-results\n';
        recommendations += '2. Verify analyze.cjs storeAnalysisResults function is saving to analysis-results\n';
        recommendations += '3. Check logs for "Analysis results stored for deduplication" messages\n';
        recommendations += '4. Link analyses to systems for richer context\n';
      } else {
        recommendations = '✅ Full Context Mode has data available.';
      }

      return { collectionStatus, issues, recommendations };
    }
  }
};

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('diagnose-function', event, context);

  try {
    const { functionName, customQuery } = JSON.parse(event.body || '{}');

    if (!functionName) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'functionName is required' })
      };
    }

    const diagnostic = FUNCTION_DIAGNOSTICS[functionName];
    if (!diagnostic) {
      return {
        statusCode: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Unknown function: ${functionName}` })
      };
    }

    log.info('Running diagnostics', { functionName, customQuery });

    const results = await diagnostic.diagnose(log);

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        functionName,
        ...results
      })
    };
  } catch (error) {
    log.error('Diagnostics failed', { error: error.message, stack: error.stack });

    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'diagnostics_failed',
        message: error.message
      })
    };
  }
};
