/**
 * Diagnostics Steps - Step Implementations for Async Workload
 * 
 * Each function represents a step in the diagnostics workload.
 * Steps are independently retryable and persist state.
 */

const { executeToolCall, toolDefinitions } = require('./gemini-tools.cjs');
const { createInsightsJob, updateJobStep, completeJob, failJob } = require('./insights-jobs.cjs');

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
    validTest: { latitude: 40.7128, longitude: -74.0060, panelWattage: 400, panelCount: 10 },
    edgeCaseTest: { latitude: -90, longitude: 180, panelWattage: 100, panelCount: 1 }
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
 */
async function initializeDiagnostics(log, context) {
  log.info('Initializing diagnostics workload');
  
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
  
  await createInsightsJob({
    jobId,
    mode: 'diagnostics',
    systemId: 'diagnostics-system',
    customPrompt: 'Diagnostic self-test',
    state: initialState,
    status: 'pending'
  }, log);
  
  log.info('Diagnostics workload initialized', { jobId, totalSteps: initialState.totalSteps });
  
  return {
    workloadId: jobId,
    nextStep: 'test_tool',
    totalSteps: initialState.totalSteps
  };
}

/**
 * Step 2-N: Test individual tool
 */
async function testTool(workloadId, state, log, context) {
  const toolIndex = state.toolIndex || 0;
  
  if (toolIndex >= TOOL_TESTS.length) {
    // All tools tested, move to analysis
    await updateJobStep(workloadId, {
      currentStep: 'analyze_failures',
      message: 'All tools tested, analyzing results',
      progress: Math.round((toolIndex / state.totalSteps) * 100)
    }, log);
    
    return {
      success: true,
      nextStep: 'analyze_failures',
      message: `Completed testing ${TOOL_TESTS.length} tools`
    };
  }
  
  const toolTest = TOOL_TESTS[toolIndex];
  log.info('Testing tool', { tool: toolTest.name, index: toolIndex });
  
  const result = {
    tool: toolTest.name,
    validTest: { success: false, error: null, duration: 0 },
    edgeCaseTest: { success: false, error: null, duration: 0 },
    timestamp: new Date().toISOString()
  };
  
  // Test with valid parameters
  try {
    const start = Date.now();
    const response = await executeToolCall(toolTest.name, toolTest.validTest, log);
    result.validTest.duration = Date.now() - start;
    result.validTest.success = !response.error;
    result.validTest.response = response;
    if (response.error) {
      result.validTest.error = response.error;
      state.failures.push({
        tool: toolTest.name,
        testType: 'valid',
        error: response.error,
        params: toolTest.validTest
      });
    }
  } catch (error) {
    result.validTest.error = error.message;
    result.validTest.duration = 0;
    state.failures.push({
      tool: toolTest.name,
      testType: 'valid',
      error: error.message,
      params: toolTest.validTest
    });
  }
  
  // Test with edge case parameters
  try {
    const start = Date.now();
    const response = await executeToolCall(toolTest.name, toolTest.edgeCaseTest, log);
    result.edgeCaseTest.duration = Date.now() - start;
    result.edgeCaseTest.success = !response.error;
    result.edgeCaseTest.response = response;
    if (response.error) {
      result.edgeCaseTest.error = response.error;
      state.failures.push({
        tool: toolTest.name,
        testType: 'edge_case',
        error: response.error,
        params: toolTest.edgeCaseTest
      });
    }
  } catch (error) {
    result.edgeCaseTest.error = error.message;
    result.edgeCaseTest.duration = 0;
    state.failures.push({
      tool: toolTest.name,
      testType: 'edge_case',
      error: error.message,
      params: toolTest.edgeCaseTest
    });
  }
  
  state.results.push(result);
  state.toolIndex = toolIndex + 1;
  state.progress = Math.round((state.toolIndex / state.totalSteps) * 100);
  state.message = `Tested ${toolTest.name} (${state.toolIndex}/${TOOL_TESTS.length})`;
  
  // Persist state
  await updateJobStep(workloadId, state, log);
  
  log.info('Tool test complete', {
    tool: toolTest.name,
    validSuccess: result.validTest.success,
    edgeCaseSuccess: result.edgeCaseTest.success,
    failures: state.failures.length
  });
  
  return {
    success: true,
    nextStep: 'test_tool',
    currentTool: toolTest.name,
    toolIndex: state.toolIndex,
    totalTools: TOOL_TESTS.length,
    progress: state.progress
  };
}

/**
 * Step N+1: Analyze failures
 */
