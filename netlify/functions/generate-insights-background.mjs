/**
 * Generate Insights Background - Netlify Async Workload Implementation
 * 
 * This is a COMPLETE implementation of Netlify Async Workloads for insights generation.
 * Uses all features of @netlify/async-workloads for maximum resilience and durability.
 * 
 * FEATURES ("All the Bells and Whistles"):
 * ✅ Event-driven architecture (not HTTP-based)
 * ✅ Durable execution with automatic retries
 * ✅ Multi-step workflows with independent retry per step
 * ✅ Sleep/delay capabilities for rate limiting
 * ✅ Custom backoff schedules
 * ✅ Event filtering
 * ✅ State persistence across retries
 * ✅ Error handling with retry control
 * ✅ Event chaining (trigger follow-up events)
 * ✅ Priority support
 * ✅ Extended execution time (no timeout limits)
 * 
 * @see https://docs.netlify.com/build/async-workloads/
 */

import { asyncWorkloadFn, ErrorDoNotRetry, ErrorRetryAfterDelay } from '@netlify/async-workloads';
import { createLogger } from './utils/logger.cjs';
import { getInsightsJob, updateJobStatus, saveCheckpoint, completeJob, failJob } from './utils/insights-jobs.cjs';
import { processInsightsInBackground } from './utils/insights-processor.cjs';

// Retry delay constants (in milliseconds)
const RATE_LIMIT_RETRY_DELAY_MS = 300000; // 5 minutes
const TRANSIENT_ERROR_RETRY_DELAY_MS = 30000; // 30 seconds

/**
 * Main async workload handler
 * 
 * This handler is invoked by Netlify's async workload system when:
 * - A 'generate-insights' event is sent
 * - A retry is triggered after a failure
 * - The workload is resumed from a sleep/delay
 */
