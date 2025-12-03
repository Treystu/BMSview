/**
 * Diagnostics Workload - Async Self-Testing System
 * 
 * This is the FIRST implementation of the Netlify Async Workloads pattern (issue #274).
 * Tests all available Gemini tools systematically, reports failures via AI Feedback dashboard.
 * 
 * Pattern: Step-based async execution with persistent state
 * - Each step is independently retryable
 * - State persists across step boundaries
 * - Survives function restarts
 * - Non-blocking for admins
 */

const { createLogger } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { 
  initializeDiagnostics,
  testTool,
  analyzeFailures,
  submitFeedbackForFailures,
  finalizeDiagnostics
} = require('./utils/diagnostics-steps.cjs');

/**
 * Get default state structure for diagnostics workload
 * This ensures all required properties are always present
 */
function getDefaultState() {
  return {
    workloadType: 'diagnostics',
    currentStep: 'initialize',
    stepIndex: 0,
    totalSteps: 0,
    toolsToTest: [],
    toolIndex: 0,
    results: [],
    failures: [],
    feedbackSubmitted: [],
    progress: 0,
    message: 'Initializing...',
    startTime: Date.now()
  };
}

// Export for testing
exports.getDefaultState = getDefaultState;

/**
 * Simple async workload handler (manual implementation since @netlify/async-workloads may not be available)
 * This follows the pattern described in issue #274 but uses jobs collection for state persistence
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  const log = createLogger('diagnostics-workload', context);
  log.entry({ method: event.httpMethod, path: event.path });
  
  // Sanitize headers for DEBUG logging
  const sanitizedHeaders = event.headers ? { 
    ...event.headers,
    authorization: event.headers.authorization ? '[REDACTED]' : undefined,
    cookie: event.headers.cookie ? '[REDACTED]' : undefined,
    'x-api-key': event.headers['x-api-key'] ? '[REDACTED]' : undefined
  } : {};
  
  log.debug('Request received', { 
    method: event.httpMethod, 
    path: event.path,
    bodyLength: event.body ? event.body.length : 0,
    headers: sanitizedHeaders
  });
  
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { action = 'start', workloadId, step } = body;
    
    log.info('Diagnostics workload request', { action, workloadId, step });
    log.debug('Request body (sanitized)', { action, workloadId, step, bodyLength: event.body ? event.body.length : 0 });
    
    // Start new diagnostic run
    if (action === 'start') {
      log.debug('Starting new diagnostics workload');
      const result = await initializeDiagnostics(log, context);
      
      log.debug('Diagnostics workload initialized', result);
      
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          workloadId: result.workloadId,
          status: 'initialized',
          message: 'Diagnostics workload started. Use the workloadId to poll for status.',
          nextStep: result.nextStep,
          totalSteps: result.totalSteps
        })
      };
    }
    
    // Execute next step
    if (action === 'step' && workloadId) {
      log.debug('Executing step', { workloadId });
      const { getInsightsJob, saveCheckpoint } = require('./utils/insights-jobs.cjs');
      const job = await getInsightsJob(workloadId);
      
      if (!job) {
        log.warn('Workload not found for step execution', { workloadId });
        return {
          statusCode: 404,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Workload not found'
          })
        };
      }
      
      let stepResult;
      // Access state from checkpointState.state for consistency with insights-jobs pattern
      // Provide proper defaults to prevent "Cannot read properties of undefined" errors
      const jobState = job.checkpointState?.state || getDefaultState();
      const currentStep = jobState.currentStep || 'initialize';
      
      log.info('Executing step', { workloadId, currentStep, step: jobState.stepIndex });
      log.debug('Job state before step execution', { 
        jobState, 
        hasCheckpointState: !!job.checkpointState 
      });
      
      switch (currentStep) {
        case 'initialize':
          log.debug('Step: initialize - moving to test_tool');
          // Already done, move to testing
          await saveCheckpoint(workloadId, {
            state: {
              ...jobState,
              currentStep: 'test_tool',
              stepIndex: 0,
              message: 'Starting tool tests'
            }
          }, log);
          stepResult = { success: true, nextStep: 'test_tool' };
          break;
          
        case 'test_tool':
          log.debug('Step: test_tool');
          stepResult = await testTool(workloadId, jobState, log, context);
          break;
          
        case 'analyze_failures':
          log.debug('Step: analyze_failures');
          stepResult = await analyzeFailures(workloadId, jobState, log, context);
          break;
          
        case 'submit_feedback':
          log.debug('Step: submit_feedback');
          stepResult = await submitFeedbackForFailures(workloadId, jobState, log, context);
          break;
          
        case 'finalize':
          log.debug('Step: finalize');
          stepResult = await finalizeDiagnostics(workloadId, jobState, log, context);
          break;
          
        default:
          log.error('Unknown step', { currentStep });
          return {
            statusCode: 400,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: `Unknown step: ${currentStep}`
            })
          };
      }
      
      log.debug('Step result', { currentStep, stepResult });
      
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          workloadId,
          step: currentStep,
          ...stepResult
        })
      };
    }
    
    // Get status
    if (action === 'status' && workloadId) {
      const { getInsightsJob } = require('./utils/insights-jobs.cjs');
      const job = await getInsightsJob(workloadId);
      
      log.debug('Status request', { workloadId, jobFound: !!job });
      
      if (!job) {
        log.warn('Workload not found', { workloadId });
        return {
          statusCode: 404,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Workload not found'
          })
        };
      }
      
      // Provide proper defaults to prevent missing properties
      const jobState = job.checkpointState?.state || getDefaultState();
      
      log.debug('Job state retrieved', { 
        workloadId, 
        status: job.status,
        currentStep: jobState.currentStep,
        stepIndex: jobState.stepIndex,
        totalSteps: jobState.totalSteps,
        hasCheckpointState: !!job.checkpointState,
        hasState: !!jobState,
        resultCount: (jobState.results || []).length,
        failureCount: (jobState.failures || []).length
      });
      
      // Ensure all required fields are present with defaults
      const response = {
        success: true,
        workloadId: job.id,
        status: job.status || 'pending',
        currentStep: jobState.currentStep || 'initialize',
        stepIndex: jobState.stepIndex !== undefined ? jobState.stepIndex : 0,
        totalSteps: jobState.totalSteps || 0,
        progress: jobState.progress || 0,
        message: jobState.message || 'Initializing...',
        results: jobState.results || [],
        feedbackSubmitted: jobState.feedbackSubmitted || [],
        summary: jobState.summary || null,
        error: job.error || null
      };
      
      log.debug('Sending status response', { 
        workloadId: response.workloadId,
        status: response.status,
        currentStep: response.currentStep,
        stepIndex: response.stepIndex,
        totalSteps: response.totalSteps,
        progress: response.progress,
        hasResults: response.results.length > 0,
        hasSummary: !!response.summary,
        hasError: !!response.error
      });
      
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(response)
      };
    }
    
    return {
      statusCode: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Invalid action. Use: start, step, or status'
      })
    };
    
  } catch (error) {
    log.error('Diagnostics workload error', {
      error: error.message,
      stack: error.stack
    });
    
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
