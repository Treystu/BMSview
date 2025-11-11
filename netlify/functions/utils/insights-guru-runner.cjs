// @ts-nocheck

const { buildGuruPrompt } = require('./insights-guru.cjs');
const { executeToolCall } = require('./gemini-tools.cjs');

const DEFAULT_CONVERSATION_TOKEN_LIMIT = 60_000;
const TOKENS_PER_CHAR = 0.25;

function ensureLog(log) {
    if (log && typeof log.info === 'function') {
        return log;
    }
    return {
        info: console.log,
        warn: console.warn,
        error: console.error,
        debug: console.debug
    };
}

async function callHook(hook, payload, log, label) {
    if (typeof hook !== 'function') {
        return;
    }
    try {
        await hook(payload);
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.warn(`Hook ${label} failed`, { error: err.message });
    }
}

function pruneConversationHistory(history, tokenLimit, tokensPerChar, log) {
    if (!Array.isArray(history) || history.length <= 3) {
        return history;
    }

    const totalChars = history.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    const estimatedTokens = totalChars * tokensPerChar;
    if (estimatedTokens < tokenLimit) {
        return history;
    }

    log.info('Pruning conversation history', {
        originalMessages: history.length,
        estimatedTokens,
        tokenLimit
    });

    const pruned = [];
    pruned.push(history[0]);

    const recentMessages = history.slice(-4);
    const firstMsgTokens = (history[0].content?.length || 0) * tokensPerChar;
    const recentTokens = recentMessages.reduce((sum, msg) => sum + (msg.content?.length || 0) * tokensPerChar, 0);
    const middleMessages = history.slice(1, -4);

    const remainingTokens = tokenLimit - firstMsgTokens - recentTokens;
    if (middleMessages.length > 0 && remainingTokens > 0) {
        const middleTokenSum = middleMessages.reduce((sum, msg) => sum + (msg.content?.length || 0) * tokensPerChar, 0);
        const avgMiddleTokens = middleTokenSum > 0 ? middleTokenSum / middleMessages.length : 0;
        const canKeepMiddle = avgMiddleTokens > 0 ? Math.max(1, Math.floor(remainingTokens / avgMiddleTokens)) : 1;
        const step = Math.ceil(middleMessages.length / canKeepMiddle);
        for (let i = 0; i < middleMessages.length; i += step) {
            pruned.push(middleMessages[i]);
        }
    }

    pruned.push(...recentMessages);

    const prunedChars = pruned.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    const prunedTokens = prunedChars * tokensPerChar;

    log.info('Conversation history pruned', {
        originalMessages: history.length,
        prunedMessages: pruned.length,
        originalTokens: estimatedTokens,
        prunedTokens,
        savedTokens: estimatedTokens - prunedTokens
    });

    return pruned;
}

function compactifyToolResult(result, toolName, log) {
    if (!result || typeof result !== 'object') {
        return result;
    }

    // More aggressive compaction for large datasets
    if (result.data && Array.isArray(result.data)) {
        const dataSize = result.data.length;
        
        if (dataSize > 150) {
            log.info('Compactifying large tool result', {
                toolName,
                originalSize: dataSize
            });

            // Aggressive sampling for very large datasets (>200 points)
            if (dataSize > 200) {
                const targetSize = 80; // Reduced from 100
                const step = Math.ceil(dataSize / targetSize);
                const compactData = result.data.filter((_, index) => index % step === 0);
                
                // Always include last point
                if (compactData[compactData.length - 1] !== result.data[dataSize - 1]) {
                    compactData.push(result.data[dataSize - 1]);
                }
                
                return {
                    ...result,
                    data: compactData,
                    note: `Dataset sampled from ${dataSize} to ${compactData.length} points for optimization. Use more specific time ranges or metrics if you need more detail.`
                };
            }
            
            // Moderate sampling for medium datasets (150-200 points)
            const targetSize = 100;
            const step = Math.ceil(dataSize / targetSize);
            const compactData = result.data.filter((_, index) => index % step === 0);
            
            return {
                ...result,
                data: compactData,
                note: `Dataset sampled from ${dataSize} to ${compactData.length} points. Request specific time ranges for full resolution.`
            };
        }
    }

    return result;
}

