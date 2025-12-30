/**
 * AI Budget Settings Endpoint
 * Allows admins to view and update AI cost management thresholds.
 * 
 * Endpoints:
 * - GET /ai-budget-settings - Returns current budget settings
 * - POST /ai-budget-settings - Updates budget settings
 * 
 * MongoDB Collection: app_settings
 */

const { getCollection } = require('./utils/mongodb.cjs');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { errorResponse } = require('./utils/errors.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

// Default values (same as usage-stats.cjs)
const DEFAULTS = {
    monthlyTokenBudget: 5_000_000,  // 5M tokens
    monthlyCostBudget: 10,          // $10
    alertThreshold: 0.8             // 80%
};

const SETTINGS_KEY = 'ai_budget_settings';

/**
 * Get current budget settings from database or defaults
 * @param {import('./utils/logger.cjs').LogFunction} log
 */
async function getBudgetSettings(log) {
    try {
        const collection = await getCollection('app_settings');
        const settings = await collection.findOne({ key: SETTINGS_KEY });

        if (settings && settings.value) {
            log.debug('Retrieved budget settings from database', { settings: settings.value });
            return {
                monthlyTokenBudget: settings.value.monthlyTokenBudget ?? DEFAULTS.monthlyTokenBudget,
                monthlyCostBudget: settings.value.monthlyCostBudget ?? DEFAULTS.monthlyCostBudget,
                alertThreshold: settings.value.alertThreshold ?? DEFAULTS.alertThreshold,
                updatedAt: settings.value.updatedAt,
                updatedBy: settings.value.updatedBy
            };
        }

        log.debug('No budget settings in database, using defaults');
        return { ...DEFAULTS };
    } catch (error) {
        log.error('Failed to get budget settings', { error: error instanceof Error ? error.message : String(error) });
        return { ...DEFAULTS };
    }
}

/**
 * @typedef {Object} BudgetSettings
 * @property {string|number} monthlyTokenBudget
 * @property {string|number} monthlyCostBudget
 * @property {string|number} alertThreshold
 * @property {string} [updatedBy]
 */

/**
 * Update budget settings in database
 * @param {BudgetSettings} newSettings
 * @param {import('./utils/logger.cjs').LogFunction} log
 */
async function updateBudgetSettings(newSettings, log) {
    const collection = await getCollection('app_settings');

    // Validate inputs
    const monthlyTokenBudget = parseInt(String(newSettings.monthlyTokenBudget), 10);
    const monthlyCostBudget = parseFloat(String(newSettings.monthlyCostBudget));
    const alertThreshold = parseFloat(String(newSettings.alertThreshold));

    if (isNaN(monthlyTokenBudget) || monthlyTokenBudget < 100000) {
        throw new Error('monthlyTokenBudget must be at least 100,000 tokens');
    }
    if (isNaN(monthlyCostBudget) || monthlyCostBudget < 0.01) {
        throw new Error('monthlyCostBudget must be at least $0.01');
    }
    if (isNaN(alertThreshold) || alertThreshold < 0.1 || alertThreshold > 1.0) {
        throw new Error('alertThreshold must be between 0.1 (10%) and 1.0 (100%)');
    }

    const value = {
        monthlyTokenBudget,
        monthlyCostBudget,
        alertThreshold,
        updatedAt: new Date().toISOString(),
        updatedBy: newSettings.updatedBy || 'admin'
    };

    await collection.updateOne(
        { key: SETTINGS_KEY },
        { $set: { key: SETTINGS_KEY, value } },
        { upsert: true }
    );

    log.audit('admin_action', {
        action: 'update_budget_settings',
        ...value
    });

    log.info('Budget settings updated', {
        monthlyTokenBudget,
        monthlyCostBudget,
        alertThreshold
    });

    return value;
}

/**
 * Main handler
 * @param {import('./utils/jsdoc-types.cjs').NetlifyEvent} event
 * @param {import('./utils/jsdoc-types.cjs').NetlifyContext} context
 */
exports.handler = async (event, context) => {
    const log = createLoggerFromEvent('ai-budget-settings', event, context);
    const timer = createTimer(log, 'ai-budget-settings');
    const headers = getCorsHeaders(event);

    log.entry({
        method: event.httpMethod,
        path: event.path
    });

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        timer.end({ outcome: 'preflight' });
        return { statusCode: 200, headers };
    }

    try {
        if (event.httpMethod === 'GET') {
            const settings = await getBudgetSettings(log);
            timer.end({ action: 'get' });
            log.exit(200);

            return {
                statusCode: 200,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: true,
                    settings,
                    defaults: DEFAULTS
                })
            };
        }

        if (event.httpMethod === 'POST') {
            let body;
            try {
                body = JSON.parse(event.body || '{}');
            } catch {
                return errorResponse(400, 'invalid_json', 'Invalid JSON body', undefined, headers);
            }

            const updatedSettings = await updateBudgetSettings(body, log);
            timer.end({ action: 'update' });
            log.exit(200);

            return {
                statusCode: 200,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: true,
                    settings: updatedSettings,
                    message: 'Budget settings updated successfully'
                })
            };
        }

        return errorResponse(405, 'method_not_allowed', 'Method not allowed', undefined, headers);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Failed to handle budget settings', { error: errorMessage });
        timer.end({ error: true });
        log.exit(500);

        return errorResponse(
            500,
            'internal_error',
            errorMessage,
            undefined,
            headers
        );
    }
};
