# System Diagnostics Enhancement - Complete Documentation

## Overview

The admin-diagnostics endpoint has been significantly enhanced to provide comprehensive testing capabilities for all 23 Netlify functions in the BMSview application. This enhancement ensures robust system monitoring, debugging, and maintenance capabilities.

## Key Features

### 1. Comprehensive Test Coverage
- **25 Total Tests** covering all critical system functions
- **8 Test Categories** for logical organization
- **Selective Testing** - Run individual tests or test categories
- **Parallel Execution** support for faster diagnostics
- **Automatic Cleanup** of test data

### 2. Enhanced Logging
Every test function includes:
- Test start/end timestamps
- Input parameters and validation details
- Response data structures and status codes
- Complete error messages with stack traces
- Performance metrics (response times, durations)
- Resource usage and data counts
- Request/response correlation IDs

### 3. Intelligent Error Handling
- Graceful handling of missing configurations
- Timeout protection for long-running tests
- Circuit breaker patterns for external services
- Detailed failure diagnostics with actionable suggestions
- Automatic test data cleanup on failure

## Test Categories

### Infrastructure Tests (2 tests)
Critical system dependencies:
- **database** - MongoDB connection and operations
- **gemini** - Google Gemini AI API connectivity

### Core Analysis Functions (5 tests)
Primary image analysis pipeline:
- **analyze** - Main analysis endpoint (synchronous mode)
- **syncAnalysis** - Synchronous analysis pipeline
- **asyncAnalysis** - Asynchronous analysis pipeline
- **processAnalysis** - Background job processing
- **extractDL** - Data extraction from images

### Insights Generation (3 tests)
AI-powered battery insights:
- **generateInsights** - Standard insights generation
- **insightsWithTools** - Enhanced mode with function calling
- **debugInsights** - Debug mode insights

### Data Management (4 tests)
CRUD operations and data access:
- **history** - Historical data retrieval
- **systems** - System management
- **data** - General data access
- **exportData** - CSV/JSON export functionality

### Job Management (2 tests)
Asynchronous job processing:
- **getJobStatus** - Job status tracking
- **jobShepherd** - Job lifecycle management

### External Services (3 tests)
Third-party integrations:
- **weather** - Weather data API
- **solar** - Solar estimation service
- **systemAnalytics** - System analytics aggregation

### Utility & Admin (7 tests)
Supporting functionality:
- **contact** - Email contact form
- **getIP** - IP address detection
- **upload** - File upload handling
- **security** - Security checks
- **predictiveMaintenance** - Predictive analytics
- **ipAdmin** - IP whitelist management
- **adminSystems** - Admin system operations

### Comprehensive Suite (1 test)
- **comprehensive** - Production test suite integration

## API Usage

### Endpoint
```
POST /.netlify/functions/admin-diagnostics
```

### Run All Tests
```bash
curl -X POST https://your-domain/.netlify/functions/admin-diagnostics
```

### Run Specific Test Category
```bash
curl -X POST https://your-domain/.netlify/functions/admin-diagnostics \
  -H "Content-Type: application/json" \
  -d '{"test": "database"}'
```

### Run Multiple Selected Tests
```bash
curl -X POST https://your-domain/.netlify/functions/admin-diagnostics \
  -H "Content-Type: application/json" \
  -d '{
    "selectedTests": ["database", "gemini", "analyze"]
  }'
```

### Run Tests by Category
```bash
# Infrastructure tests
curl -X POST https://your-domain/.netlify/functions/admin-diagnostics \
  -H "Content-Type: application/json" \
  -d '{"selectedTests": ["database", "gemini"]}'

# Core analysis tests
curl -X POST https://your-domain/.netlify/functions/admin-diagnostics \
  -H "Content-Type: application/json" \
  -d '{"selectedTests": ["analyze", "syncAnalysis", "asyncAnalysis", "processAnalysis", "extractDL"]}'
```

## Response Format

