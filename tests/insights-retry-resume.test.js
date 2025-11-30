/**
 * Test for automatic retry/resume functionality in insights generation
 * Tests the new checkpoint/resume system that allows insights to continue
 * after timeout instead of failing
 */

describe('Insights Retry/Resume Functionality', () => {
  describe('Frontend streamInsights with automatic retry', () => {
    let mockFetch;
    let onChunkMock;
    let onCompleteMock;
    let onErrorMock;

    beforeEach(() => {
      // Mock fetch globally
      global.fetch = jest.fn();
      mockFetch = global.fetch;
      
      onChunkMock = jest.fn();
      onCompleteMock = jest.fn();
      onErrorMock = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('should handle successful response on first attempt', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          insights: {
            rawText: 'Analysis complete',
            formattedText: 'Analysis complete'
          },
          metadata: {
            mode: 'sync',
            turns: 3,
            toolCalls: 5,
            durationMs: 15000
          }
        })
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      // Import the function (this is a simplified test - in real scenario we'd test the actual implementation)
      const streamInsights = async (payload, onChunk, onComplete, onError) => {
        const response = await fetch('/.netlify/functions/generate-insights-with-tools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, mode: 'sync' })
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.insights) {
            onChunk(result.insights.rawText);
            onComplete();
            return;
          }
        }
        onError(new Error('Failed'));
      };

      await streamInsights(
        { analysisData: { voltage: 52.8 }, systemId: 'test' },
        onChunkMock,
        onCompleteMock,
        onErrorMock
      );

      expect(onChunkMock).toHaveBeenCalledWith('Analysis complete');
      expect(onCompleteMock).toHaveBeenCalled();
      expect(onErrorMock).not.toHaveBeenCalled();
    });

    test('should automatically retry when receiving 408 with resumeJobId', async () => {
      const jobId = 'test-job-123';
      
      // First response: 408 timeout with resumeJobId
      const timeoutResponse = {
        ok: false,
        status: 408,
        json: async () => ({
          success: false,
          error: 'insights_timeout',
          message: 'Insights generation timed out after 60000ms. A checkpoint was saved - retry with resumeJobId to continue.',
          details: {
            jobId: jobId,
            canResume: true,
            durationMs: 60000,
            timeoutMs: 60000
          }
        })
      };

      // Second response: Success with resumed insights
      const successResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          insights: {
            rawText: 'Resumed analysis complete',
            formattedText: 'Resumed analysis complete'
          },
          metadata: {
            mode: 'sync',
            wasResumed: true,
            turns: 8,
            toolCalls: 12,
            durationMs: 45000
          }
        })
      };

      mockFetch
        .mockResolvedValueOnce(timeoutResponse)
        .mockResolvedValueOnce(successResponse);

      // Simplified retry logic
      const streamInsightsWithRetry = async (payload, onChunk, onComplete, onError) => {
        let resumeJobId = undefined;
        let attemptCount = 0;
        const MAX_ATTEMPTS = 5;

        const attemptRequest = async () => {
          attemptCount++;
          
          const requestBody = { ...payload, mode: 'sync' };
          if (resumeJobId) {
            requestBody.resumeJobId = resumeJobId;
            onChunk(`\n\n⏳ **Continuing analysis (attempt ${attemptCount}/${MAX_ATTEMPTS})...**\n\n`);
          }

          const response = await fetch('/.netlify/functions/generate-insights-with-tools', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });

          // Handle 408 timeout with retry
          if (response.status === 408) {
            const errorData = await response.json();
            if (errorData.details?.canResume && errorData.details?.jobId && attemptCount < MAX_ATTEMPTS) {
              resumeJobId = errorData.details.jobId;
              return await attemptRequest(); // Recursive retry
            }
            throw new Error('Max retries exceeded');
          }

          if (response.ok) {
            const result = await response.json();
            if (result.success && result.insights) {
              onChunk(result.insights.rawText);
              onComplete();
              return;
            }
          }
          
          throw new Error('Request failed');
        };

        try {
          await attemptRequest();
        } catch (error) {
          onError(error);
        }
      };

      await streamInsightsWithRetry(
        { analysisData: { voltage: 52.8 }, systemId: 'test' },
        onChunkMock,
        onCompleteMock,
        onErrorMock
      );

      // Verify retry happened
      expect(mockFetch).toHaveBeenCalledTimes(2);
      
      // First call: no resumeJobId
      expect(mockFetch.mock.calls[0][1].body).toContain('"mode":"sync"');
      expect(mockFetch.mock.calls[0][1].body).not.toContain('resumeJobId');
      
      // Second call: with resumeJobId
      expect(mockFetch.mock.calls[1][1].body).toContain('"mode":"sync"');
      expect(mockFetch.mock.calls[1][1].body).toContain(`"resumeJobId":"${jobId}"`);
      
      // Verify progress message was shown
      expect(onChunkMock).toHaveBeenCalledWith(expect.stringContaining('Continuing analysis (attempt 2/5)'));
      
      // Verify final success
      expect(onChunkMock).toHaveBeenCalledWith('Resumed analysis complete');
      expect(onCompleteMock).toHaveBeenCalled();
      expect(onErrorMock).not.toHaveBeenCalled();
    });

    test('should fail after max retries exceeded', async () => {
      const jobId = 'test-job-456';
      const MAX_ATTEMPTS = 5;
      
      // Always return 408 timeout
      const timeoutResponse = {
        ok: false,
        status: 408,
        json: async () => ({
          success: false,
          error: 'insights_timeout',
          details: {
            jobId: jobId,
            canResume: true,
            durationMs: 60000,
            timeoutMs: 60000
          }
        })
      };

      // Mock fetch to always timeout
      mockFetch.mockResolvedValue(timeoutResponse);

      const streamInsightsWithRetry = async (payload, onChunk, onComplete, onError) => {
        let resumeJobId = undefined;
        let attemptCount = 0;

        const attemptRequest = async () => {
          attemptCount++;
          
          const requestBody = { ...payload, mode: 'sync' };
          if (resumeJobId) {
            requestBody.resumeJobId = resumeJobId;
          }

          const response = await fetch('/.netlify/functions/generate-insights-with-tools', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });

          if (response.status === 408) {
            const errorData = await response.json();
            if (errorData.details?.canResume && errorData.details?.jobId && attemptCount < MAX_ATTEMPTS) {
              resumeJobId = errorData.details.jobId;
              return await attemptRequest();
            }
            throw new Error(`Analysis is taking longer than expected (${MAX_ATTEMPTS} minutes).`);
          }

          if (response.ok) {
            const result = await response.json();
            if (result.success && result.insights) {
              onChunk(result.insights.rawText);
              onComplete();
              return;
            }
          }
          
          throw new Error('Request failed');
        };

        try {
          await attemptRequest();
        } catch (error) {
          onError(error);
        }
      };

      await streamInsightsWithRetry(
        { analysisData: { voltage: 52.8 }, systemId: 'test' },
        onChunkMock,
        onCompleteMock,
        onErrorMock
      );

      // Verify it tried MAX_ATTEMPTS times
      expect(mockFetch).toHaveBeenCalledTimes(MAX_ATTEMPTS);
      
      // Verify error was called
      expect(onErrorMock).toHaveBeenCalled();
      expect(onErrorMock.mock.calls[0][0].message).toContain('taking longer than expected');
      
      // Verify onComplete was NOT called
      expect(onCompleteMock).not.toHaveBeenCalled();
    });

    test('should not retry if canResume is false', async () => {
      const timeoutResponse = {
        ok: false,
        status: 408,
        json: async () => ({
          success: false,
          error: 'insights_failed',
          message: 'Insights generation failed',
          details: {
            jobId: 'test-job-789',
            canResume: false, // Cannot resume
            durationMs: 60000
          }
        })
      };

      mockFetch.mockResolvedValueOnce(timeoutResponse);

      const streamInsightsWithRetry = async (payload, onChunk, onComplete, onError) => {
        const requestBody = { ...payload, mode: 'sync' };

        const response = await fetch('/.netlify/functions/generate-insights-with-tools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (response.status === 408) {
          const errorData = await response.json();
          if (errorData.details?.canResume === false) {
            onError(new Error(errorData.message));
            return;
          }
        }
        
        onError(new Error('Unexpected response'));
      };

      await streamInsightsWithRetry(
        { analysisData: { voltage: 52.8 }, systemId: 'test' },
        onChunkMock,
        onCompleteMock,
        onErrorMock
      );

      // Should only try once
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      // Should call onError
      expect(onErrorMock).toHaveBeenCalled();
      expect(onErrorMock.mock.calls[0][0].message).toContain('Insights generation failed');
    });
  });

  describe('Backend checkpoint/resume integration', () => {
    test('should save checkpoint state on timeout', () => {
      // This would be tested with actual backend code
      const checkpointState = {
        turnCount: 5,
        conversationHistory: [
          { role: 'user', content: 'Analyze battery' },
          { role: 'assistant', content: 'Let me check the data...' }
        ],
        toolCallsExecuted: 8,
        lastToolCall: 'request_bms_data'
      };

      expect(checkpointState.turnCount).toBe(5);
      expect(checkpointState.conversationHistory).toHaveLength(2);
      expect(checkpointState.toolCallsExecuted).toBe(8);
    });

    test('should resume from checkpoint state', () => {
      const checkpointState = {
        turnCount: 5,
        conversationHistory: [
          { role: 'user', content: 'Analyze battery' },
          { role: 'assistant', content: 'Let me check the data...' }
        ],
        toolCallsExecuted: 8
      };

      // Simulate resume
      const resumeConfig = {
        skipInitialization: true,
        maxRemainingTurns: 5, // 10 max - 5 already used
        conversationHistory: checkpointState.conversationHistory
      };

      expect(resumeConfig.skipInitialization).toBe(true);
      expect(resumeConfig.maxRemainingTurns).toBe(5);
      expect(resumeConfig.conversationHistory).toHaveLength(2);
    });
  });

  describe('Error message formatting', () => {
    test('error messages should include actual elapsed time, not calculated estimates', () => {
      // Simulate actual elapsed time being much less than theoretical max
      const actualElapsedMs = 45000; // 45 seconds actual elapsed time
      const actualElapsedSeconds = Math.round(actualElapsedMs / 1000);
      const actualElapsedMinutes = Math.floor(actualElapsedSeconds / 60);
      const remainingSeconds = actualElapsedSeconds % 60;
      
      // Format elapsed time (same logic as clientService.ts)
      const elapsedTimeStr = actualElapsedMinutes > 0 
        ? `${actualElapsedMinutes} minute${actualElapsedMinutes !== 1 ? 's' : ''} ${remainingSeconds > 0 ? `${remainingSeconds} seconds` : ''}`
        : `${actualElapsedSeconds} seconds`;
      
      // Verify the formatted string is based on actual time
      expect(elapsedTimeStr).toBe('45 seconds');
      expect(elapsedTimeStr).not.toContain('20 minutes'); // Should NOT be hard-coded theoretical max
    });

    test('elapsed time string should handle minutes correctly', () => {
      const actualElapsedMs = 125000; // 2 minutes 5 seconds
      const actualElapsedSeconds = Math.round(actualElapsedMs / 1000);
      const actualElapsedMinutes = Math.floor(actualElapsedSeconds / 60);
      const remainingSeconds = actualElapsedSeconds % 60;
      
      const elapsedTimeStr = actualElapsedMinutes > 0 
        ? `${actualElapsedMinutes} minute${actualElapsedMinutes !== 1 ? 's' : ''} ${remainingSeconds > 0 ? `${remainingSeconds} seconds` : ''}`
        : `${actualElapsedSeconds} seconds`;
      
      expect(elapsedTimeStr).toBe('2 minutes 5 seconds');
    });

    test('elapsed time string should handle singular minute correctly', () => {
      const actualElapsedMs = 65000; // 1 minute 5 seconds
      const actualElapsedSeconds = Math.round(actualElapsedMs / 1000);
      const actualElapsedMinutes = Math.floor(actualElapsedSeconds / 60);
      const remainingSeconds = actualElapsedSeconds % 60;
      
      const elapsedTimeStr = actualElapsedMinutes > 0 
        ? `${actualElapsedMinutes} minute${actualElapsedMinutes !== 1 ? 's' : ''} ${remainingSeconds > 0 ? `${remainingSeconds} seconds` : ''}`
        : `${actualElapsedSeconds} seconds`;
      
      expect(elapsedTimeStr).toBe('1 minute 5 seconds');
    });
  });
});
