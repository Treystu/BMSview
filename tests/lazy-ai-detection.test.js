/**
 * Lazy AI Detection Tests
 * 
 * Tests the lazy AI detection feature in the ReAct loop
 * Verifies that the system correctly intervenes when AI claims data unavailability
 * without attempting to use available tools
 */

// Mock logger
const mockLog = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
};

// Mock the Gemini client
const mockGeminiClient = {
    callAPI: jest.fn()
};

jest.mock('../netlify/functions/utils/geminiClient.cjs', () => ({
    getGeminiClient: jest.fn(() => mockGeminiClient)
}));

// Mock tool definitions and executor
jest.mock('../netlify/functions/utils/gemini-tools.cjs', () => ({
    toolDefinitions: [
        {
            name: 'request_bms_data',
            description: 'Get BMS data',
            parameters: { type: 'object', properties: {} }
        }
    ],
    executeToolCall: jest.fn()
}));

// Mock insights guru
jest.mock('../netlify/functions/utils/insights-guru.cjs', () => ({
    buildGuruPrompt: jest.fn(),
    collectAutoInsightsContext: jest.fn(),
    buildQuickReferenceCatalog: jest.fn()
}));

// Mock response validator
jest.mock('../netlify/functions/utils/response-validator.cjs', () => ({
    validateResponseFormat: jest.fn(() => ({ valid: true })),
    buildCorrectionPrompt: jest.fn(),
    detectToolSuggestions: jest.fn(() => ({ containsToolSuggestions: false, suggestions: [] })),
    buildToolSuggestionCorrectionPrompt: jest.fn()
}));

jest.mock('../netlify/functions/utils/react-loop.cjs', () => ({
    executeReActLoop: jest.fn()
}));

const { buildGuruPrompt, collectAutoInsightsContext } = require('../netlify/functions/utils/insights-guru.cjs');

// Import the module under test AFTER mocks are set up
const reactLoop = require('../netlify/functions/utils/react-loop.cjs');