### Success Response
```json
{
  "database": {
    "status": "Success",
    "message": "Database connection successful",
    "responseTime": 123
  },
  "analyze": {
    "status": "Success",
    "message": "Analyze endpoint working correctly",
    "responseTime": 456,
    "recordId": "abc-123",
    "data": {
      "statusCode": 200,
      "hasAnalysis": true
    }
  },
  "testSummary": {
    "total": 25,
    "success": 24,
    "failure": 0,
    "skipped": 1,
    "successRate": "96.00"
  },
  "availableTests": {
    "infrastructure": ["database", "gemini"],
    "coreAnalysis": ["analyze", "syncAnalysis", "asyncAnalysis", "processAnalysis", "extractDL"],
    "insights": ["generateInsights", "insightsWithTools", "debugInsights"],
    "dataManagement": ["history", "systems", "data", "exportData"],
    "jobManagement": ["getJobStatus", "jobShepherd"],
    "externalServices": ["weather", "solar", "systemAnalytics"],
    "utilityAdmin": ["contact", "getIP", "upload", "security", "predictiveMaintenance", "ipAdmin", "adminSystems"],
    "comprehensive": ["comprehensive"]
  },
  "suggestions": []
}
```

### Failure Response
```json
{
  "database": {
    "status": "Failure",
    "message": "Connection timeout after 5000ms"
  },
  "gemini": {
    "status": "Failure",
    "message": "GEMINI_API_KEY environment variable not set"
  },
  "testSummary": {
    "total": 2,
    "success": 0,
    "failure": 2,
    "skipped": 0,
    "successRate": "0.00"
  },
  "suggestions": [
    "Check MONGODB_URI and network connectivity to your MongoDB host.",
    "Set GEMINI_API_KEY env var or check that the generative-ai client is installed."
  ]
}
```

## Test Result States

### Success
Test completed successfully without errors.
```json
{
  "status": "Success",
  "message": "Test description",
  "responseTime": 150,
  "data": { /* additional context */ }
}
```

### Failure
Test encountered an error or unexpected response.
```json
{
  "status": "Failure",
  "message": "Error description",
  "duration": 100,
  "details": { /* error context */ }
}
```

### Skipped
Test was skipped due to missing prerequisites.
```json
{
  "status": "Skipped",
  "message": "Reason for skipping",
  "duration": 10
}
```

## Logging Format

All diagnostic tests use structured JSON logging:

```json
{
  "timestamp": "2025-11-06T00:14:05.123Z",
  "level": "INFO",
  "function": "admin-diagnostics",
  "requestId": "abc-123",
  "elapsed": "150ms",
  "message": "Database connection test completed successfully.",
  "duration": 150,
  "statusCode": 200
}
```

### Log Levels
- **DEBUG**: Detailed operation steps
- **INFO**: General operational information
- **WARN**: Warning conditions (non-critical)
- **ERROR**: Error conditions with full context
- **CRITICAL**: Critical failures requiring immediate attention

## Performance Metrics

Each test tracks:
- **Response Time**: Time to receive response from endpoint
- **Total Duration**: Complete test execution time including setup/teardown
- **Status Code**: HTTP response status
- **Data Counts**: Number of records/items processed

## Error Diagnostics

### Common Failure Scenarios

#### Database Connection Failure
```
Status: Failure
Message: "MongoNetworkError: connect ECONNREFUSED"
Suggestion: "Check MONGODB_URI and network connectivity to your MongoDB host."
```

#### API Key Missing
```
Status: Failure
Message: "GEMINI_API_KEY environment variable not set"
Suggestion: "Set GEMINI_API_KEY env var or check that the generative-ai client is installed."
```

#### Timeout
```
Status: Failure
Message: "Request timeout after 5000ms"
Duration: 5100ms
```

#### Service Unavailable
```
Status: Failure
Message: "Weather service returned status: 503"
Details: { "statusCode": 503 }
```

## Best Practices