function calculateConfidence(insightsText, toolCalls) {
    let confidence = 100;

    if (!toolCalls || toolCalls.length === 0) {
        confidence -= 15;
    }

    const uncertaintyPhrases = [
        'insufficient data',
        'limited data',
        'cannot determine',
        'unable to calculate',
        'not enough',
        'unavailable'
    ];

    for (const phrase of uncertaintyPhrases) {
        if (insightsText.toLowerCase().includes(phrase)) {
            confidence -= 20;
            break;
        }
    }

    const qualityIndicators = [
        'high confidence',
        'strong correlation',
        'consistent pattern',
        'reliable data'
    ];

    for (const indicator of qualityIndicators) {
        if (insightsText.toLowerCase().includes(indicator)) {
            confidence += 5;
            break;
        }
    }

    if (toolCalls && toolCalls.length > 0) {
        const advancedTools = toolCalls.filter(t =>
            t.name && (
                t.name.includes('predict') ||
                t.name.includes('pattern') ||
                t.name.includes('budget')
            )
        );
        if (advancedTools.length > 0) {
            confidence += 10;
        }
    }

    return Math.max(0, Math.min(100, Math.round(confidence)));
}

function formatInsightsResponse(text, toolCalls = [], confidence = null) {
    if (typeof text !== 'string') {
        return text;
    }

    // Don't double-format if already formatted
    if (text.includes('═══') || text.includes('🔋')) {
        return text;
    }

    // Don't add wrapper if content already has markdown structure
    if (text.includes('## KEY FINDINGS') || text.includes('## OPERATIONAL STATUS')) {
        return text.trim();
    }

    if (confidence === null) {
        confidence = calculateConfidence(text, toolCalls);
    }

    const lines = [];
    lines.push('═══════════════════════════════════════════════════');
    lines.push('🔋 OFF-GRID ENERGY INTELLIGENCE');
    lines.push('═══════════════════════════════════════════════════');

    if (confidence !== null) {
        const confidenceIcon = confidence >= 80 ? '✓' : confidence >= 60 ? '~' : '!';
        lines.push(`📊 Confidence: ${confidenceIcon} ${confidence}%`);
    }

    if (toolCalls && toolCalls.length > 0) {
        lines.push(`🔍 Data Sources: ${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''} queried`);
    }

    lines.push('═══════════════════════════════════════════════════');
    lines.push('');
    lines.push(text.trim());
    lines.push('');
    lines.push('═══════════════════════════════════════════════════');
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push('═══════════════════════════════════════════════════');

    return lines.join('\n');
}

function buildInsightsPayload(text, toolCalls, contextSummary) {
    const payload = {
        rawText: text,
        formattedText: formatInsightsResponse(text, toolCalls),
        healthStatus: 'Generated',
        performance: { trend: 'See analysis above' }
    };

    if (contextSummary) {
        payload.contextSummary = contextSummary;
    }

    return payload;
}

