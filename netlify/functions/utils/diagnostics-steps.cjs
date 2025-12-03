/**
 * Diagnostics Steps - Step Implementations for Async Workload
 * 
 * Each function represents a step in the diagnostics workload.
 * Steps are independently retryable and persist state.
 */

const { executeToolCall, toolDefinitions } = require('./gemini-tools.cjs');
const { createInsightsJob, getInsightsJob, saveCheckpoint, completeJob, failJob } = require('./insights-jobs.cjs');
const { getCollection } = require('./mongodb.cjs');

/**
 * Helper to update job step state
 * State is stored in checkpointState.state for consistency with insights-jobs pattern
 */
async function updateJobStep(jobId, stateUpdate, log) {
  return await saveCheckpoint(jobId, { state: stateUpdate }, log);
}

/**
 * Get available tool definitions for validation
 * @returns {Array} List of available tool names
 */
function getAvailableTools() {
  return toolDefinitions.map(t => t.name);
}

/**
 * Tool test definitions - what to test for each tool
 */
const TOOL_TESTS = [
  {
    name: 'request_bms_data',
    validTest: { systemId: 'test-system', metric: 'soc', time_range_start: '2025-11-01T00:00:00Z', time_range_end: '2025-11-30T23:59:59Z', granularity: 'daily_avg' },
    edgeCaseTest: { systemId: 'test-system', metric: 'all', time_range_start: '2025-12-01T00:00:00Z', time_range_end: '2025-12-01T01:00:00Z', granularity: 'raw' }
  },
  {
    name: 'getWeatherData',
    validTest: { latitude: 40.7128, longitude: -74.0060, type: 'current' },
    edgeCaseTest: { latitude: 0, longitude: 0, type: 'forecast' }
  },
  {
    name: 'getSolarEstimate',
    validTest: { location: '40.7128,-74.0060', panelWatts: 400, startDate: '2025-11-01', endDate: '2025-11-30' },
    edgeCaseTest: { location: '-90,180', panelWatts: 100, startDate: '2025-12-01', endDate: '2025-12-01' }
  },
  {
    name: 'getSystemAnalytics',
    validTest: { systemId: 'test-system' },
    edgeCaseTest: { systemId: 'nonexistent-system-12345' }
  },
  {
    name: 'predict_battery_trends',
    validTest: { systemId: 'test-system', metric: 'capacity', forecastDays: 30, confidenceLevel: true },
    edgeCaseTest: { systemId: 'test-system', metric: 'lifetime', confidenceLevel: false }
  },
  {
    name: 'analyze_usage_patterns',
    validTest: { systemId: 'test-system', patternType: 'daily', timeRange: '30d' },
    edgeCaseTest: { systemId: 'test-system', patternType: 'anomalies', timeRange: '7d' }
  },
  {
    name: 'calculate_energy_budget',
    validTest: { systemId: 'test-system', scenario: 'current', timeframe: '30d', includeWeather: true },
    edgeCaseTest: { systemId: 'test-system', scenario: 'worst_case', timeframe: '7d', includeWeather: false }
  },
  {
    name: 'get_hourly_soc_predictions',
    validTest: { systemId: 'test-system', hoursBack: 24 },
    edgeCaseTest: { systemId: 'test-system', hoursBack: 168 }
  },
  {
    name: 'searchGitHubIssues',
    validTest: { query: 'diagnostics', state: 'all', per_page: 5 },
    edgeCaseTest: { query: '', state: 'open', per_page: 1 }
  },
  {
    name: 'getCodebaseFile',
    validTest: { path: 'package.json', ref: 'main' },
    edgeCaseTest: { path: 'netlify/functions/utils/gemini-tools.cjs' }
  },
  {
    name: 'listDirectory',
    validTest: { path: 'netlify/functions', ref: 'main' },
    edgeCaseTest: { path: 'components' }
  }
];

/**
 * Step 1: Initialize diagnostics workload
 * Gracefully handles errors - creates job even if some steps fail
 */
