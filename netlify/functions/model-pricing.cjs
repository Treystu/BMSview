"use strict";

/**
 * Model Pricing Endpoint
 * Exposes Gemini model pricing information to the frontend
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { getCurrentModelInfo, getModelPricing, GEMINI_PRICING } = require('./utils/metrics-collector.cjs');
const sanitizeHeaders = (headers = {}) => {
    const redacted = { ...headers };
    if (redacted.authorization) redacted.authorization = '[REDACTED]';
    if (redacted.cookie) redacted.cookie = '[REDACTED]';
    if (redacted['x-api-key']) redacted['x-api-key'] = '[REDACTED]';
    return redacted;
};

/**
 * Main handler for model pricing endpoint
 */
exports.handler = async (event, context) => {
    const log = createLoggerFromEvent('model-pricing', event, context);
    const timer = createTimer(log, 'model-pricing');
    const headers = getCorsHeaders(event);
    const entryMeta = {
        method: event.httpMethod,
        path: event.path,
        query: event.queryStringParameters,
        headers: sanitizeHeaders(event.headers)
    };
    log.entry(entryMeta);
    
    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        timer.end({ outcome: 'preflight' });
        log.exit(200, { outcome: 'preflight' });
        return { statusCode: 200, headers };
    }
    
    if (event.httpMethod !== 'GET') {
        timer.end({ outcome: 'method_not_allowed' });
        log.exit(405, { outcome: 'method_not_allowed' });
        return {
            statusCode: 405,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
    
    try {
        const queryParams = event.queryStringParameters || {};
        const requestedModel = queryParams.model;
        
        // If specific model requested, return pricing for that model
        if (requestedModel) {
            log.info('Fetching pricing for specific model', { requestedModel });
            const pricing = getModelPricing(requestedModel);
            const isKnown = !!GEMINI_PRICING[requestedModel] || 
                Object.keys(GEMINI_PRICING).some(key => requestedModel.startsWith(key));
            
            timer.end({ outcome: 'success', model: requestedModel, isKnown });
            log.exit(200, { outcome: 'success', model: requestedModel });
            return {
                statusCode: 200,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: requestedModel,
                    isKnown,
                    pricing: {
                        inputPerMillion: pricing.inputTokens * 1_000_000,
                        outputPerMillion: pricing.outputTokens * 1_000_000,
                        description: pricing.description || (isKnown ? 'Known model' : 'Unknown model - using default pricing')
                    }
                })
            };
        }
        
        // Return current model info and all available pricing
        const currentModelInfo = getCurrentModelInfo();
        
        // Format all pricing for frontend consumption
        const allPricing = {};
        for (const [model, pricing] of Object.entries(GEMINI_PRICING)) {
            allPricing[model] = {
                inputPerMillion: pricing.inputTokens * 1_000_000,
                outputPerMillion: pricing.outputTokens * 1_000_000,
                description: pricing.description
            };
        }
        
        timer.end({ outcome: 'success', totalModels: Object.keys(allPricing).length });
        log.exit(200, { outcome: 'success' });
        return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentModel: currentModelInfo,
                allModels: allPricing,
                defaultModel: 'gemini-2.5-flash'
            })
        };
        
    } catch (error) {
        log.error('Failed to get model pricing', { error: error.message, stack: error.stack });
        timer.end({ outcome: 'error' });
        log.exit(500, { outcome: 'error' });
        
        return {
            statusCode: 500,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Failed to retrieve model pricing',
                message: error.message
            })
        };
    }
};