async function runGuruConversation(options) {
    const {
        model,
        analysisData = {},
        systemId,
        customPrompt,
        log: providedLog,
        mode = 'sync',
        maxIterations = 10,
        iterationTimeoutMs = 25_000,
        totalTimeoutMs = 58_000,
        conversationTokenLimit = DEFAULT_CONVERSATION_TOKEN_LIMIT,
        tokensPerChar = TOKENS_PER_CHAR,
        hooks = {}
    } = options || {};

    const log = ensureLog(providedLog);

    if (!model || typeof model.generateContent !== 'function') {
        throw new Error('runGuruConversation requires a valid Gemini model instance');
    }

    const {
        prompt: initialPrompt,
        contextSummary
    } = await buildGuruPrompt({
        analysisData,
        systemId,
        customPrompt,
        log,
        mode
    });

    // Notify about context that was built
    await callHook(hooks.onContextBuilt, {
        contextSummary,
        promptLength: initialPrompt.length,
        mode
    }, log, 'onContextBuilt');

    const conversationHistory = [{ role: 'user', content: initialPrompt }];
    const toolCallsExecuted = [];
    const startTime = Date.now();

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
        const elapsedMs = Date.now() - startTime;
        const remainingMs = totalTimeoutMs - elapsedMs;
        
        if (elapsedMs > totalTimeoutMs) {
            const error = new Error(`Analysis exceeded time limit (${Math.floor(totalTimeoutMs / 1000)}s). Try a simpler question or smaller time range.`);
            await callHook(hooks.onError, { error, iteration, toolCalls: toolCallsExecuted }, log, 'onError');
            throw error;
        }

        await callHook(hooks.onIterationStart, { iteration, elapsedMs }, log, 'onIterationStart');

        log.info('Function calling iteration started', { 
            iteration, 
            elapsedMs, 
            remainingMs,
            remainingSec: Math.floor(remainingMs / 1000),
            toolCallsSoFar: toolCallsExecuted.length
        });

        const prunedHistory = pruneConversationHistory(conversationHistory, conversationTokenLimit, tokensPerChar, log);
        const conversationText = prunedHistory.map(msg =>
            `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
        ).join('\n\n');

        // VERBOSE LOGGING: Log the full prompt being sent to Gemini
        const promptPreview = conversationText.length > 2000 
            ? `${conversationText.substring(0, 2000)}... [truncated ${conversationText.length - 2000} chars]`
            : conversationText;
        log.info('📤 GEMINI REQUEST - Sending prompt to Gemini', {
            iteration,
            conversationMessages: prunedHistory.length,
            totalChars: conversationText.length,
            estimatedTokens: Math.round(conversationText.length * tokensPerChar),
            promptPreview
        });
        
        // Hook for tracking what we're sending to Gemini - VERBOSE
        await callHook(hooks.onPromptSent, {
            iteration,
            promptLength: conversationText.length,
            messageCount: prunedHistory.length,
            promptPreview,
            fullPrompt: conversationText  // Send full prompt for display
        }, log, 'onPromptSent');

        let response;
        try {
            const iterationStart = Date.now();
            const responsePromise = model.generateContent(conversationText);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Iteration timeout')), iterationTimeoutMs)
            );
            response = await Promise.race([responsePromise, timeoutPromise]);
            
            const iterationDuration = Date.now() - iterationStart;
            log.info('Gemini API response received', {
                iteration,
                durationMs: iterationDuration,
                durationSec: (iterationDuration / 1000).toFixed(1)
            });
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            if (err.message === 'Iteration timeout') {
                const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
                const timeoutError = new Error(`AI processing took too long at iteration ${iteration}/${maxIterations} (${elapsedSec}s elapsed). Try simplifying your question or using a smaller time range.`);
                log.error('Iteration timeout', {
                    iteration,
                    maxIterations,
                    elapsedSec,
                    iterationTimeoutSec: iterationTimeoutMs / 1000,
                    toolCallsSoFar: toolCallsExecuted.length
                });
                await callHook(hooks.onError, { error: timeoutError, iteration, toolCalls: toolCallsExecuted }, log, 'onError');
                throw timeoutError;
            }
            await callHook(hooks.onError, { error: err, iteration, toolCalls: toolCallsExecuted }, log, 'onError');
            throw err;
        }

        const responseText = response.response?.text?.() || '';
        
        // VERBOSE LOGGING: Log the full response from Gemini
        const responsePreview = responseText.length > 1000
            ? `${responseText.substring(0, 1000)}... [truncated ${responseText.length - 1000} chars]`
            : responseText;
        log.info('📥 GEMINI RESPONSE - Received from Gemini', {
            iteration,
            responseLength: responseText.length,
            responsePreview
        });
        
        // Hook for tracking what we received from Gemini - VERBOSE
        await callHook(hooks.onResponseReceived, {
            iteration,
            responseLength: responseText.length,
            responsePreview,
            fullResponse: responseText,  // Send full response for display
            isEmpty: !responseText || responseText.trim().length === 0
        }, log, 'onResponseReceived');

        // Safety check: If response is empty, warn and try to recover
        if (!responseText || responseText.trim().length === 0) {
            log.error('❌ EMPTY RESPONSE from Gemini - This is a critical error', { 
                iteration,
                toolCallsSoFar: toolCallsExecuted.length,
                conversationLength: conversationHistory.length
            });
            
            // If we've had 2+ empty responses in a row, give up
            const recentMessages = conversationHistory.slice(-3);
            const emptyResponseCount = recentMessages.filter(msg => 
                msg.role === 'user' && msg.content.includes('Your last response was empty')
            ).length;
            
            if (emptyResponseCount >= 2) {
                log.error('Multiple consecutive empty responses - aborting to prevent infinite loop', { 
                    iteration,
                    emptyResponseCount 
                });
                throw new Error('Gemini is not responding properly after multiple attempts. This may be a temporary API issue. Please try again in a moment.');
            }
            
            // Add a VERY FORCEFUL user message demanding a valid JSON response
            conversationHistory.push({ 
                role: 'user', 
                content: `🚨 CRITICAL ERROR: Your last response was EMPTY. This is iteration ${iteration}/${maxIterations}.

You MUST respond with valid JSON. Choose ONE:

1. If you need data, respond EXACTLY like this:
{
  "tool_call": "request_bms_data",
  "parameters": {
    "systemId": "use the system ID from context",
    "metric": "voltage",
    "time_range_start": "2025-11-01T00:00:00Z",
    "time_range_end": "2025-11-08T00:00:00Z",
    "granularity": "daily_avg"
  }
}

2. If you can analyze with existing data, respond EXACTLY like this:
{
  "final_answer": "## KEY FINDINGS\\n\\n**Battery Status:** Based on the data provided...\\n\\n## RECOMMENDATIONS\\n\\n1. 🟢 Monitor..."
}

DO NOT respond with anything else. DO NOT use markdown. DO NOT explain. ONLY valid JSON.` 
            });
            continue;
        }

        let parsedResponse;
        try {
            parsedResponse = JSON.parse(responseText.trim());
        } catch {
            const jsonBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (jsonBlockMatch) {
                try {
                    parsedResponse = JSON.parse(jsonBlockMatch[1].trim());
                } catch {
                    parsedResponse = null;
                }
            } else {
                const jsonObjectMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonObjectMatch) {
                    try {
                        parsedResponse = JSON.parse(jsonObjectMatch[0]);
                    } catch {
                        parsedResponse = null;
                    }
                } else {
                    parsedResponse = null;
                }
            }
        }

        // VERBOSE LOGGING: Log what we parsed
        if (parsedResponse) {
            log.info('📋 Parsed JSON response', {
                iteration,
                hasToolCall: !!parsedResponse.tool_call,
                hasFinalAnswer: !!parsedResponse.final_answer,
                toolName: parsedResponse.tool_call,
                responseKeys: Object.keys(parsedResponse)
            });
        } else if (responseText) {
            log.error('❌ NON-JSON response from Gemini - attempting recovery', {
                iteration,
                responseLength: responseText.length,
                responsePreview: responseText.substring(0, 300)
            });
            
            // Check if Gemini is trying to be helpful with explanatory text
            // Sometimes it says things like "I need more data" or "Let me analyze"
            const needsDataPhrases = [
                'need more data', 'need additional', 'require more', 'insufficient',
                'let me request', 'let me query', 'I should request'
            ];
            const hasDataRequest = needsDataPhrases.some(phrase => 
                responseText.toLowerCase().includes(phrase)
            );
            
            if (hasDataRequest && iteration < maxIterations - 1) {
                // Gemini is indicating it needs data but didn't format properly
                // Add its malformed response to history so it sees its mistake
                conversationHistory.push({ role: 'assistant', content: responseText });
                conversationHistory.push({
                    role: 'user',
                    content: `You indicated you need data, but your response was not valid JSON. Please respond with ONLY a tool_call JSON object like this example:

{
  "tool_call": "request_bms_data",
  "parameters": {
    "systemId": "use the system ID from context",
    "metric": "voltage",
    "time_range_start": "2025-11-01T00:00:00Z",
    "time_range_end": "2025-11-08T00:00:00Z",
    "granularity": "daily_avg"
  }
}

NO other text. ONLY the JSON object.`
                });
                continue;
            }
            
            // If it's a meaningful response but not JSON, try to use it as final answer
            if (responseText.length > 100) {
                log.warn('Treating non-JSON response as final answer text', { iteration });
                // This will fall through to the responseText handler below
            } else {
                // Short non-JSON response is likely gibberish - demand proper format
                // Add its malformed response to history so it sees its mistake
                conversationHistory.push({ role: 'assistant', content: responseText });
                conversationHistory.push({
                    role: 'user',
                    content: `Your response was not valid JSON and too short to be useful. You are on iteration ${iteration}/${maxIterations}.

You MUST respond with valid JSON in ONE of these formats:

Tool call:
{ "tool_call": "tool_name", "parameters": {...} }

Final answer:
{ "final_answer": "## KEY FINDINGS\\n\\n**Finding:** ...\\n\\n## RECOMMENDATIONS\\n\\n1. ..." }

Respond NOW with valid JSON ONLY.`
                });
                continue;
            }
        }

        if (parsedResponse && parsedResponse.tool_call) {
            const { tool_call: toolName, parameters = {} } = parsedResponse;
            
            // VERBOSE LOGGING: Log full tool call details
            log.info('🔧 TOOL CALL REQUESTED by Gemini', { 
                iteration, 
                toolName, 
                parameters,
                fullRequest: JSON.stringify(parsedResponse, null, 2)
            });
            
            await callHook(hooks.onToolCall, { 
                iteration, 
                name: toolName, 
                parameters, 
                rawRequest: parsedResponse,
                fullRequest: JSON.stringify(parsedResponse, null, 2)  // Full formatted request
            }, log, 'onToolCall');

            const toolStart = Date.now();
            const toolResult = await executeToolCall(toolName, parameters, log);
            const toolDuration = Date.now() - toolStart;

            const compactResult = compactifyToolResult(toolResult, toolName, log);

            // VERBOSE LOGGING: Log full tool result
            const resultPreview = JSON.stringify(compactResult).length > 500
                ? `${JSON.stringify(compactResult).substring(0, 500)}... [truncated]`
                : JSON.stringify(compactResult);
            log.info('📊 TOOL RESULT returned', {
                iteration,
                toolName,
                durationMs: toolDuration,
                success: !(toolResult && toolResult.error),
                resultPreview
            });

            const toolCallRecord = {
                name: toolName,
                parameters,
                iteration,
                durationMs: toolDuration
            };
            toolCallsExecuted.push(toolCallRecord);

            await callHook(hooks.onToolResult, {
                iteration,
                name: toolName,
                durationMs: toolDuration,
                result: compactResult,
                fullResult: JSON.stringify(compactResult, null, 2),  // Full formatted result
                error: toolResult && toolResult.error ? toolResult.message || 'Unknown error' : null,
                parameters  // Include parameters in the hook so UI can show what was requested
            }, log, 'onToolResult');

            if (toolResult && toolResult.error) {
                log.warn('Tool execution returned error', { iteration, toolName, error: toolResult.message });
                conversationHistory.push({ role: 'assistant', content: JSON.stringify(parsedResponse) });
                conversationHistory.push({
                    role: 'user',
                    content: `Tool execution error: ${toolResult.message}. Please adjust your request or provide an answer with available data.`
                });
                continue;
            }

            conversationHistory.push({ role: 'assistant', content: JSON.stringify(parsedResponse) });
            conversationHistory.push({
                role: 'user',
                content: `Tool response from ${toolName}:\n${JSON.stringify(compactResult, null, 2)}\n\n⚠️ ITERATION ${iteration + 1}/${maxIterations} - You have ${maxIterations - iteration} iterations left. Review the data and either:\n1. Request ONE MORE specific data point if absolutely needed (tool_call JSON), OR\n2. Provide your final analysis NOW (final_answer JSON).\n\nPrefer option 2 unless you genuinely lack critical data.`
            });
            continue;
        }

        if (parsedResponse && parsedResponse.final_answer) {
            const answerText = parsedResponse.final_answer;
            await callHook(hooks.onPartialUpdate, { text: answerText, iteration, final: true }, log, 'onPartialUpdate');
            await callHook(hooks.onFinalAnswer, { iteration, toolCalls: toolCallsExecuted, insightsText: answerText }, log, 'onFinalAnswer');

            const insights = buildInsightsPayload(answerText, toolCallsExecuted, contextSummary);
            return {
                insights,
                toolCalls: toolCallsExecuted,
                usedFunctionCalling: toolCallsExecuted.length > 0,
                iterations: iteration,
                contextSummary
            };
        }

        if (responseText) {
            await callHook(hooks.onPartialUpdate, { text: responseText, iteration, final: true }, log, 'onPartialUpdate');
            await callHook(hooks.onFinalAnswer, { iteration, toolCalls: toolCallsExecuted, insightsText: responseText }, log, 'onFinalAnswer');

            const insights = buildInsightsPayload(responseText, toolCallsExecuted, contextSummary);
            return {
                insights,
                toolCalls: toolCallsExecuted,
                usedFunctionCalling: toolCallsExecuted.length > 0,
                iterations: iteration,
                contextSummary
            };
        }
    }

    const fallbackText = 'Analysis could not be completed within iteration limit. Please try a simpler question.';
    await callHook(hooks.onPartialUpdate, { text: fallbackText, iteration: null, final: true }, log, 'onPartialUpdate');
    await callHook(hooks.onFinalAnswer, { iteration: null, toolCalls: [], insightsText: fallbackText, warning: 'Max iterations reached' }, log, 'onFinalAnswer');

    const insights = buildInsightsPayload(fallbackText, [], contextSummary);

    return {
        insights,
        toolCalls: [],
        usedFunctionCalling: false,
        iterations: maxIterations,
        contextSummary,
        warning: 'Max iterations reached'
    };
}

module.exports = {
    runGuruConversation,
    TOKENS_PER_CHAR,
    DEFAULT_CONVERSATION_TOKEN_LIMIT
};