async function initializeDiagnostics(log, context) {
  try {
    log.info('Initializing diagnostics workload');
    log.debug('Creating diagnostics job');
    
    // Create job in insights-jobs collection
    const jobId = `diag_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    const initialState = {
      workloadType: 'diagnostics',
      currentStep: 'initialize',
      stepIndex: 0,
      totalSteps: TOOL_TESTS.length + 3, // tests + analyze + submit + finalize
      toolsToTest: TOOL_TESTS,
      toolIndex: 0,
      results: [],
      failures: [],
      feedbackSubmitted: [],
      progress: 0,
      message: 'Diagnostics initialized',
      startTime: Date.now()
    };
    
    log.debug('Initial state created', { 
      jobId, 
      totalSteps: initialState.totalSteps,
      toolCount: TOOL_TESTS.length,
      workloadType: initialState.workloadType
    });
    
    // Create job using standard createInsightsJob signature
    let job;
    try {
      job = await createInsightsJob({
        systemId: 'diagnostics-system',
        customPrompt: 'Diagnostic self-test'
      }, log);
    } catch (createErr) {
      log.error('Could not create insights job, creating minimal job record', { error: createErr.message });
      // Fallback: create minimal job directly
      const collection = await getCollection('insights-jobs');
      await collection.insertOne({
        id: jobId,
        status: 'pending',
        checkpointState: { state: initialState },
        createdAt: new Date(),
        systemId: 'diagnostics-system'
      });
      
      log.info('Diagnostics workload initialized (fallback mode)', { jobId, totalSteps: initialState.totalSteps });
      
      return {
        workloadId: jobId,
        nextStep: 'test_tool',
        totalSteps: initialState.totalSteps
      };
    }
    
    log.debug('Job created', { originalJobId: job.id, newJobId: jobId });
    
    // Update the job ID to use our diagnostics-specific format
    try {
      const collection = await getCollection('insights-jobs');
      await collection.updateOne(
        { id: job.id },
        { 
          $set: { 
            id: jobId,
            checkpointState: { state: initialState },
            status: 'pending'
          } 
        }
      );
    } catch (updateErr) {
      log.warn('Could not update job ID, using original ID', { error: updateErr.message, originalId: job.id });
      // Use original job ID if update fails
      return {
        workloadId: job.id,
        nextStep: 'test_tool',
        totalSteps: initialState.totalSteps
      };
    }
    
    log.info('Diagnostics workload initialized', { jobId, totalSteps: initialState.totalSteps });
    log.debug('Job updated in database', { jobId });
    
    return {
      workloadId: jobId,
      nextStep: 'test_tool',
      totalSteps: initialState.totalSteps
    };
  } catch (error) {
    // Ultimate fallback - return error but allow process to continue
    log.error('Initialization failed completely', { error: error.message, stack: error.stack });
    throw error; // Re-throw initialization errors as they prevent the entire workflow
  }
}

/**
 * Step 2-N: Test individual tool
 * Gracefully handles all errors - never fails, captures errors as diagnostic data
 */
async function testTool(workloadId, state, log, context) {
  try {
    const toolIndex = state.toolIndex || 0;
    
    log.debug('Testing tool', { toolIndex, totalTools: TOOL_TESTS.length });
    
    if (toolIndex >= TOOL_TESTS.length) {
      log.debug('All tools tested, moving to analysis phase');
      // All tools tested, move to analysis
      const nextState = {
        ...state,
        currentStep: 'analyze_failures',
        message: 'All tools tested, analyzing results',
        progress: Math.round((toolIndex / (state.totalSteps || TOOL_TESTS.length + 3)) * 100)
      };
      
      try {
        await updateJobStep(workloadId, nextState, log);
      } catch (updateErr) {
        log.error('Could not update job step, continuing', { error: updateErr.message });
      }
      
      return {
        success: true,
        nextStep: 'analyze_failures',
        message: `Completed testing ${TOOL_TESTS.length} tools`
      };
    }
    
    const toolTest = TOOL_TESTS[toolIndex];
    log.info('Testing tool', { tool: toolTest.name, index: toolIndex });
    log.debug('Tool test parameters', { 
      toolName: toolTest.name,
      hasValidTest: !!toolTest.validTest,
      hasEdgeCaseTest: !!toolTest.edgeCaseTest,
      validTestKeys: Object.keys(toolTest.validTest || {}),
      edgeCaseTestKeys: Object.keys(toolTest.edgeCaseTest || {})
    });
    
    const result = {
      tool: toolTest.name,
      validTest: { success: false, error: null, duration: 0 },
      edgeCaseTest: { success: false, error: null, duration: 0 },
      timestamp: new Date().toISOString()
    };
    
    const newFailures = [];
    
    // Test with valid parameters - NEVER throw, always capture errors
    try {
      const start = Date.now();
      const response = await executeToolCall(toolTest.name, toolTest.validTest, log);
      result.validTest.duration = Date.now() - start;
      result.validTest.success = !response.error;
      result.validTest.response = response;
      if (response.error) {
        result.validTest.error = response.error;
        newFailures.push({
          tool: toolTest.name,
          testType: 'valid',
          error: response.error,
          params: toolTest.validTest
        });
      }
    } catch (error) {
      log.warn('Valid test threw exception (captured as diagnostic)', { 
        tool: toolTest.name, 
        error: error.message 
      });
      result.validTest.error = error.message;
      result.validTest.duration = 0;
      newFailures.push({
        tool: toolTest.name,
        testType: 'valid',
        error: error.message,
        params: toolTest.validTest
      });
    }
    
    // Test with edge case parameters - NEVER throw, always capture errors
    try {
      const start = Date.now();
      const response = await executeToolCall(toolTest.name, toolTest.edgeCaseTest, log);
      result.edgeCaseTest.duration = Date.now() - start;
      result.edgeCaseTest.success = !response.error;
      result.edgeCaseTest.response = response;
      if (response.error) {
        result.edgeCaseTest.error = response.error;
        newFailures.push({
          tool: toolTest.name,
          testType: 'edge_case',
          error: response.error,
          params: toolTest.edgeCaseTest
        });
      }
    } catch (error) {
      log.warn('Edge case test threw exception (captured as diagnostic)', { 
        tool: toolTest.name, 
        error: error.message 
      });
      result.edgeCaseTest.error = error.message;
      result.edgeCaseTest.duration = 0;
      newFailures.push({
        tool: toolTest.name,
        testType: 'edge_case',
        error: error.message,
        params: toolTest.edgeCaseTest
      });
    }
    
    // Create immutable state update - defensive with defaults
    const updatedState = {
      ...state,
      results: [...(state.results || []), result],
      failures: [...(state.failures || []), ...newFailures],
      toolIndex: toolIndex + 1,
      progress: Math.round(((toolIndex + 1) / (state.totalSteps || TOOL_TESTS.length + 3)) * 100),
      message: `Tested ${toolTest.name} (${toolIndex + 1}/${TOOL_TESTS.length})`
    };
    
    // Persist state - don't fail if this errors
    try {
      await updateJobStep(workloadId, updatedState, log);
    } catch (updateErr) {
      log.error('Could not persist state, continuing with in-memory state', { 
        error: updateErr.message,
        tool: toolTest.name
      });
    }
    
    log.info('Tool test complete', {
      tool: toolTest.name,
      validSuccess: result.validTest.success,
      edgeCaseSuccess: result.edgeCaseTest.success,
      failures: updatedState.failures.length
    });
    
    return {
      success: true,
      nextStep: 'test_tool',
      currentTool: toolTest.name,
      toolIndex: updatedState.toolIndex,
      totalTools: TOOL_TESTS.length,
      progress: updatedState.progress
    };
  } catch (error) {
    // Ultimate fallback - even if entire test step fails, continue
    log.error('Entire tool test step failed, skipping tool', { 
      error: error.message, 
      stack: error.stack,
      toolIndex: state.toolIndex
    });
    
    const safeToolIndex = (state.toolIndex || 0) + 1;
    const safeTool = TOOL_TESTS[state.toolIndex || 0];
    
    const recoveryState = {
      ...state,
      results: [...(state.results || []), {
        tool: safeTool?.name || 'unknown',
        validTest: { success: false, error: `Fatal error: ${error.message}`, duration: 0 },
        edgeCaseTest: { success: false, error: `Skipped due to fatal error`, duration: 0 },
        timestamp: new Date().toISOString()
      }],
      failures: [...(state.failures || []), {
        tool: safeTool?.name || 'unknown',
        testType: 'fatal',
        error: `Fatal testing error: ${error.message}`,
        params: {}
      }],
      toolIndex: safeToolIndex,
      progress: Math.round((safeToolIndex / (state.totalSteps || TOOL_TESTS.length + 3)) * 100),
      message: `Error testing tool, continuing (${safeToolIndex}/${TOOL_TESTS.length})`
    };
    
    try {
      await updateJobStep(workloadId, recoveryState, log);
    } catch (updateErr) {
      log.error('Could not persist recovery state', { error: updateErr.message });
    }
    
    return {
      success: true, // Continue despite error
      nextStep: safeToolIndex >= TOOL_TESTS.length ? 'analyze_failures' : 'test_tool',
      currentTool: safeTool?.name || 'unknown',
      toolIndex: safeToolIndex,
      totalTools: TOOL_TESTS.length,
      progress: recoveryState.progress,
      warning: 'Tool test encountered fatal error but continued'
    };
  }
}

/**
 * Step N+1: Analyze failures
 * Gracefully handles all errors - never fails, always completes
 */
async function analyzeFailures(workloadId, state, log, context) {
  try {
    // Defensive: ensure failures array exists
    const failures = state.failures || [];
    
    log.info('Analyzing failures', { failureCount: failures.length });
    
    // Categorize failures
    const categorized = {
      network_error: [],
      database_error: [],
      invalid_parameters: [],
      no_data: [],
      token_limit: [],
      circuit_open: [],
      unknown: []
    };
    
    // Gracefully handle each failure
    failures.forEach(failure => {
      try {
        const errorMsg = (failure.error || '').toLowerCase();
        
        if (errorMsg.includes('network') || errorMsg.includes('timeout') || errorMsg.includes('econnrefused')) {
          categorized.network_error.push(failure);
        } else if (errorMsg.includes('mongodb') || errorMsg.includes('database') || errorMsg.includes('collection')) {
          categorized.database_error.push(failure);
        } else if (errorMsg.includes('invalid') || errorMsg.includes('required') || errorMsg.includes('parameter')) {
          categorized.invalid_parameters.push(failure);
        } else if (errorMsg.includes('not found') || errorMsg.includes('no data') || errorMsg.includes('empty')) {
          categorized.no_data.push(failure);
        } else if (errorMsg.includes('token') && errorMsg.includes('limit')) {
          categorized.token_limit.push(failure);
        } else if (errorMsg.includes('circuit') && errorMsg.includes('open')) {
          categorized.circuit_open.push(failure);
        } else {
          categorized.unknown.push(failure);
        }
      } catch (err) {
        log.warn('Error categorizing individual failure', { error: err.message, failure });
        categorized.unknown.push(failure);
      }
    });
    
    // Update state with results
    const updatedState = {
      ...state,
      categorizedFailures: categorized,
      currentStep: 'submit_feedback',
      message: 'Failures analyzed, preparing feedback submissions',
      progress: Math.round(((TOOL_TESTS.length + 1) / (state.totalSteps || TOOL_TESTS.length + 3)) * 100)
    };
    
    await updateJobStep(workloadId, updatedState, log);
    
    log.info('Failure analysis complete', {
      categories: Object.keys(categorized).map(cat => `${cat}: ${categorized[cat].length}`)
    });
    
    return {
      success: true,
      nextStep: 'submit_feedback',
      categorized
    };
  } catch (error) {
    // Even if analysis fails, continue to next step
    log.error('Error during failure analysis, continuing anyway', { error: error.message, stack: error.stack });
    
    const safeState = {
      ...state,
      categorizedFailures: { unknown: state.failures || [] },
      currentStep: 'submit_feedback',
      message: 'Failure analysis had errors, continuing with best effort',
      progress: Math.round(((TOOL_TESTS.length + 1) / (state.totalSteps || TOOL_TESTS.length + 3)) * 100),
      analysisError: error.message
    };
    
    try {
      await updateJobStep(workloadId, safeState, log);
    } catch (updateErr) {
      log.error('Could not update job step, continuing', { error: updateErr.message });
    }
    
    return {
      success: true, // Continue despite error
      nextStep: 'submit_feedback',
      categorized: { unknown: state.failures || [] },
      warning: 'Analysis encountered errors but continued'
    };
  }
}

/**
 * Step N+2: Submit feedback for failures
 * Gracefully handles all errors - never fails, continues with best effort
 */
async function submitFeedbackForFailures(workloadId, state, log, context) {
  try {
    log.info('Submitting feedback for failures');
    
    const { submitFeedbackToDatabase } = require('./feedback-manager.cjs');
    const feedbackIds = [];
    
    // Defensive: ensure categorizedFailures exists
    const categorizedFailures = state.categorizedFailures || {};
    
    // Submit one feedback item per unique failure category
    for (const [category, failures] of Object.entries(categorizedFailures)) {
      if (!failures || failures.length === 0) continue;
      
      try {
        const toolsAffected = [...new Set(failures.map(f => f.tool || 'unknown'))];
        
        const feedbackData = {
          systemId: 'diagnostics-system',
          feedbackType: 'bug_report',
          category: getCategoryFromErrorType(category),
          priority: getPriorityFromErrorType(category, failures.length),
          guruSource: 'diagnostics-guru',
          content: {
            title: `Tool Failure: ${category.replace(/_/g, ' ')} (${failures.length} failures)`,
            description: `Diagnostic testing found ${failures.length} ${category.replace(/_/g, ' ')} failures across ${toolsAffected.length} tools.\n\n**Affected Tools:**\n${toolsAffected.map(t => `- ${t}`).join('\n')}\n\n**Sample Errors:**\n${failures.slice(0, 3).map(f => `- ${f.tool || 'unknown'} (${f.testType || 'unknown'}): ${f.error || 'No error message'}`).join('\n')}`,
            rationale: `These failures impact insights generation quality and may prevent users from getting accurate analysis.`,
            implementation: getImplementationSuggestion(category),
            expectedBenefit: `Improved tool reliability, better insights quality, reduced error rates`,
            estimatedEffort: getEstimatedEffort(category),
            codeSnippets: [],
            affectedComponents: toolsAffected
          }
        };
        
        try {
          const result = await submitFeedbackToDatabase(feedbackData, context);
          feedbackIds.push({
            category,
            feedbackId: result.id,
            isDuplicate: result.isDuplicate,
            failureCount: failures.length
          });
          log.info('Feedback submitted', { category, feedbackId: result.id, isDuplicate: result.isDuplicate });
        } catch (error) {
          log.error('Failed to submit feedback for category, continuing', { category, error: error.message });
          feedbackIds.push({
            category,
            feedbackId: null,
            error: error.message,
            failureCount: failures.length
          });
        }
      } catch (categoryErr) {
        log.error('Error processing category, skipping', { category, error: categoryErr.message });
      }
    }
    
    const updatedState = {
      ...state,
      feedbackSubmitted: feedbackIds,
      currentStep: 'finalize',
      message: 'Feedback submitted, finalizing diagnostics',
      progress: Math.round(((TOOL_TESTS.length + 2) / (state.totalSteps || TOOL_TESTS.length + 3)) * 100)
    };
    
    try {
      await updateJobStep(workloadId, updatedState, log);
    } catch (updateErr) {
      log.error('Could not update job step, continuing', { error: updateErr.message });
    }
    
    return {
      success: true,
      nextStep: 'finalize',
      feedbackSubmitted: feedbackIds
    };
  } catch (error) {
    // Even if feedback submission fails entirely, continue to finalization
    log.error('Error during feedback submission, continuing to finalize', { 
      error: error.message, 
      stack: error.stack 
    });
    
    const safeState = {
      ...state,
      feedbackSubmitted: [],
      currentStep: 'finalize',
      message: 'Feedback submission had errors, finalizing anyway',
      progress: Math.round(((TOOL_TESTS.length + 2) / (state.totalSteps || TOOL_TESTS.length + 3)) * 100),
      feedbackError: error.message
    };
    
    try {
      await updateJobStep(workloadId, safeState, log);
    } catch (updateErr) {
      log.error('Could not update job step, continuing', { error: updateErr.message });
    }
    
    return {
      success: true, // Continue despite error
      nextStep: 'finalize',
      feedbackSubmitted: [],
      warning: 'Feedback submission encountered errors but continued'
    };
  }
}

/**
 * Step N+3: Finalize diagnostics
 * Gracefully handles all errors - always completes with summary
 */
async function finalizeDiagnostics(workloadId, state, log, context) {
  try {
    log.info('Finalizing diagnostics');
    
    // Defensive defaults
    const results = state.results || [];
    const feedbackSubmitted = state.feedbackSubmitted || [];
    const categorizedFailures = state.categorizedFailures || {};
    const startTime = state.startTime || Date.now();
    
    let totalTests = 0;
    let passedTests = 0;
    
    // Safe calculation with error handling for each result
    results.forEach(r => {
      try {
        if (r.validTest) {
          totalTests++;
          if (r.validTest.success) passedTests++;
        }
        if (r.edgeCaseTest) {
          totalTests++;
          if (r.edgeCaseTest.success) passedTests++;
        }
      } catch (err) {
        log.warn('Error counting test result', { tool: r.tool, error: err.message });
      }
    });
    
    const summary = {
      totalToolsTested: results.length,
      totalTests,
      passedTests,
      failedTests: totalTests - passedTests,
      failureRate: totalTests > 0 ? ((totalTests - passedTests) / totalTests * 100).toFixed(1) + '%' : '0%',
      averageResponseTime: calculateAverageResponseTime(results),
      categorizedFailures,
      feedbackSubmitted,
      duration: Date.now() - startTime,
      completedAt: new Date().toISOString(),
      errors: {
        analysisError: state.analysisError || null,
        feedbackError: state.feedbackError || null
      }
    };
    
    const finalState = {
      ...state,
      summary,
      progress: 100,
      message: 'Diagnostics complete'
    };
    
    // Safe completion
    try {
      await completeJob(workloadId, {
        insights: `## Diagnostics Summary\n\n**Pass Rate:** ${passedTests}/${totalTests} (${totalTests > 0 ? (passedTests/totalTests*100).toFixed(1) : '0'}%)\n\n**Failures:** ${totalTests - passedTests}\n**Feedback Items:** ${feedbackSubmitted.length}\n**Duration:** ${(summary.duration/1000).toFixed(1)}s\n\n${summary.errors.analysisError ? '⚠️ Analysis had errors\n' : ''}${summary.errors.feedbackError ? '⚠️ Feedback submission had errors\n' : ''}`,
        state: finalState
      }, log);
    } catch (completeErr) {
      log.error('Could not mark job as complete, trying manual update', { error: completeErr.message });
      try {
        await updateJobStep(workloadId, finalState, log);
      } catch (updateErr) {
        log.error('Could not update final state', { error: updateErr.message });
      }
    }
    
    log.info('Diagnostics complete', summary);
    
    return {
      success: true,
      complete: true,
      summary
    };
  } catch (error) {
    // Even finalization errors should not fail - return best effort summary
    log.error('Error during finalization, returning best effort summary', { 
      error: error.message, 
      stack: error.stack 
    });
    
    const emergencySummary = {
      totalToolsTested: (state.results || []).length,
      totalTests: 'unknown',
      passedTests: 'unknown',
      failedTests: 'unknown',
      failureRate: 'unknown',
      averageResponseTime: 'unknown',
      categorizedFailures: state.categorizedFailures || {},
      feedbackSubmitted: state.feedbackSubmitted || [],
      duration: Date.now() - (state.startTime || Date.now()),
      completedAt: new Date().toISOString(),
      errors: {
        analysisError: state.analysisError || null,
        feedbackError: state.feedbackError || null,
        finalizationError: error.message
      }
    };
    
    // Try to save emergency summary
    try {
      await updateJobStep(workloadId, {
        ...state,
        summary: emergencySummary,
        progress: 100,
        message: 'Diagnostics completed with errors'
      }, log);
    } catch (updateErr) {
      log.error('Could not save emergency summary', { error: updateErr.message });
    }
    
    return {
      success: true, // Report success so process completes
      complete: true,
      summary: emergencySummary,
      warning: 'Finalization encountered errors but completed'
    };
  }
}

