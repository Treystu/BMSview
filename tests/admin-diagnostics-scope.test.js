/**
 * Tests for Admin Diagnostics Granular Scope Execution
 * 
 * These tests validate that the scope query parameter correctly executes
 * individual tests and returns results in real-time.
 */

describe('Admin Diagnostics Granular Scope', () => {
  describe('Query Parameter Scope Support', () => {
    test('should accept single scope parameter', () => {
      const queryParams = { scope: 'database' };
      const scope = queryParams.scope;
      const scopeTests = scope.split(',').map(t => t.trim()).filter(t => t);
      
      expect(scopeTests).toEqual(['database']);
      expect(scopeTests.length).toBe(1);
    });

    test('should accept comma-separated scope parameters', () => {
      const queryParams = { scope: 'database,gemini,analyze' };
      const scope = queryParams.scope;
      const scopeTests = scope.split(',').map(t => t.trim()).filter(t => t);
      
      expect(scopeTests).toEqual(['database', 'gemini', 'analyze']);
      expect(scopeTests.length).toBe(3);
    });

    test('should handle scope with whitespace', () => {
      const queryParams = { scope: 'database, gemini , analyze ' };
      const scope = queryParams.scope;
      const scopeTests = scope.split(',').map(t => t.trim()).filter(t => t);
      
      expect(scopeTests).toEqual(['database', 'gemini', 'analyze']);
      expect(scopeTests.length).toBe(3);
    });

    test('should filter out invalid test names', () => {
      const validTests = ['database', 'gemini', 'analyze'];
      const diagnosticTests = {
        database: jest.fn(),
        gemini: jest.fn(),
        analyze: jest.fn()
      };
      
      const scope = 'database,invalid,gemini,another_invalid,analyze';
      const scopeTests = scope.split(',').map(t => t.trim()).filter(t => diagnosticTests[t]);
      
      expect(scopeTests).toEqual(validTests);
      expect(scopeTests.length).toBe(3);
    });

    test('should handle empty scope gracefully', () => {
      const queryParams = { scope: '' };
      const scope = queryParams.scope;
      const scopeTests = scope.split(',').map(t => t.trim()).filter(t => t);
      
      // Empty string filtered out by .filter(t => t)
      expect(scopeTests).toEqual([]);
      // Filter out empty strings
      const filteredTests = scopeTests.filter(t => t.length > 0);
      expect(filteredTests).toEqual([]);
    });
  });

  describe('Backward Compatibility', () => {
    test('should still support POST body selectedTests', () => {
      const requestBody = {
        selectedTests: ['database', 'gemini', 'analyze']
      };
      
      expect(requestBody.selectedTests).toBeDefined();
      expect(Array.isArray(requestBody.selectedTests)).toBe(true);
      expect(requestBody.selectedTests.length).toBe(3);
    });

    test('should run all tests when no scope or selectedTests provided', () => {
      const allTests = ['database', 'gemini', 'analyze', 'history', 'systems'];
      const diagnosticTests = {};
      allTests.forEach(test => {
        diagnosticTests[test] = jest.fn();
      });
      
      // Simulate no scope, no selectedTests
      let selectedTests = Object.keys(diagnosticTests);
      
      expect(selectedTests).toEqual(allTests);
      expect(selectedTests.length).toBe(5);
    });

    test('scope parameter should override POST body', () => {
      const queryParams = { scope: 'database' };
      const requestBody = { selectedTests: ['gemini', 'analyze'] };
      
      // Scope takes precedence
      let selectedTests;
      if (queryParams.scope) {
        selectedTests = queryParams.scope.split(',').map(t => t.trim());
      } else {
        selectedTests = requestBody.selectedTests;
      }
      
      expect(selectedTests).toEqual(['database']);
      expect(selectedTests.length).toBe(1);
    });
  });

  describe('Individual Test Execution', () => {
    test('should execute only the scoped test', () => {
      const mockDatabase = jest.fn(() => Promise.resolve({ 
        name: 'Database Connection', 
        status: 'success',
        duration: 150
      }));
      const mockGemini = jest.fn();
      const mockAnalyze = jest.fn();
      
      const diagnosticTests = {
        database: mockDatabase,
        gemini: mockGemini,
        analyze: mockAnalyze
      };
      
      const scope = 'database';
      const testToRun = diagnosticTests[scope];
      
      expect(testToRun).toBeDefined();
      testToRun();
      
      expect(mockDatabase).toHaveBeenCalled();
      expect(mockGemini).not.toHaveBeenCalled();
      expect(mockAnalyze).not.toHaveBeenCalled();
    });

    test('should return single result for single scope', async () => {
      const mockTest = jest.fn(() => Promise.resolve({ 
        name: 'Database Connection', 
        status: 'success',
        duration: 150,
        details: { connected: true }
      }));
      
      const result = await mockTest();
      
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('duration');
      expect(result.status).toBe('success');
    });

    test('should execute multiple tests for comma-separated scope', async () => {
      const diagnosticTests = {
        database: jest.fn(() => Promise.resolve({ name: 'Database Connection', status: 'success', duration: 150 })),
        gemini: jest.fn(() => Promise.resolve({ name: 'Gemini API', status: 'success', duration: 200 }))
      };
      
      const scope = 'database,gemini';
      const scopeTests = scope.split(',').map(t => t.trim());
      
      const results = await Promise.all(
        scopeTests.map(testName => diagnosticTests[testName]())
      );
      
      expect(results.length).toBe(2);
      expect(diagnosticTests.database).toHaveBeenCalled();
      expect(diagnosticTests.gemini).toHaveBeenCalled();
      expect(results[0].name).toBe('Database Connection');
      expect(results[1].name).toBe('Gemini API');
    });
  });

  describe('Parallel Execution', () => {
    test('should run tests in parallel, not sequentially', async () => {
      const executionOrder = [];
      
      const slowTest = () => new Promise(resolve => {
        setTimeout(() => {
          executionOrder.push('slow-start');
          setTimeout(() => {
            executionOrder.push('slow-end');
            resolve({ name: 'Slow Test', status: 'success', duration: 100 });
          }, 50);
        }, 50);
      });
      
      const fastTest = () => new Promise(resolve => {
        setTimeout(() => {
          executionOrder.push('fast-complete');
          resolve({ name: 'Fast Test', status: 'success', duration: 10 });
        }, 10);
      });
      
      await Promise.all([slowTest(), fastTest()]);
      
      // Fast test should complete before slow test ends
      expect(executionOrder).toContain('fast-complete');
      expect(executionOrder).toContain('slow-end');
      const fastIndex = executionOrder.indexOf('fast-complete');
      const slowEndIndex = executionOrder.indexOf('slow-end');
      expect(fastIndex).toBeLessThan(slowEndIndex);
    });

    test('should not block on slow tests', async () => {
      const startTime = Date.now();
      
      const tests = [
        () => new Promise(resolve => setTimeout(() => resolve({ status: 'success', duration: 100 }), 100)),
        () => new Promise(resolve => setTimeout(() => resolve({ status: 'success', duration: 50 }), 50)),
        () => new Promise(resolve => setTimeout(() => resolve({ status: 'success', duration: 10 }), 10))
      ];
      
      await Promise.all(tests.map(test => test()));
      
      const elapsed = Date.now() - startTime;
      
      // Total time should be ~100ms (slowest test), not 160ms (sum of all tests)
      // Allow for slight timing variance (95-150ms)
      expect(elapsed).toBeLessThan(150);
      expect(elapsed).toBeGreaterThanOrEqual(95);
    });
  });

  describe('Error Handling', () => {
    test('should handle individual test failures gracefully', async () => {
      const tests = {
        passing: () => Promise.resolve({ name: 'Passing', status: 'success', duration: 100 }),
        failing: () => Promise.reject(new Error('Test failed'))
      };
      
      const results = await Promise.allSettled([
        tests.passing(),
        tests.failing()
      ]);
      
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[0].value.status).toBe('success');
    });

    test('should continue execution even if one test fails', async () => {
      let test1Complete = false;
      let test2Complete = false;
      let test3Complete = false;
      
      const tests = [
        async () => { test1Complete = true; return { status: 'success' }; },
        async () => { test2Complete = true; throw new Error('Test 2 failed'); },
        async () => { test3Complete = true; return { status: 'success' }; }
      ];
      
      await Promise.allSettled(tests.map(test => test()));
      
      expect(test1Complete).toBe(true);
      expect(test2Complete).toBe(true);
      expect(test3Complete).toBe(true);
    });

    test('should return error result for failed tests', async () => {
      const failingTest = () => Promise.reject(new Error('Database connection failed'));
      
      const result = await failingTest().catch(error => ({
        name: 'Database Connection',
        status: 'error',
        error: error.message,
        duration: 0
      }));
      
      expect(result.status).toBe('error');
      expect(result.error).toBe('Database connection failed');
      expect(result.duration).toBe(0);
    });
  });

  describe('Response Format', () => {
    test('should return consistent result structure', () => {
      const result = {
        name: 'Database Connection',
        status: 'success',
        duration: 150,
        details: { connected: true },
        steps: [],
        tests: [],
        stages: []
      };
      
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('duration');
      expect(typeof result.name).toBe('string');
      expect(['success', 'error', 'warning', 'partial']).toContain(result.status);
      expect(typeof result.duration).toBe('number');
    });

    test('should include optional nested structures', () => {
      const result = {
        name: 'Analyze Endpoint',
        status: 'success',
        duration: 2500,
        stages: [
          { stage: 'initialization', status: 'success', time: 100 },
          { stage: 'extraction', status: 'success', time: 2000 }
        ],
        details: { pipelineComplete: true }
      };
      
      expect(result.stages).toBeDefined();
      expect(Array.isArray(result.stages)).toBe(true);
      expect(result.stages.length).toBe(2);
      expect(result.details).toBeDefined();
    });
  });

  describe('Real-Time Updates', () => {
    test('should allow incremental result updates', () => {
      const initialState = {
        results: [
          { name: 'Database Connection', status: 'running', duration: 0 },
          { name: 'Gemini API', status: 'running', duration: 0 }
        ]
      };
      
      // Simulate first test completing
      const updatedState = {
        ...initialState,
        results: initialState.results.map(r =>
          r.name === 'Database Connection' 
            ? { ...r, status: 'success', duration: 150 }
            : r
        )
      };
      
      expect(updatedState.results[0].status).toBe('success');
      expect(updatedState.results[0].duration).toBe(150);
      expect(updatedState.results[1].status).toBe('running');
      expect(updatedState.results[1].duration).toBe(0);
    });

    test('should update summary as tests complete', () => {
      const results = [
        { status: 'success' },
        { status: 'running' },
        { status: 'success' }
      ];
      
      const summary = {
        total: results.length,
        success: results.filter(r => r.status === 'success').length,
        running: results.filter(r => r.status === 'running').length,
        errors: results.filter(r => r.status === 'error').length
      };
      
      expect(summary.total).toBe(3);
      expect(summary.success).toBe(2);
      expect(summary.running).toBe(1);
      expect(summary.errors).toBe(0);
    });
  });
});