### When to Run Diagnostics
1. **After Deployment** - Verify all services are operational
2. **Scheduled Monitoring** - Run periodically (e.g., every hour)
3. **Before Maintenance** - Establish baseline before changes
4. **Troubleshooting** - Diagnose specific service issues
5. **Performance Testing** - Monitor response times

### Interpreting Results
1. **Success Rate < 90%** - Investigation required
2. **Response Time > 5s** - Performance degradation
3. **Multiple Skipped Tests** - Configuration issues
4. **Consistent Failures** - System-wide problem

### Security Considerations
1. Diagnostics endpoint should be **admin-only**
2. Results may contain **sensitive information**
3. Rate limit diagnostic requests
4. Log all diagnostic executions for audit
5. Monitor for diagnostic endpoint abuse

## Integration Examples

### CI/CD Pipeline
```yaml
# .github/workflows/post-deploy.yml
- name: Run System Diagnostics
  run: |
    RESULT=$(curl -X POST ${{ secrets.APP_URL }}/.netlify/functions/admin-diagnostics)
    SUCCESS_RATE=$(echo $RESULT | jq -r '.testSummary.successRate')
    if (( $(echo "$SUCCESS_RATE < 90" | bc -l) )); then
      echo "Diagnostics failed with $SUCCESS_RATE% success rate"
      exit 1
    fi
```

### Monitoring Dashboard
```javascript
// Periodic health check
setInterval(async () => {
  const response = await fetch('/.netlify/functions/admin-diagnostics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      selectedTests: ['database', 'gemini', 'analyze'] 
    })
  });
  
  const results = await response.json();
  updateHealthDashboard(results);
}, 60000); // Every minute
```

### Alerting
```javascript
// Alert on failures
async function checkSystemHealth() {
  const response = await fetch('/.netlify/functions/admin-diagnostics', {
    method: 'POST'
  });
  
  const results = await response.json();
  
  if (results.testSummary.failure > 0) {
    await sendAlert({
      severity: 'HIGH',
      message: `${results.testSummary.failure} diagnostic tests failed`,
      details: results.suggestions
    });
  }
}
```

## Troubleshooting Guide

### Test Takes Too Long
- **Cause**: Network latency or slow external services
- **Solution**: Check network connectivity, review service logs
- **Threshold**: Most tests should complete in < 5 seconds

### Test Randomly Fails
- **Cause**: Race condition or timing issue
- **Solution**: Review test implementation, add retries
- **Pattern**: Look for timing-dependent operations

### All Tests Fail
- **Cause**: System-wide issue (database, network)
- **Solution**: Check infrastructure health, environment variables
- **Priority**: HIGH - requires immediate attention

### Skipped Tests Increase
- **Cause**: Missing configuration or prerequisites
- **Solution**: Review environment setup, check dependencies
- **Impact**: May indicate deployment issues

## Future Enhancements

### Planned Features
1. **Historical Trending** - Track test results over time
2. **Performance Benchmarking** - Compare against baselines
3. **Automated Alerting** - Email/Slack notifications on failures
4. **Test Scheduling** - Cron-based automated testing
5. **Load Testing** - Simulate high-traffic scenarios
6. **Custom Test Suites** - User-defined test collections

### Potential Improvements
1. Add retry logic for flaky tests
2. Implement test result caching
3. Add GraphQL query support
4. Create visual test dashboard
5. Add webhook notifications
6. Support test result export

## Support

### Getting Help
- Review logs in Netlify Functions dashboard
- Check environment variable configuration
- Verify network connectivity to external services
- Review recent deployments for breaking changes

### Reporting Issues
When reporting diagnostic failures, include:
1. Complete test results JSON
2. Function logs from Netlify
3. Time of failure
4. Recent deployment history
5. Environment configuration (sanitized)

## Conclusion

This enhanced diagnostic system provides comprehensive visibility into all BMSview functions, enabling proactive monitoring, faster debugging, and improved system reliability. The structured logging and categorized testing approach make it easy to identify and resolve issues quickly.

For questions or support, please refer to the BMSview documentation or contact the development team.
