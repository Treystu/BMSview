"use strict";

/**
 * Model Pricing Endpoint
 * Exposes Gemini model pricing information to the frontend
 */

const { createLoggerFromEvent, createTimer, createLogger } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { getCurrentModelInfo, getModelPricing, GEMINI_PRICING } = require('./utils/metrics-collector.cjs');

const log = createLogger('model-pricing');

/**
 * Main handler for model pricing endpoint
 */
exports.handler = async (event, context) => {
    const headers = getCorsHeaders(event);
    
    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }
    
    if (event.httpMethod !== 'GET') {
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
            const pricing = getModelPricing(requestedModel);
            const isKnown = !!GEMINI_PRICING[requestedModel] || 
                Object.keys(GEMINI_PRICING).some(key => requestedModel.startsWith(key));
            
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
        log.error('Failed to get model pricing', { error: error.message });
        
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