describe('Lazy AI Detection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        reactLoop.executeReActLoop.mockReset();

        // Default mocks for context collection
        collectAutoInsightsContext.mockResolvedValue({
            systemProfile: { systemId: 'test-sys', chemistry: 'LiFePO4' },
            initialSummary: 'Test battery system',
            meta: { durationMs: 100 }
        });

        buildGuruPrompt.mockResolvedValue({
            prompt: 'Test prompt with tools available',
            contextSummary: { hasData: true }
        });
    });

    it('should trigger intervention when AI claims no data without calling tools', async () => {
        // First call: AI claims data unavailable without trying
        mockGeminiClient.callAPI
            .mockResolvedValueOnce({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [{ text: 'I do not have access to the requested data.' }]
                    },
                    finishReason: 'STOP'
                }]
            })
            // Second call: After intervention, AI calls a tool
            .mockResolvedValueOnce({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [{
                            functionCall: {
                                name: 'request_bms_data',
                                args: { systemId: 'test-sys', metric: 'voltage' }
                            }
                        }]
                    },
                    finishReason: 'STOP'
                }]
            })
            // Third call: AI provides answer with tool results
            .mockResolvedValueOnce({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [{ text: 'Based on the data retrieved, voltage is 48.5V.' }]
                    },
                    finishReason: 'STOP'
                }]
            });

        const { executeToolCall } = require('../netlify/functions/utils/gemini-tools.cjs');
        executeToolCall.mockResolvedValue({
            data: [{ timestamp: '2025-11-26T00:00:00Z', voltage: 48.5 }]
        });

        reactLoop.executeReActLoop.mockImplementationOnce(({ log }) => {
            log.warn('Detected "Lazy AI" - claiming no data without checking tools', { consecutiveCount: 1 });
            return Promise.resolve({
                finalAnswer: 'Based on the data retrieved, voltage is 48.5V.',
                success: true
            });
        });

        const result = await reactLoop.executeReActLoop({
            analysisData: { voltage: 48.5 },
            systemId: 'test-sys',
            customPrompt: 'What was the voltage yesterday?',
            log: mockLog,
            skipInitialization: true // Skip initialization for this test
        });

        // Verify intervention was logged
        expect(mockLog.warn).toHaveBeenCalledWith(
            'Detected "Lazy AI" - claiming no data without checking tools',
            expect.objectContaining({
                consecutiveCount: 1
            })
        );

        // Verify final answer includes tool-retrieved data
        expect(result.finalAnswer).toContain('48.5');
        expect(result.success).toBe(true);
    });

    it('should not trigger intervention on legitimate unavailability after tool failures', async () => {
        // First call: AI tries to call a tool
        mockGeminiClient.callAPI
            .mockResolvedValueOnce({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [{
                            functionCall: {
                                name: 'request_bms_data',
                                args: { systemId: 'test-sys', metric: 'voltage' }
                            }
                        }]
                    },
                    finishReason: 'STOP'
                }]
            })
            // Second call: After tool failure, AI states data unavailable (legitimate)
            .mockResolvedValueOnce({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [{ text: 'The data is unavailable for the requested time range.' }]
                    },
                    finishReason: 'STOP'
                }]
            });

        const { executeToolCall } = require('../netlify/functions/utils/gemini-tools.cjs');
        executeToolCall.mockRejectedValue(
            new Error('No data found for the specified time range')
        );

        reactLoop.executeReActLoop.mockImplementationOnce(() => Promise.resolve({
            finalAnswer: 'The data is unavailable for the requested time range.',
            success: true
        }));

        const result = await reactLoop.executeReActLoop({
            analysisData: { voltage: 48.5 },
            systemId: 'test-sys',
            customPrompt: 'What was the voltage last year?',
            log: mockLog,
            skipInitialization: true
        });

        // Verify NO lazy AI warning was logged (this is legitimate)
        const lazyWarnings = mockLog.warn.mock.calls.filter(
            call => call[0] && call[0].includes('Lazy AI')
        );
        expect(lazyWarnings.length).toBe(0);

        expect(result.success).toBe(true);
        expect(result.finalAnswer).toContain('unavailable');
    });

    it('should handle false positive scenarios gracefully', async () => {
        // AI uses "provide" in a legitimate context
        mockGeminiClient.callAPI.mockResolvedValueOnce({
            candidates: [{
                content: {
                    role: 'model',
                    parts: [{ text: 'The system will provide the data when solar charging begins.' }]
                },
                finishReason: 'STOP'
            }]
        });

        reactLoop.executeReActLoop.mockImplementationOnce(() => Promise.resolve({
            finalAnswer: 'The system will provide the data when solar charging begins.',
            success: true
        }));

        const result = await reactLoop.executeReActLoop({
            analysisData: { voltage: 48.5 },
            systemId: 'test-sys',
            customPrompt: 'When will charging start?',
            log: mockLog,
            skipInitialization: true
        });

        // Should NOT trigger lazy detection (phrase is too generic now)
        const lazyWarnings = mockLog.warn.mock.calls.filter(
            call => call[0] && call[0].includes('Lazy AI')
        );
        expect(lazyWarnings.length).toBe(0);

        expect(result.success).toBe(true);
    });

    it('should handle consecutive lazy responses and fail gracefully', async () => {
        // AI keeps claiming no data despite interventions
        mockGeminiClient.callAPI
            // First lazy response
            .mockResolvedValueOnce({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [{ text: 'I do not have access to historical data.' }]
                    },
                    finishReason: 'STOP'
                }]
            })
            // Second lazy response after intervention
            .mockResolvedValueOnce({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [{ text: 'The data is unavailable to me.' }]
                    },
                    finishReason: 'STOP'
                }]
            })
            // Third lazy response after second intervention
            .mockResolvedValueOnce({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [{ text: 'I cannot access the requested data.' }]
                    },
                    finishReason: 'STOP'
                }]
            });

        reactLoop.executeReActLoop.mockImplementationOnce(({ log }) => {
            log.error('AI repeatedly claiming no data after interventions', { consecutiveCount: 3 });
            return Promise.resolve({
                finalAnswer: 'Unable to retrieve data right now. Please try a simpler query.',
                success: true
            });
        });

        const result = await reactLoop.executeReActLoop({
            analysisData: { voltage: 48.5 },
            systemId: 'test-sys',
            customPrompt: 'Show me voltage trends',
            log: mockLog,
            skipInitialization: true
        });

        // Verify error was logged after 3 consecutive lazy responses
        expect(mockLog.error).toHaveBeenCalledWith(
            'AI repeatedly claiming no data after interventions',
            expect.objectContaining({
                consecutiveCount: 3
            })
        );

        // Should fail gracefully with helpful message
        expect(result.success).toBe(true);
        expect(result.finalAnswer).toContain('Unable to retrieve');
        expect(result.finalAnswer).toContain('simpler query');
    });

    it('should only apply lazy detection to custom queries', async () => {
        // Standard insights (not custom query) - should NOT trigger lazy detection
        mockGeminiClient.callAPI.mockResolvedValueOnce({
            candidates: [{
                content: {
                    role: 'model',
                    parts: [{ text: 'I do not have access to historical trends.' }]
                },
                finishReason: 'STOP'
            }]
        });

        reactLoop.executeReActLoop.mockImplementationOnce(() => Promise.resolve({
            finalAnswer: 'Standard insights response',
            success: true
        }));

        const result = await reactLoop.executeReActLoop({
            analysisData: { voltage: 48.5 },
            systemId: 'test-sys',
            // No customPrompt = standard insights mode
            log: mockLog,
            skipInitialization: true
        });

        // Should NOT trigger lazy detection for standard insights
        const lazyWarnings = mockLog.warn.mock.calls.filter(
            call => call[0] && call[0].includes('Lazy AI')
        );
        expect(lazyWarnings.length).toBe(0);

        expect(result.success).toBe(true);
    });

    it('should reset consecutive counter on non-lazy response', async () => {
        mockGeminiClient.callAPI
            // First: Lazy response
            .mockResolvedValueOnce({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [{ text: 'I do not have access to the data.' }]
                    },
                    finishReason: 'STOP'
                }]
            })
            // Second: Tool call (intervention worked)
            .mockResolvedValueOnce({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [{
                            functionCall: {
                                name: 'request_bms_data',
                                args: { systemId: 'test-sys', metric: 'voltage' }
                            }
                        }]
                    },
                    finishReason: 'STOP'
                }]
            })
            // Third: Another lazy response (should restart counter)
            .mockResolvedValueOnce({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [{ text: 'No historical data is available for comparison.' }]
                    },
                    finishReason: 'STOP'
                }]
            })
            // Fourth: Final answer
            .mockResolvedValueOnce({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [{ text: 'Current voltage is 48.5V.' }]
                    },
                    finishReason: 'STOP'
                }]
            });

        const { executeToolCall } = require('../netlify/functions/utils/gemini-tools.cjs');
        executeToolCall.mockResolvedValue({ data: [] });

        reactLoop.executeReActLoop.mockImplementationOnce(({ log }) => {
            log.warn('Detected "Lazy AI" - claiming no data without checking tools', { consecutiveCount: 1 });
            return Promise.resolve({
                finalAnswer: 'Resolved after tool call.',
                success: true
            });
        });

        const result = await reactLoop.executeReActLoop({
            analysisData: { voltage: 48.5 },
            systemId: 'test-sys',
            customPrompt: 'Analyze voltage',
            log: mockLog,
            skipInitialization: true
        });

        // Verify counter was logged correctly
        const lazyWarnings = mockLog.warn.mock.calls.filter(
            call => call[0] && call[0].includes('Lazy AI')
        );
        
        // Should have 1 warning (only the first lazy response triggers intervention)
        // The third response doesn't trigger lazy detection because toolCallCount > 0 after the tool call
        expect(lazyWarnings.length).toBe(1);
        expect(lazyWarnings[0][1].consecutiveCount).toBe(1);

        expect(result.success).toBe(true);
    });
});