async function analyzeFailures(workloadId, state, log, context) {
  log.info('Analyzing failures', { failureCount: state.failures.length });
  
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
  
  state.failures.forEach(failure => {
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
  });
  
  state.categorizedFailures = categorized;
  state.currentStep = 'submit_feedback';
  state.message = 'Failures analyzed, preparing feedback submissions';
  state.progress = Math.round(((TOOL_TESTS.length + 1) / state.totalSteps) * 100);
  
  await updateJobStep(workloadId, state, log);
  
  log.info('Failure analysis complete', {
    categories: Object.keys(categorized).map(cat => `${cat}: ${categorized[cat].length}`)
  });
  
  return {
    success: true,
    nextStep: 'submit_feedback',
    categorized
  };
}

/**
 * Step N+2: Submit feedback for failures
 */
async function submitFeedbackForFailures(workloadId, state, log, context) {
  log.info('Submitting feedback for failures');
  
  const { submitFeedbackToDatabase } = require('./feedback-manager.cjs');
  const feedbackIds = [];
  
  // Submit one feedback item per unique failure category
  for (const [category, failures] of Object.entries(state.categorizedFailures || {})) {
    if (failures.length === 0) continue;
    
    const toolsAffected = [...new Set(failures.map(f => f.tool))];
    
    const feedbackData = {
      systemId: 'diagnostics-system',
      feedbackType: 'bug_report',
      category: getCategoryFromErrorType(category),
      priority: getPriorityFromErrorType(category, failures.length),
      guruSource: 'diagnostics-guru',
      content: {
        title: `Tool Failure: ${category.replace(/_/g, ' ')} (${failures.length} failures)`,
        description: `Diagnostic testing found ${failures.length} ${category.replace(/_/g, ' ')} failures across ${toolsAffected.length} tools.\n\n**Affected Tools:**\n${toolsAffected.map(t => `- ${t}`).join('\n')}\n\n**Sample Errors:**\n${failures.slice(0, 3).map(f => `- ${f.tool} (${f.testType}): ${f.error}`).join('\n')}`,
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
      log.error('Failed to submit feedback', { category, error: error.message });
    }
  }
  
  state.feedbackSubmitted = feedbackIds;
  state.currentStep = 'finalize';
  state.message = 'Feedback submitted, finalizing diagnostics';
  state.progress = Math.round(((TOOL_TESTS.length + 2) / state.totalSteps) * 100);
  
  await updateJobStep(workloadId, state, log);
  
  return {
    success: true,
    nextStep: 'finalize',
    feedbackSubmitted: feedbackIds
  };
}

/**
 * Step N+3: Finalize diagnostics
 */
async function finalizeDiagnostics(workloadId, state, log, context) {
  log.info('Finalizing diagnostics');
  
  const totalTests = state.results.length * 2; // valid + edge case
  const passedTests = state.results.reduce((acc, r) => {
    return acc + (r.validTest.success ? 1 : 0) + (r.edgeCaseTest.success ? 1 : 0);
  }, 0);
  
  const summary = {
    totalToolsTested: state.results.length,
    totalTests,
    passedTests,
    failedTests: totalTests - passedTests,
    failureRate: ((totalTests - passedTests) / totalTests * 100).toFixed(1) + '%',
    averageResponseTime: calculateAverageResponseTime(state.results),
    categorizedFailures: state.categorizedFailures,
    feedbackSubmitted: state.feedbackSubmitted,
    duration: Date.now() - state.startTime,
    completedAt: new Date().toISOString()
  };
  
  state.summary = summary;
  state.progress = 100;
  state.message = 'Diagnostics complete';
  
  await completeJob(workloadId, {
    insights: `## Diagnostics Summary\n\n**Pass Rate:** ${passedTests}/${totalTests} (${(passedTests/totalTests*100).toFixed(1)}%)\n\n**Failures:** ${totalTests - passedTests}\n**Feedback Items:** ${state.feedbackSubmitted.length}\n**Duration:** ${(summary.duration/1000).toFixed(1)}s`,
    state
  }, log);
  
  log.info('Diagnostics complete', summary);
  
  return {
    success: true,
    complete: true,
    summary
  };
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
function calculateAverageResponseTime(results) {
  let totalDuration = 0;
  let count = 0;
  
  results.forEach(r => {
    if (r.validTest.duration > 0) {
      totalDuration += r.validTest.duration;
      count++;
    }
    if (r.edgeCaseTest.duration > 0) {
      totalDuration += r.edgeCaseTest.duration;
      count++;
    }
  });
  
  return count > 0 ? Math.round(totalDuration / count) + 'ms' : 'N/A';
}

module.exports = {
  initializeDiagnostics,
  testTool,
  analyzeFailures,
  submitFeedbackForFailures,
  finalizeDiagnostics,
  TOOL_TESTS
};
