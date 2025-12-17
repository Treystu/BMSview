"use strict";

/**
 * Model Pricing Endpoint
 * Exposes Gemini model pricing information to the frontend
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { getCurrentModelInfo, getModelPricing, GEMINI_PRICING } = require('./utils/metrics-collector.cjs');
const {
    createStandardEntryMeta,
    logDebugRequestSummary
} = require('./utils/handler-logging.cjs');

/**
 * @typedef {{
 *  inputTokens: number,
 *  outputTokens: number,
 *  description?: string
 * }} GeminiPricing
 */

/**
 * @typedef {Record<string, GeminiPricing>} GeminiPricingMap
 */

/**
 * Main handler for model pricing endpoint
 */
/**
 * @param {any} event
 * @param {any} context
 */
exports.handler = async (event, context) => {
    const log = createLoggerFromEvent('model-pricing', event, context);
    /** @type {any} */
    const timer = createTimer(log, 'model-pricing');
    const headers = getCorsHeaders(event);
    log.entry(createStandardEntryMeta(event));
    logDebugRequestSummary(log, event, { label: 'Model pricing request', includeBody: false });

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
        /** @type {Record<string, unknown>} */
        const queryParams = event.queryStringParameters || {};
        const requestedModel = typeof queryParams.model === 'string' ? queryParams.model : undefined;

        /** @type {GeminiPricingMap} */
        const PRICING_MAP = /** @type {any} */ (GEMINI_PRICING);

        // If specific model requested, return pricing for that model
        if (requestedModel) {
            log.info('Fetching pricing for specific model', { requestedModel });
            /** @type {GeminiPricing} */
            const pricing = /** @type {any} */ (getModelPricing(requestedModel));
            const isKnown = !!PRICING_MAP[requestedModel] ||
                Object.keys(PRICING_MAP).some(key => requestedModel.startsWith(key));

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
        /** @type {Record<string, { inputPerMillion: number, outputPerMillion: number, description?: string }>} */
        const allPricing = {};
        for (const [model, pricing] of /** @type {[string, GeminiPricing][]} */ (Object.entries(PRICING_MAP))) {
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
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        log.error('Failed to get model pricing', { error: message, stack });
        timer.end({ outcome: 'error' });
        log.exit(500, { outcome: 'error' });

        return {
            statusCode: 500,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Failed to retrieve model pricing',
                message
            })
        };
    }
};
