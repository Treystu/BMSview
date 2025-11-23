/**
 * ReAct Loop Implementation for Agentic Insights
 * 
 * Implements a Reasoning + Acting loop that:
 * 1. Prompts Gemini with current context and tools
 * 2. Detects if Gemini wants to call tools
 * 3. Executes tools and adds results to conversation history
 * 4. Loops until final answer reached or max iterations hit
 */

const { getGeminiClient } = require('./geminiClient.cjs');
const { toolDefinitions, executeToolCall } = require('./gemini-tools.cjs');
const { buildGuruPrompt, collectAutoInsightsContext } = require('./insights-guru.cjs');
const { createLogger } = require('./logger.cjs');
const { validateResponseFormat, buildCorrectionPrompt } = require('./response-validator.cjs');

const MAX_TURNS = 5;
const SYNC_CONTEXT_BUDGET_MS = 22000;
const SYNC_TOTAL_BUDGET_MS = 55000;

/**
 * Execute a complete ReAct loop for insights generation
 * 
 * Flow:
 * 1. Collect context (analytics, predictions, etc.)
 * 2. Build initial prompt with tool definitions
 * 3. Initialize conversation
 * 4. Loop: Call Gemini → check for tool calls → execute tools → add results → continue
 * 5. Return final answer when Gemini stops requesting tools
 */
