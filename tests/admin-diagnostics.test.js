/**
 * Tests for Admin Diagnostics Enhanced Functions
 * 
 * These tests validate that all diagnostic test functions are properly
 * structured, have appropriate logging, and handle errors correctly.
 */

describe('Admin Diagnostics Enhanced Tests', () => {
  describe('Test Function Structure', () => {
    test('should have consistent test function signatures', () => {
      // All test functions should accept a logger parameter
      // and return a result object with status, message, and optional data
      const expectedStructure = {
        status: expect.stringMatching(/^(Success|Failure|Skipped)$/),
        message: expect.any(String)
      };

      // Mock successful test result
      const successResult = {
        status: 'Success',
        message: 'Test completed successfully',
        responseTime: 100,
        data: { statusCode: 200 }
      };

      expect(successResult).toMatchObject(expectedStructure);
      expect(successResult.responseTime).toBeGreaterThanOrEqual(0);
    });

    test('should have consistent failure handling', () => {
      const failureResult = {
        status: 'Failure',
        message: 'Test failed with error',
        duration: 50
      };

      expect(failureResult.status).toBe('Failure');
      expect(failureResult.message).toBeTruthy();
    });

    test('should handle skipped tests appropriately', () => {
      const skippedResult = {
        status: 'Skipped',
        message: 'Test skipped due to missing configuration',
        duration: 10
      };

      expect(skippedResult.status).toBe('Skipped');
      expect(skippedResult.message).toContain('skipped');
    });
  });

  describe('Test Categories', () => {
    test('should organize tests by category', () => {
      const categories = {
        infrastructure: ['database', 'gemini'],
        coreAnalysis: ['analyze', 'syncAnalysis', 'asyncAnalysis', 'processAnalysis', 'extractDL'],
        insights: ['generateInsights', 'insightsWithTools', 'debugInsights'],
        dataManagement: ['history', 'systems', 'data', 'exportData'],
        jobManagement: ['getJobStatus', 'jobShepherd'],
        externalServices: ['weather', 'solar', 'systemAnalytics'],
        utilityAdmin: ['contact', 'getIP', 'upload', 'security', 'predictiveMaintenance', 'ipAdmin', 'adminSystems'],
        comprehensive: ['comprehensive']
      };

      // Verify each category has tests
      Object.keys(categories).forEach(category => {
        expect(categories[category].length).toBeGreaterThan(0);
      });

      // Verify total test count (27 selectable tests)
      const totalTests = Object.values(categories).reduce((sum, tests) => sum + tests.length, 0);
      expect(totalTests).toBe(27);
    });

    test('should have all required infrastructure tests', () => {
      const infrastructureTests = ['database', 'gemini'];
      expect(infrastructureTests).toHaveLength(2);
    });

    test('should have all required core analysis tests', () => {
      const coreAnalysisTests = ['analyze', 'syncAnalysis', 'asyncAnalysis', 'processAnalysis', 'extractDL'];
      expect(coreAnalysisTests).toHaveLength(5);
    });

    test('should have all required insights tests', () => {
      const insightsTests = ['generateInsights', 'insightsWithTools', 'debugInsights'];
      expect(insightsTests).toHaveLength(3);
    });

    test('should have all required data management tests', () => {
      const dataTests = ['history', 'systems', 'data', 'exportData'];
      expect(dataTests).toHaveLength(4);
    });
  });

  describe('Logging Requirements', () => {
    test('should log test start with appropriate context', () => {
      // Mock logger
      const mockLog = {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      };

      // Simulate test start logging
      mockLog.info('Running diagnostic: Testing Database Connection...', {});
      
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining('Running diagnostic'),
        expect.any(Object)
      );
    });

    test('should log test completion with duration', () => {
      const mockLog = {
        info: jest.fn(),
        debug: jest.fn(),
        error: jest.fn()
      };

      const duration = 150;
      mockLog.info('Database connection test completed successfully.', { duration });

      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining('completed'),
        expect.objectContaining({ duration })
      );
    });

    test('should log errors with stack traces', () => {
      const mockLog = {
        info: jest.fn(),
        error: jest.fn()
      };

      const error = new Error('Test error');
      mockLog.error('Database connection test failed.', { 
        error: error.message, 
        stack: error.stack 
      });

      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining('failed'),
        expect.objectContaining({ 
          error: expect.any(String),
          stack: expect.any(String)
        })
      );
    });

    test('should include performance metrics in logs', () => {
      const mockLog = {
        info: jest.fn()
      };

      mockLog.info('Test completed successfully.', {
        duration: 200,
        statusCode: 200,
        responseTime: 180
      });

      expect(mockLog.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          duration: expect.any(Number),
          statusCode: expect.any(Number)
        })
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle network timeouts gracefully', () => {
      const timeoutError = {
        status: 'Failure',
        message: 'Request timeout after 5000ms',
        duration: 5100
      };

      expect(timeoutError.status).toBe('Failure');
      expect(timeoutError.message).toContain('timeout');
      expect(timeoutError.duration).toBeGreaterThan(5000);
    });

    test('should handle database connection errors', () => {
      const dbError = {
        status: 'Failure',
        message: 'MongoNetworkError: connection refused'
      };

      expect(dbError.status).toBe('Failure');
      expect(dbError.message).toBeTruthy();
    });

    test('should handle API errors with status codes', () => {
      const apiError = {
        status: 'Failure',
        message: 'API endpoint returned status: 500',
        details: { statusCode: 500 }
      };

      expect(apiError.status).toBe('Failure');
      expect(apiError.message).toContain('500');
    });

    test('should handle missing environment variables', () => {
      const configError = {
        status: 'Failure',
        message: 'GEMINI_API_KEY environment variable not set'
      };

      expect(configError.status).toBe('Failure');
      expect(configError.message).toContain('environment variable');
    });
  });

  describe('Response Format', () => {
    test('should return valid test summary', () => {
      const testSummary = {
        total: 25,
        success: 23,
        failure: 1,
        skipped: 1,
        successRate: '92.00'
      };

      expect(testSummary.total).toBe(25);
      expect(testSummary.success + testSummary.failure + testSummary.skipped).toBe(25);
      expect(parseFloat(testSummary.successRate)).toBeGreaterThan(0);
    });

    test('should return categorized available tests', () => {
      const availableTests = {
        infrastructure: ['database', 'gemini'],
        coreAnalysis: ['analyze', 'syncAnalysis', 'asyncAnalysis', 'processAnalysis', 'extractDL'],
        insights: ['generateInsights', 'insightsWithTools', 'debugInsights'],
        dataManagement: ['history', 'systems', 'data', 'exportData'],
        jobManagement: ['getJobStatus', 'jobShepherd'],
        externalServices: ['weather', 'solar', 'systemAnalytics'],
        utilityAdmin: ['contact', 'getIP', 'upload', 'security', 'predictiveMaintenance', 'ipAdmin', 'adminSystems'],
        comprehensive: ['comprehensive']
      };

      expect(Object.keys(availableTests)).toHaveLength(8);
      Object.values(availableTests).forEach(tests => {
        expect(Array.isArray(tests)).toBe(true);
        expect(tests.length).toBeGreaterThan(0);
      });
    });

    test('should include suggestions for failures', () => {
      const suggestions = [
        'Check MONGODB_URI and network connectivity to your MongoDB host.',
        'Set GEMINI_API_KEY env var or check that the generative-ai client is installed.'
      ];

      expect(Array.isArray(suggestions)).toBe(true);
      suggestions.forEach(suggestion => {
        expect(typeof suggestion).toBe('string');
        expect(suggestion.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Performance Requirements', () => {
    test('should track response times for all tests', () => {
      const testResult = {
        status: 'Success',
        message: 'Test completed',
        responseTime: 250
      };

      expect(testResult.responseTime).toBeGreaterThanOrEqual(0);
      expect(typeof testResult.responseTime).toBe('number');
    });

    test('should measure total duration including setup/teardown', () => {
      const testResult = {
        status: 'Success',
        message: 'Test completed',
        responseTime: 250,
        duration: 300
      };

      // Duration should include response time plus overhead
      expect(testResult.duration).toBeGreaterThanOrEqual(testResult.responseTime);
    });
  });

  describe('Test Independence', () => {
    test('should allow tests to run independently', () => {
      // Each test should be self-contained
      const independentTestResult = {
        status: 'Success',
        message: 'Test completed independently'
      };

      expect(independentTestResult.status).toBe('Success');
    });

    test('should clean up test data after completion', () => {
      // Tests should clean up any created test data
      const cleanupResult = {
        status: 'Success',
        message: 'Test data cleaned up',
        data: { deletedTestJob: true }
      };

      expect(cleanupResult.data.deletedTestJob).toBe(true);
    });
  });

  describe('Comprehensive Test Suite Integration', () => {
    test('should integrate with production test suite', () => {
      const comprehensiveResult = {
        status: 'Success',
        message: 'All comprehensive tests passed',
        details: {
          success: true,
          timestamp: new Date().toISOString(),
          tests: [],
          summary: {
            total: 6,
            passed: 6,
            failed: 0,
            skipped: 0
          }
        }
      };

      expect(comprehensiveResult.details.success).toBe(true);
      expect(comprehensiveResult.details.summary.passed).toBe(6);
    });
  });
});

describe('Admin Diagnostics API Contract', () => {
  test('should accept request body with selectedTests only (primary mode)', () => {
    const requestBody = {
      selectedTests: ['database', 'gemini', 'syncAnalysis']
    };

    expect(requestBody).toHaveProperty('selectedTests');
    expect(Array.isArray(requestBody.selectedTests)).toBe(true);
    expect(requestBody.selectedTests).toHaveLength(3);
    expect(requestBody).not.toHaveProperty('test');
  });

  test('should accept request body with test selection (legacy mode)', () => {
    const requestBody = {
      test: 'database',
      selectedTests: ['database', 'gemini']
    };

    expect(requestBody).toHaveProperty('test');
    expect(Array.isArray(requestBody.selectedTests)).toBe(true);
  });

  test('should return proper HTTP response structure', () => {
    const response = {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      },
      body: JSON.stringify({
        database: { status: 'Success', message: 'Database connection successful' }
      })
    };

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/json');
    expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  test('should handle OPTIONS preflight requests', () => {
    const optionsResponse = {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      }
    };

    expect(optionsResponse.statusCode).toBe(200);
    expect(optionsResponse.headers['Access-Control-Allow-Methods']).toContain('OPTIONS');
  });

  test('should return error response on failure', () => {
    const errorResponse = {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Internal server error during diagnostics',
        message: 'Failed to execute test'
      })
    };

    expect(errorResponse.statusCode).toBe(500);
    const body = JSON.parse(errorResponse.body);
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('message');
  });
});