/**
 * Helper: Map error type to feedback category
 */
function getCategoryFromErrorType(errorType) {
  const mapping = {
    network_error: 'integration',
    database_error: 'data_structure',
    invalid_parameters: 'data_structure',
    no_data: 'analytics',
    token_limit: 'performance',
    circuit_open: 'performance',
    unknown: 'analytics'
  };
  return mapping[errorType] || 'analytics';
}

/**
 * Helper: Determine priority from error type and count
 */
function getPriorityFromErrorType(errorType, count) {
  if (errorType === 'database_error' || errorType === 'network_error') return 'critical';
  if (count > 3) return 'high';
  if (count > 1) return 'medium';
  return 'low';
}

/**
 * Helper: Get implementation suggestion
 */
function getImplementationSuggestion(errorType) {
  const suggestions = {
    network_error: 'Add retry logic with exponential backoff. Increase timeout thresholds.',
    database_error: 'Check MongoDB connection health. Add connection pooling. Verify indexes.',
    invalid_parameters: 'Improve parameter validation. Add better error messages. Update tool definitions.',
    no_data: 'Add data availability checks. Provide more helpful "no data" messages.',
    token_limit: 'Implement data sampling for large queries. Add pagination support.',
    circuit_open: 'Review circuit breaker thresholds. Add better cooldown mechanisms.',
    unknown: 'Add more detailed error logging. Categorize error types better.'
  };
  return suggestions[errorType] || 'Investigate root cause and implement appropriate fix.';
}