async function executeReActLoop(params) {
    const {
        analysisData,
        systemId,
        customPrompt,
        log: externalLog,
        mode = 'sync'
    } = params;

    const log = externalLog || createLogger('react-loop');
    const startTime = Date.now();

    // Calculate time budgets
    const contextBudgetMs = SYNC_CONTEXT_BUDGET_MS;
    const totalBudgetMs = SYNC_TOTAL_BUDGET_MS;

    log.info('Starting ReAct loop', {
        mode,
        systemId,
        hasCustomPrompt: !!customPrompt,
        contextBudgetMs,
        totalBudgetMs
    });

    try {
        // Step 1: Collect pre-computed context (analytics, predictions, etc.)
        const contextStartTime = Date.now();
        let preloadedContext;

        try {
            preloadedContext = await collectAutoInsightsContext(
                systemId,
                analysisData,
                log,
                { mode, maxMs: contextBudgetMs }
            );
        } catch (contextError) {
            const err = contextError instanceof Error ? contextError : new Error(String(contextError));
            log.error('Context collection failed, continuing with minimal context', {
                error: err.message,
                durationMs: Date.now() - contextStartTime
            });
            preloadedContext = null;
        }

        const contextDurationMs = Date.now() - contextStartTime;
        log.info('Context collection completed', { durationMs: contextDurationMs });

        // Step 2: Build initial prompt
        const { prompt: initialPrompt, contextSummary } = await buildGuruPrompt({
            analysisData,
            systemId,
            customPrompt,
            log,
            context: preloadedContext,
            mode
        });

        log.info('Initial prompt built', {
            promptLength: initialPrompt.length,
            toolCount: toolDefinitions.length
        });

        // Step 3: Initialize conversation history
        const conversationHistory = [
            {
                role: 'user',
                parts: [{ text: initialPrompt }]
            }
        ];

        // Step 4: Main ReAct loop
        const geminiClient = getGeminiClient();
        let finalAnswer = null;
        let toolCallCount = 0;
        let turnCount = 0;

        for (turnCount = 0; turnCount < MAX_TURNS; turnCount++) {
            // Check timeout
            const elapsedMs = Date.now() - startTime;
            if (elapsedMs > totalBudgetMs) {
                log.warn('Total budget exceeded, stopping loop', {
                    turn: turnCount,
                    elapsedMs,
                    budgetMs: totalBudgetMs
                });
                finalAnswer = buildTimeoutMessage();
                break;
            }

            log.info(`ReAct turn ${turnCount + 1}/${MAX_TURNS}`, {
                elapsedMs,
                remainingMs: totalBudgetMs - elapsedMs
            });

            // Call Gemini with conversation history and tools
            let geminiResponse;
            try {
                geminiResponse = await geminiClient.callAPI(null, {
                    history: conversationHistory,
                    tools: toolDefinitions,
                    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
                    maxOutputTokens: 4096
                }, log);
            } catch (geminiError) {
                const err = geminiError instanceof Error ? geminiError : new Error(String(geminiError));
                log.error('Gemini API call failed', {
                    turn: turnCount,
                    error: err.message,
                    elapsedMs: Date.now() - startTime
                });
                throw err;
            }

            // Extract response content with detailed validation and recovery
            if (!geminiResponse || !geminiResponse.candidates) {
                log.error('Gemini response missing candidates array - full response logged', {
                    turn: turnCount,
                    response: JSON.stringify(geminiResponse),
                    customPrompt: customPrompt ? customPrompt.substring(0, 200) : null
                });
                
                // Attempt recovery: provide helpful message to user
                finalAnswer = `I encountered an issue processing your request. The AI service returned an unexpected response structure. This can happen with very complex or unusual queries. Please try:\n\n1. Simplifying your question\n2. Breaking it into smaller parts\n3. Providing more specific time ranges or metrics\n\nTechnical details: Missing candidates array in Gemini response.`;
                break;
            }

            if (geminiResponse.candidates.length === 0) {
                log.error('Gemini response has empty candidates array', {
                    turn: turnCount,
                    response: JSON.stringify(geminiResponse).substring(0, 1000),
                    customPrompt: customPrompt ? customPrompt.substring(0, 200) : null
                });
                
                // Recovery: Check for finishReason or promptFeedback that might explain
                const promptFeedback = geminiResponse.promptFeedback;
                if (promptFeedback && promptFeedback.blockReason) {
                    finalAnswer = `Your request was blocked by content safety filters. Reason: ${promptFeedback.blockReason}. Please rephrase your question.`;
                } else {
                    finalAnswer = `The AI service could not generate a response to your request. This may be due to the complexity or phrasing of your question. Please try rephrasing or simplifying.`;
                }
                break;
            }

            const responseContent = geminiResponse.candidates[0]?.content;
            if (!responseContent) {
                log.error('Gemini response candidate missing content', {
                    turn: turnCount,
                    candidate: JSON.stringify(geminiResponse.candidates[0]).substring(0, 1000),
                    finishReason: geminiResponse.candidates[0]?.finishReason,
                    customPrompt: customPrompt ? customPrompt.substring(0, 200) : null
                });
                
                // Check finish reason for context
                const finishReason = geminiResponse.candidates[0]?.finishReason;
                if (finishReason === 'SAFETY') {
                    finalAnswer = `Your request triggered content safety filters. Please rephrase to avoid sensitive topics.`;
                } else if (finishReason === 'MAX_TOKENS') {
                    finalAnswer = `The response exceeded token limits. Try asking for a shorter or more focused answer.`;
                } else if (finishReason === 'RECITATION') {
                    finalAnswer = `The AI detected potential copyrighted content. Please rephrase your request.`;
                } else {
                    finalAnswer = `Unable to generate response. Finish reason: ${finishReason || 'unknown'}. Please try rephrasing your question.`;
                }
                break;
            }

            if (!responseContent.parts || !Array.isArray(responseContent.parts)) {
                log.error('Gemini response content missing or invalid parts array - attempting recovery', {
                    turn: turnCount,
                    content: JSON.stringify(responseContent).substring(0, 1000),
                    partsType: typeof responseContent.parts,
                    hasRole: !!responseContent.role,
                    customPrompt: customPrompt ? customPrompt.substring(0, 200) : null
                });
                
                // Recovery attempt: Check if there's a text field directly on content
                if (responseContent.text) {
                    log.info('Found text directly on content object, recovering', {
                        turn: turnCount,
                        textLength: responseContent.text.length
                    });
                    finalAnswer = responseContent.text;
                    break;
                }
                
                // No recovery possible
                finalAnswer = `I encountered a technical issue processing your request. The response format was unexpected. This sometimes happens with very complex questions requiring multiple data lookups. Please try:\n\n1. Asking for specific metrics or time ranges\n2. Breaking complex questions into simpler parts\n3. Using more standard phrasing\n\nTechnical: Invalid parts array structure.`;
                break;
            }

            if (responseContent.parts.length === 0) {
                log.warn('Gemini response has empty parts array - attempting to continue', {
                    turn: turnCount,
                    content: JSON.stringify(responseContent).substring(0, 500)
                });
                // Check if this is final turn - if so, provide fallback
                if (turnCount === MAX_TURNS - 1) {
                    finalAnswer = `No response generated after ${MAX_TURNS} attempts. The question may be too complex or require data that isn't available. Please try a simpler, more specific question.`;
                    break;
                }
                // Otherwise continue to next turn
                conversationHistory.push(responseContent);
                continue;
            }

            log.debug('Gemini response received', {
                turn: turnCount,
                partCount: responseContent.parts.length,
                partTypes: responseContent.parts.map(p => Object.keys(p)[0]),
                hasText: responseContent.parts.some(p => p.text),
                hasFunctionCall: responseContent.parts.some(p => p.functionCall)
            });

            // Add model response to conversation history
            conversationHistory.push(responseContent);

            // Step 5: Check for tool calls in response
            const toolCalls = responseContent.parts.filter(p => p.functionCall);

            if (toolCalls.length === 0) {
                // No tool calls → extract final answer
                const textParts = responseContent.parts.filter(p => p.text);
                if (textParts.length > 0) {
                    finalAnswer = textParts.map(p => p.text).join('\n');
                    log.info('Final answer received from Gemini', {
                        turn: turnCount,
                        answerLength: finalAnswer.length,
                        toolCallsTotal: toolCallCount
                    });
                    
                    // Validate response format
                    const validation = validateResponseFormat(finalAnswer, customPrompt || '');
                    
                    if (!validation.valid && turnCount < MAX_TURNS - 1) {
                        log.warn('Response format validation failed, requesting correction', {
                            error: validation.error,
                            formatType: validation.formatType,
                            turn: turnCount,
                            attemptsRemaining: MAX_TURNS - turnCount - 1
                        });
                        
                        // Add format correction request to conversation
                        const correctionPrompt = buildCorrectionPrompt(
                            finalAnswer, 
                            validation.error, 
                            validation.formatType,
                            customPrompt || ''
                        );
                        
                        conversationHistory.push({
                            role: 'user',
                            parts: [{ text: correctionPrompt }]
                        });
                        
                        // Clear finalAnswer to continue loop
                        finalAnswer = null;
                        
                        log.info('Correction request added to conversation', {
                            turn: turnCount,
                            formatType: validation.formatType
                        });
                        
                        // Continue to next turn for correction
                        continue;
                    } else if (!validation.valid) {
                        log.warn('Response format validation failed but no retries left, using malformed response', {
                            error: validation.error,
                            formatType: validation.formatType,
                            turn: turnCount
                        });
                        // Use the response anyway - better than nothing
                    } else {
                        log.info('Response format validated successfully', {
                            formatType: validation.formatType,
                            turn: turnCount
                        });
                    }
                }
                break;
            }

            // Step 6: Execute tool calls
            log.info(`Processing ${toolCalls.length} tool call(s)`, {
                turn: turnCount,
                tools: toolCalls.map(t => t.functionCall.name)
            });

            for (const toolCall of toolCalls) {
                const toolName = toolCall.functionCall.name;
                const toolArgs = toolCall.functionCall.args;

                try {
                    log.info(`Executing tool: ${toolName}`, {
                        turn: turnCount,
                        toolArgsKeys: Object.keys(toolArgs || {})
                    });

                    const toolResult = await executeToolCall(toolName, toolArgs, log);
                    toolCallCount++;

                    // Add tool result to conversation
                    conversationHistory.push({
                        role: 'function',
                        parts: [{
                            functionResponse: {
                                name: toolName,
                                response: { result: toolResult }
                            }
                        }]
                    });

                    log.info(`Tool executed successfully: ${toolName}`, {
                        turn: turnCount,
                        resultSize: toolResult ? JSON.stringify(toolResult).length : 0
                    });
                } catch (toolError) {
                    const err = toolError instanceof Error ? toolError : new Error(String(toolError));
                    log.error(`Tool execution failed: ${toolName}`, {
                        turn: turnCount,
                        error: err.message
                    });

                    // Add error result to conversation so Gemini knows it failed
                    conversationHistory.push({
                        role: 'function',
                        parts: [{
                            functionResponse: {
                                name: toolName,
                                response: {
                                    error: true,
                                    message: `Tool execution failed: ${err.message}`
                                }
                            }
                        }]
                    });
                }
            }
        }

        // Determine if we hit max turns without final answer
        if (!finalAnswer) {
            if (turnCount >= MAX_TURNS) {
                finalAnswer = buildMaxTurnsMessage(MAX_TURNS);
                log.warn('Reached max turns without final answer', {
                    turns: MAX_TURNS,
                    toolCalls: toolCallCount
                });
            } else {
                finalAnswer = 'Unable to generate insights at this time. Please try again.';
                log.error('Unexpected end of ReAct loop without final answer');
            }
        }

        const totalDurationMs = Date.now() - startTime;

        log.info('ReAct loop completed successfully', {
            turns: turnCount + 1,
            toolCalls: toolCallCount,
            totalDurationMs,
            answerLength: finalAnswer.length
        });

        return {
            success: true,
            finalAnswer,
            turns: turnCount + 1,
            toolCalls: toolCallCount,
            durationMs: totalDurationMs,
            contextSummary,
            conversationLength: conversationHistory.length
        };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const totalDurationMs = Date.now() - startTime;

        log.error('ReAct loop failed', {
            error: err.message,
            stack: err.stack,
            durationMs: totalDurationMs
        });

        return {
            success: false,
            error: err.message,
            durationMs: totalDurationMs
        };
    }
}

/**
 * Build timeout message when budget is exceeded
 */
function buildTimeoutMessage() {
    return `I've reached my analysis time budget during investigation. Here's what I gathered before timeout:

**Status:** Partial analysis completed due to time constraints.

**What happened:** Your question required detailed data analysis, but I ran out of time gathering information.

**Recommendations:**
1. Try a more specific question (e.g., "What's my current SOC?" vs "Analyze everything")
2. Use the background analysis mode for complex investigations
3. Check back in a few minutes and we'll provide more detailed findings

Please resubmit your question and I'll prioritize the most critical insights.`;
}

/**
 * Build message when max turns is reached
 */
function buildMaxTurnsMessage(maxTurns) {
    return `I've completed ${maxTurns} analysis iterations but need more data to fully answer your question.

**What I found:** Partial analysis available, but requires additional investigation.

**Next steps:**
1. Try asking a more focused question
2. Use background analysis mode for comprehensive investigation
3. Ask follow-up questions based on these initial findings

This typically means your question requires accessing long-term historical data or complex correlations that need the background analysis pipeline.`;
}

module.exports = {
    executeReActLoop,
    MAX_TURNS
};
