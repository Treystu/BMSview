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
  
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { action = 'start', workloadId, step } = body;
    
    log.info('Diagnostics workload request', { action, workloadId, step });
    
    // Start new diagnostic run
    if (action === 'start') {
      const result = await initializeDiagnostics(log, context);
      
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
      const { getInsightsJob, updateJobStep } = require('./utils/insights-jobs.cjs');
      const job = await getInsightsJob(workloadId);
      
      if (!job) {
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
      const currentStep = job.state.currentStep || 'initialize';
      
      log.info('Executing step', { workloadId, currentStep, step: job.state.stepIndex });
      
      switch (currentStep) {
        case 'initialize':
          // Already done, move to testing
          await updateJobStep(workloadId, {
            currentStep: 'test_tool',
            stepIndex: 0,
            message: 'Starting tool tests'
          }, log);
          stepResult = { success: true, nextStep: 'test_tool' };
          break;
          
        case 'test_tool':
          stepResult = await testTool(workloadId, job.state, log, context);
          break;
          
        case 'analyze_failures':
          stepResult = await analyzeFailures(workloadId, job.state, log, context);
          break;
          
        case 'submit_feedback':
          stepResult = await submitFeedbackForFailures(workloadId, job.state, log, context);
          break;
          
        case 'finalize':
          stepResult = await finalizeDiagnostics(workloadId, job.state, log, context);
          break;
          
        default:
          return {
            statusCode: 400,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: `Unknown step: ${currentStep}`
            })
          };
      }
      
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
      
      if (!job) {
        return {
          statusCode: 404,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Workload not found'
          })
        };
      }
      
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          workloadId: job.jobId,
          status: job.status,
          currentStep: job.state.currentStep,
          stepIndex: job.state.stepIndex,
          totalSteps: job.state.totalSteps,
          progress: job.state.progress || 0,
          message: job.state.message,
          results: job.state.results,
          feedbackSubmitted: job.state.feedbackSubmitted || [],
          error: job.error
        })
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