/**
 * Helper: Estimate effort
 */
function getEstimatedEffort(errorType) {
  if (errorType === 'database_error' || errorType === 'network_error') return 'days';
  if (errorType === 'invalid_parameters') return 'hours';
  return 'days';
}

/**
 * Helper: Calculate average response time
 */
/**
 * Helper: Calculate average response time
 * Gracefully handles missing or invalid data
 */
function calculateAverageResponseTime(results) {
  try {
    if (!results || results.length === 0) return 'N/A';
    
    let totalDuration = 0;
    let count = 0;
    
    results.forEach(r => {
      try {
        if (r && r.validTest && typeof r.validTest.duration === 'number' && r.validTest.duration > 0) {
          totalDuration += r.validTest.duration;
          count++;
        }
        if (r && r.edgeCaseTest && typeof r.edgeCaseTest.duration === 'number' && r.edgeCaseTest.duration > 0) {
          totalDuration += r.edgeCaseTest.duration;
          count++;
        }
      } catch (err) {
        // Skip invalid results
      }
    });
    
    return count > 0 ? Math.round(totalDuration / count) + 'ms' : 'N/A';
  } catch (error) {
    return 'Error';
  }
}

module.exports = {
  initializeDiagnostics,
  testTool,
  analyzeFailures,
  submitFeedbackForFailures,
  finalizeDiagnostics,
  TOOL_TESTS
};