const handler = asyncWorkloadFn(async (event) => {
  const { eventName, eventData, eventId, attempt, step, sendEvent } = event;
  
  const log = createLogger('generate-insights-async-workload', { eventId, attempt });
  log.info('Async workload invoked', {
    eventName,
    eventId,
    attempt,
    hasEventData: !!eventData
  });

  try {
    // Extract job details from event data
    const {
      jobId,
      analysisData,
      systemId,
      customPrompt,
      contextWindowDays,
      maxIterations,
      modelOverride,
      fullContextMode
    } = eventData || {};

    if (!jobId) {
      throw new ErrorDoNotRetry('Missing jobId in event data - cannot retry without job identifier');
    }

    // STEP 1: Initialize and validate
    await step.run('initialize-workload', async () => {
      log.info('Step 1: Initialize workload', { jobId });
      
      // Update job status to processing
      await updateJobStatus(jobId, 'processing', log);
      
      // Save initial checkpoint
      await saveCheckpoint(jobId, {
        state: {
          step: 'initialize',
          eventId,
          attempt,
          startTime: Date.now()
        }
      }, log);
      
      log.info('Workload initialized', { jobId, eventId });
    });

    // STEP 2: Fetch job data if needed
    let jobData = analysisData;
    let systemIdFromJob = systemId;
    let customPromptFromJob = customPrompt;
    let contextWindowDaysFromJob = contextWindowDays;
    let maxIterationsFromJob = maxIterations;
    let modelOverrideFromJob = modelOverride;
    let fullContextModeFromJob = fullContextMode;

    if (!jobData) {
      await step.run('fetch-job-data', async () => {
        log.info('Step 2: Fetching job data from database', { jobId });
        
        const job = await getInsightsJob(jobId, log);
        
        if (!job) {
          // Mark as failed and don't retry (job doesn't exist)
          await failJob(jobId, 'Job not found in database', log);
          throw new ErrorDoNotRetry(`Job ${jobId} not found in database`);
        }
        
        // Extract all parameters from job
        jobData = job.analysisData;
        systemIdFromJob = job.systemId;
        customPromptFromJob = job.customPrompt;
        contextWindowDaysFromJob = job.contextWindowDays;
        maxIterationsFromJob = job.maxIterations;
        modelOverrideFromJob = job.modelOverride;
        fullContextModeFromJob = job.fullContextMode;
        
        log.info('Job data loaded', { 
          jobId,
          hasData: !!jobData,
          hasSystemId: !!systemIdFromJob
        });
      });
    }

    // STEP 3: Validate required data
    await step.run('validate-data', async () => {
      log.info('Step 3: Validating data', { jobId });
      
      if (!jobData || !systemIdFromJob) {
        throw new ErrorDoNotRetry('Missing required data: analysisData and systemId are required');
      }
      
      await saveCheckpoint(jobId, {
        state: {
          step: 'validate',
          validated: true,
          hasData: !!jobData,
          hasSystemId: !!systemIdFromJob
        }
      }, log);
    });

    // STEP 4: Process insights with full async capability
    let insights;
    await step.run('process-insights', async () => {
      log.info('Step 4: Processing insights with unlimited timeout', { jobId });
      
      try {
        const result = await processInsightsInBackground(
          jobId,
          jobData,
          systemIdFromJob,
          customPromptFromJob,
          log,
          {
            contextWindowDays: contextWindowDaysFromJob,
            maxIterations: maxIterationsFromJob,
            modelOverride: modelOverrideFromJob,
            fullContextMode: fullContextModeFromJob
          }
        );
        
        if (!result || !result.success) {
          const errorMsg = result?.error || 'Processing failed without details';
          
          // Check if this is a retryable error
          if (errorMsg.includes('timeout') || errorMsg.includes('ECONNREFUSED')) {
            // Retry after delay for transient errors
            throw new ErrorRetryAfterDelay({
              message: `Transient error during processing: ${errorMsg}. Will retry after ${TRANSIENT_ERROR_RETRY_DELAY_MS / 1000}s`,
              retryDelay: TRANSIENT_ERROR_RETRY_DELAY_MS, // 30 seconds
              error: new Error(errorMsg)
            });
          } else if (errorMsg.includes('quota') || errorMsg.includes('rate limit')) {
            // Longer delay for quota/rate limit errors
            throw new ErrorRetryAfterDelay({
              message: `Rate limit or quota error: ${errorMsg}. Will retry after ${RATE_LIMIT_RETRY_DELAY_MS / 1000}s`,
              retryDelay: RATE_LIMIT_RETRY_DELAY_MS, // 5 minutes
              error: new Error(errorMsg)
            });
          } else {
            // Non-retryable business logic error
            throw new ErrorDoNotRetry(`Business logic error: ${errorMsg}`);
          }
        }
        
        insights = result.insights;
        
        log.info('Insights processed successfully', {
          jobId,
          hasInsights: !!insights
        });
        
        await saveCheckpoint(jobId, {
          state: {
            step: 'process',
            completed: true,
            hasInsights: !!insights
          }
        }, log);
        
      } catch (error) {
        // Re-throw ErrorDoNotRetry and ErrorRetryAfterDelay as-is
        if (error instanceof ErrorDoNotRetry || error instanceof ErrorRetryAfterDelay) {
          throw error;
        }
        
        // For other errors, wrap with retry logic
        log.error('Processing error', {
          jobId,
          error: error.message,
          stack: error.stack
        });
        
        throw new ErrorRetryAfterDelay({
          message: `Unexpected error during processing: ${error.message}`,
          retryDelay: 60000, // 1 minute
          error
        });
      }
    });

    // STEP 5: Store results in database
    await step.run('store-results', async () => {
      log.info('Step 5: Storing results', { jobId, hasInsights: !!insights });
      
      await completeJob(jobId, insights, log);
      
      await saveCheckpoint(jobId, {
        state: {
          step: 'complete',
          success: true,
          completedAt: Date.now()
        }
      }, log);
      
      log.info('Results stored successfully', { jobId });
    });

    // STEP 6: Send completion event (optional - for event chaining)
    await step.run('send-completion-event', async () => {
      log.info('Step 6: Sending completion event', { jobId });
      
      // Send a follow-up event for notification, analytics, etc.
      try {
        await sendEvent('insights-completed', {
          data: {
            jobId,
            systemId: systemIdFromJob,
            completedAt: new Date().toISOString(),
            hasInsights: !!insights
          },
          priority: 4 // Raised priority for more timely notification events
        });
        
        log.info('Completion event sent', { jobId });
      } catch (eventError) {
        // Don't fail the whole workload if completion event fails
        log.warn('Failed to send completion event', {
          jobId,
          error: eventError.message
        });
      }
    });

    log.info('Async workload completed successfully', {
      jobId,
      eventId,
      attempt,
      totalSteps: 6
    });

  } catch (error) {
    log.error('Async workload failed', {
      eventId,
      attempt,
      error: error.message,
      stack: error.stack,
      isDoNotRetry: error instanceof ErrorDoNotRetry,
      isRetryAfterDelay: error instanceof ErrorRetryAfterDelay
    });

    // Try to mark job as failed in database (if we have jobId)
    try {
      const { jobId } = eventData || {};
      if (jobId) {
        if (error instanceof ErrorDoNotRetry || attempt >= asyncWorkloadConfig.maxRetries) {
          await failJob(jobId, error.message, log);
        }
      }
    } catch (failError) {
      log.error('Failed to mark job as failed', {
        error: failError.message
      });
    }

    // Re-throw to let Netlify handle retry logic
    throw error;
  }
});

// Export the handler
export default handler;

/**
 * Async Workload Configuration
 * 
 * This configuration tells Netlify how to handle this workload.
 * 
 * @see https://docs.netlify.com/build/async-workloads/writing-workloads/
 */
export const asyncWorkloadConfig = {
  // Workload name for identification
  name: 'generate-insights-background',
  
  // Events this workload should handle
  events: ['generate-insights'],
  
  // Maximum number of retries before dead-lettering (15 retries)
  maxRetries: 15,
  
  // Event filter - only process events with valid job data
  eventFilter: (event) => {
    const { eventData } = event;
    return eventData && (eventData.jobId || (eventData.analysisData && eventData.systemId));
  },
  
  // Custom exponential backoff schedule
  // Attempt 1: 5s, Attempt 2: 10s, Attempt 3: 30s, Attempt 4+: 60s
  backoffSchedule: (attempt) => {
    if (attempt === 1) return 5000;       // 5 seconds
    if (attempt === 2) return 10000;      // 10 seconds
    if (attempt === 3) return 30000;      // 30 seconds
    return 60000;                         // 1 minute for subsequent attempts
  }
};
