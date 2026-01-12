/**
 * Usage Stats Endpoint
 * Provides aggregated AI usage statistics for cost monitoring and optimization.
 * 
 * Endpoints:
 * - GET /usage-stats?period=daily|weekly|monthly (default: daily)
 * - GET /usage-stats?startDate=ISO&endDate=ISO (custom date range)
 * - GET /usage-stats/budget - Returns current budget status and alerts
 * 
 * MongoDB Collections Used:
 * - ai_operations: Stores individual AI operation logs
 * - anomaly_alerts: Stores cost-related alerts
 * - budget_alerts: Stores budget warning history to prevent duplicate alerts
 */

const { getCollection } = require('./utils/mongodb.cjs');
const { createLogger, createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { errorResponse } = require('./utils/errors.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { ensureAdminAuthorized } = require('./utils/auth.cjs');
const { getCostMetrics, getRealtimeMetrics, createAlert } = require('./utils/metrics-collector.cjs');
const { v4: uuidv4 } = require('uuid');

const sanitizeHeaders = (headers = {}) => {
    /** @type {Object.<string, string>} */
    const redacted = { ...headers };
    if (redacted['authorization']) redacted['authorization'] = '[REDACTED]';
    if (redacted['cookie']) redacted['cookie'] = '[REDACTED]';
    if (redacted['x-api-key']) redacted['x-api-key'] = '[REDACTED]';
    return redacted;
};

// Budget defaults - configurable via environment variables
const DEFAULT_MONTHLY_TOKEN_BUDGET = 5_000_000; // 5M tokens
const DEFAULT_MONTHLY_COST_BUDGET = 10; // $10
const DEFAULT_ALERT_THRESHOLD = 0.8; // 80%

/**
 * Create a GitHub issue for budget alert (token-based)
 * Uses the feedback object format expected by create-github-issue endpoint
 * @param {number} usagePercent - Current usage percentage
 * @param {number} currentTokens - Current token usage
 * @param {number} monthlyTokenBudget - Monthly token budget limit
 * @param {import('./utils/logger.cjs').LogFunction} log
 * @returns {Promise<Object|null>} GitHub issue response or null
 */
async function createBudgetGitHubIssue(usagePercent, currentTokens, monthlyTokenBudget, log) {
    try {
        const baseUrl = process.env.URL || 'http://localhost:8888';
        /** @param {number} tokens */
        const formatTokens = (tokens) => {
            if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
            if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
            return tokens.toString();
        };

        const now = new Date();
        const alertType = usagePercent >= 100 ? 'exceeded' : 'warning';

        // Create feedback object in the format expected by create-github-issue endpoint
        // ID includes year, month, day, and alert type for uniqueness while allowing duplicate detection
        const feedback = {
            id: `budget-alert-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${alertType}-${Math.round(usagePercent)}pct`,
            timestamp: now.toISOString(),
            systemId: 'system',
            feedbackType: 'cost_management',
            category: 'budget_alert',
            priority: usagePercent >= 100 ? 'critical' : 'high',
            geminiModel: 'system-generated',
            suggestion: {
                title: `AI Token Budget Alert: ${usagePercent.toFixed(1)}% of monthly budget used`,
                description: `The AI token usage has reached ${usagePercent.toFixed(1)}% of the monthly budget (${formatTokens(currentTokens)} of ${formatTokens(monthlyTokenBudget)} tokens).`,
                rationale: usagePercent >= 100
                    ? 'Monthly token budget has been exceeded. Immediate attention required to prevent service disruption or unexpected costs.'
                    : 'Token usage is approaching the monthly budget limit. Review and optimization recommended.',
                implementation: usagePercent >= 100
                    ? '1. Review recent high-token operations in the Cost Dashboard\n2. Consider pausing non-essential AI operations\n3. Increase monthly token budget if usage is justified'
                    : '1. Monitor daily token usage trends in the Cost Dashboard\n2. Review operation efficiency and identify optimization opportunities\n3. Consider increasing token budget if current usage pattern is expected',
                expectedBenefit: 'Prevent budget overruns and maintain cost visibility for AI operations.',
                estimatedEffort: 'Low - Review and adjust budget settings',
                affectedComponents: ['Cost Dashboard', 'AI Operations']
            }
        };

        const response = await fetch(`${baseUrl}/.netlify/functions/create-github-issue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feedback })
        });

        if (response.ok) {
            const result = await response.json();
            log.info('Budget alert GitHub issue created', { issueNumber: result.number });
            return result;
        } else {
            const errorText = await response.text();
            log.warn('Failed to create budget alert GitHub issue', {
                status: response.status,
                error: errorText
            });
            return null;
        }
    } catch (error) {
        const err = /** @type {Error} */ (error);
        log.error('Error creating budget alert GitHub issue', { error: err.message });
        return null;
    }
}

/**
 * Check and create budget alert if token threshold exceeded
 * @param {number} usagePercent - Current usage percentage  
 * @param {number} currentTokens - Current token usage
 * @param {number} monthlyTokenBudget - Monthly token budget
 * @param {number} alertThreshold - Alert threshold (e.g., 0.8 for 80%)
 * @param {import('./utils/logger.cjs').LogFunction} log
 * @returns {Promise<Object|null>} Alert created or null
 */
async function checkAndCreateBudgetAlert(usagePercent, currentTokens, monthlyTokenBudget, alertThreshold, log) {
    // Only alert if above threshold
    if (usagePercent < alertThreshold * 100) {
        return null;
    }

    const budgetAlertsCollection = await getCollection('budget_alerts');
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Check if we already sent an alert for this month and threshold level
    const alertType = usagePercent >= 100 ? 'exceeded' : 'warning';
    const existingAlert = await budgetAlertsCollection.findOne({
        month: currentMonth,
        alertType: alertType
    });

    if (existingAlert) {
        log.debug('Budget alert already sent for this month/level', {
            month: currentMonth,
            alertType,
            existingAlertId: existingAlert.id
        });
        return null;
    }

    // Create internal alert
    await createAlert({
        severity: usagePercent >= 100 ? 'critical' : 'high',
        type: 'budget_warning',
        message: `AI token budget ${alertType}: ${usagePercent.toFixed(1)}% of ${(monthlyTokenBudget / 1_000_000).toFixed(1)}M monthly token budget used (${(currentTokens / 1_000_000).toFixed(2)}M tokens)`,
        metadata: {
            usagePercent,
            currentTokens,
            monthlyTokenBudget,
            month: currentMonth
        }
    });

    // Create GitHub issue
    const githubIssue = await createBudgetGitHubIssue(usagePercent, currentTokens, monthlyTokenBudget, log);

    // Record that we've sent this alert
    const alertRecord = {
        id: uuidv4(),
        month: currentMonth,
        alertType,
        usagePercent,
        currentTokens,
        monthlyTokenBudget,
        githubIssue: githubIssue ? {
            number: /** @type {any} */ (githubIssue).number,
            url: /** @type {any} */ (githubIssue).html_url
        } : null,
        createdAt: now.toISOString()
    };

    await budgetAlertsCollection.insertOne(alertRecord);

    log.info('Budget alert created', {
        alertType,
        usagePercent,
        currentTokens,
        hasGitHubIssue: !!githubIssue
    });

    return alertRecord;
}

/**
 * Get daily breakdown of AI costs
 * @param {Date} startDate - Start of date range
 * @param {Date} endDate - End of date range
 * @returns {Promise<Object[]>} Daily cost breakdown
 */
async function getDailyBreakdown(startDate, endDate) {
    const collection = await getCollection('ai_operations');

    const pipeline = [
        {
            $match: {
                timestamp: {
                    $gte: startDate.toISOString(),
                    $lte: endDate.toISOString()
                }
            }
        },
        {
            $addFields: {
                date: {
                    $dateToString: {
                        format: '%Y-%m-%d',
                        date: { $toDate: '$timestamp' }
                    }
                }
            }
        },
        {
            $group: {
                _id: '$date',
                totalCost: { $sum: { $ifNull: ['$cost', 0] } },
                totalInputTokens: { $sum: { $ifNull: ['$inputTokens', 0] } },
                totalOutputTokens: { $sum: { $ifNull: ['$outputTokens', 0] } },
                operationCount: { $sum: 1 },
                successCount: {
                    $sum: {
                        $cond: [{ $eq: ['$success', true] }, 1, 0]
                    }
                },
                errorCount: {
                    $sum: {
                        $cond: [{ $eq: ['$success', false] }, 1, 0]
                    }
                },
                avgDuration: { $avg: '$duration' },
                operations: {
                    $push: {
                        operation: '$operation',
                        cost: '$cost',
                        success: '$success'
                    }
                }
            }
        },
        {
            $project: {
                date: '$_id',
                totalCost: { $round: ['$totalCost', 6] },
                totalInputTokens: 1,
                totalOutputTokens: 1,
                operationCount: 1,
                successCount: 1,
                errorCount: 1,
                avgDuration: { $round: ['$avgDuration', 0] },
                successRate: {
                    $round: [
                        { $multiply: [{ $divide: ['$successCount', '$operationCount'] }, 100] },
                        1
                    ]
                },
                breakdown: {
                    analysis: {
                        $size: {
                            $filter: {
                                input: '$operations',
                                cond: { $eq: ['$$this.operation', 'analysis'] }
                            }
                        }
                    },
                    insights: {
                        $size: {
                            $filter: {
                                input: '$operations',
                                cond: { $eq: ['$$this.operation', 'insights'] }
                            }
                        }
                    },
                    feedback: {
                        $size: {
                            $filter: {
                                input: '$operations',
                                cond: {
                                    $or: [
                                        { $eq: ['$$this.operation', 'feedback_generation'] },
                                        { $eq: ['$$this.operation', 'feedbackGeneration'] }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        },
        { $sort: { date: 1 } }
    ];

    return await collection.aggregate(pipeline).toArray();
}

/**
 * Get budget status and alerts (token-based primary, cost secondary)
 * @returns {Promise<Object>} Budget status
 */
/**
 * @typedef {Object} BudgetStatus
 * @property {Object} tokenBudget - Token budget details
 * @property {Object} costBudget - Cost budget details
 * @property {Object} operationBreakdown
 * @property {string} status
 * @property {Array<any>} recentAlerts
 * @property {Object} period
 * @property {Object} budget - Legacy
 */

/**
 * Get current budget status and usage metrics
 * @param {import('./utils/logger.cjs').LogFunction} [log]
 * @returns {Promise<BudgetStatus>} Budget status object
 */
async function getBudgetStatus(log = createLogger('usage-stats-budget')) {
    const operationsCollection = await getCollection('ai_operations');
    const alertsCollection = await getCollection('anomaly_alerts');
    const settingsCollection = await getCollection('app_settings');

    // Try to get admin-configured settings from database first
    let monthlyTokenBudget = DEFAULT_MONTHLY_TOKEN_BUDGET;
    let monthlyCostBudget = DEFAULT_MONTHLY_COST_BUDGET;
    let alertThreshold = DEFAULT_ALERT_THRESHOLD;

    try {
        const dbSettings = await settingsCollection.findOne({ key: 'ai_budget_settings' });
        if (dbSettings && dbSettings.value) {
            monthlyTokenBudget = dbSettings.value.monthlyTokenBudget ?? monthlyTokenBudget;
            monthlyCostBudget = dbSettings.value.monthlyCostBudget ?? monthlyCostBudget;
            alertThreshold = dbSettings.value.alertThreshold ?? alertThreshold;
            log.debug('Using admin-configured budget settings', {
                monthlyTokenBudget,
                monthlyCostBudget,
                alertThreshold
            });
        }
    } catch (err) {
        const error = /** @type {Error} */ (err);
        log.warn('Failed to load budget settings from database, using defaults', { error: error.message });
    }

    // Environment variables override database settings (for backwards compatibility)
    if (process.env.AI_MONTHLY_TOKEN_BUDGET) {
        monthlyTokenBudget = parseInt(process.env.AI_MONTHLY_TOKEN_BUDGET, 10);
    }
    if (process.env.AI_MONTHLY_COST_BUDGET) {
        monthlyCostBudget = parseFloat(process.env.AI_MONTHLY_COST_BUDGET);
    }
    if (process.env.AI_BUDGET_ALERT_THRESHOLD) {
        alertThreshold = parseFloat(process.env.AI_BUDGET_ALERT_THRESHOLD);
    }

    // Calculate current month's usage
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthlyUsage = await operationsCollection.aggregate([
        {
            $match: {
                timestamp: { $gte: firstOfMonth.toISOString() }
            }
        },
        {
            $group: {
                _id: null,
                totalCost: { $sum: { $ifNull: ['$cost', 0] } },
                totalTokens: { $sum: { $ifNull: ['$tokensUsed', 0] } },
                totalInputTokens: { $sum: { $ifNull: ['$inputTokens', 0] } },
                totalOutputTokens: { $sum: { $ifNull: ['$outputTokens', 0] } },
                operationCount: { $sum: 1 },
                // Breakdown by operation type
                analysisOps: {
                    $sum: { $cond: [{ $eq: ['$operation', 'analysis'] }, 1, 0] }
                },
                insightsOps: {
                    $sum: { $cond: [{ $eq: ['$operation', 'insights'] }, 1, 0] }
                }
            }
        }
    ]).toArray();

    const usage = monthlyUsage[0] || {
        totalCost: 0,
        totalTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        operationCount: 0,
        analysisOps: 0,
        insightsOps: 0
    };

    // Primary metric: tokens
    const tokenUsagePercent = (usage.totalTokens / monthlyTokenBudget) * 100;
    // Secondary metric: cost
    const costUsagePercent = (usage.totalCost / monthlyCostBudget) * 100;

    log.debug('Budget usage calculated', {
        monthlyTokenBudget,
        totalTokens: usage.totalTokens,
        tokenUsagePercent,
        monthlyCostBudget,
        totalCost: usage.totalCost,
        costUsagePercent
    });

    // Get recent alerts
    const recentAlerts = await alertsCollection.find({
        type: { $in: ['cost_spike', 'budget_warning'] },
        resolved: { $ne: true }
    }).sort({ timestamp: -1 }).limit(5).toArray();

    // Determine status based on TOKEN usage (primary)
    let status = 'healthy';
    if (tokenUsagePercent >= 100) {
        status = 'exceeded';
    } else if (tokenUsagePercent >= alertThreshold * 100) {
        status = 'warning';
    }

    // Check and create budget alert if threshold exceeded (token-based)
    // This is async but we don't wait for it to complete
    if (status !== 'healthy') {
        checkAndCreateBudgetAlert(tokenUsagePercent, usage.totalTokens, monthlyTokenBudget, alertThreshold, log)
            .catch(err => {
                const error = /** @type {Error} */ (err);
                log.warn('Failed to check/create budget alert', { error: error.message });
            });
    }

    return {
        // Token budget (primary metric)
        tokenBudget: {
            monthly: monthlyTokenBudget,
            current: usage.totalTokens,
            remaining: monthlyTokenBudget - usage.totalTokens,
            usagePercent: parseFloat(tokenUsagePercent.toFixed(1)),
            alertThreshold: alertThreshold * 100,
            inputTokens: usage.totalInputTokens,
            outputTokens: usage.totalOutputTokens
        },
        // Cost budget (secondary/reference metric)
        costBudget: {
            monthly: monthlyCostBudget,
            current: parseFloat(usage.totalCost.toFixed(4)),
            remaining: parseFloat((monthlyCostBudget - usage.totalCost).toFixed(4)),
            usagePercent: parseFloat(costUsagePercent.toFixed(1))
        },
        // Legacy 'budget' field for backwards compatibility (using token data)
        budget: {
            monthly: monthlyTokenBudget,
            current: usage.totalTokens,
            remaining: monthlyTokenBudget - usage.totalTokens,
            usagePercent: parseFloat(tokenUsagePercent.toFixed(1)),
            alertThreshold: alertThreshold * 100
        },
        status,
        operationBreakdown: {
            analysis: usage.analysisOps,
            insights: usage.insightsOps,
            total: usage.operationCount
        },
        period: {
            start: firstOfMonth.toISOString(),
            end: now.toISOString()
        },
        recentAlerts: recentAlerts.map(a => ({
            id: a.id,
            type: a.type,
            severity: a.severity,
            message: a.message,
            timestamp: a.timestamp
        }))
    };
}

/**
 * Main handler for usage stats endpoint
 * @param {import('./utils/jsdoc-types.cjs').NetlifyEvent} event
 * @param {import('./utils/jsdoc-types.cjs').NetlifyContext} context
 */
exports.handler = async (event, context) => {
    const log = createLoggerFromEvent('usage-stats', event, context);
    const timer = createTimer(log, 'usage-stats');
    const headers = getCorsHeaders(event);

    log.entry({
        method: event.httpMethod,
        path: event.path,
        query: event.queryStringParameters,
        headers: sanitizeHeaders(event.headers),
        bodyLength: event.body ? event.body.length : 0
    });

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        timer.end({ outcome: 'preflight' });
        log.exit(200, { outcome: 'preflight' });
        return { statusCode: 200, headers };
    }

    const authResponse = await ensureAdminAuthorized(event, context, headers, log);
    if (authResponse) {
        timer.end({ outcome: 'unauthorized' });
        log.exit(403, { outcome: 'unauthorized' });
        return authResponse;
    }

    if (event.httpMethod !== 'GET') {
        timer.end({ outcome: 'method_not_allowed' });
        log.exit(405, { outcome: 'method_not_allowed' });
        return errorResponse(405, 'method_not_allowed', 'Method not allowed', undefined, headers);
    }

    try {
        const query = event.queryStringParameters || {};
        const path = event.path || '';

        // Check for budget endpoint
        if (path.endsWith('/budget')) {
            const budgetStatus = await getBudgetStatus(log);
            timer.end({ endpoint: 'budget' });
            log.exit(200);

            return {
                statusCode: 200,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(budgetStatus)
            };
        }

        // Parse date range
        const period = query.period || 'daily';
        let startDate, endDate;

        if (query.startDate && query.endDate) {
            startDate = new Date(query.startDate);
            endDate = new Date(query.endDate);
        } else {
            endDate = new Date();
            switch (period) {
                case 'weekly':
                    startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'monthly':
                    startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
                    break;
                case 'daily':
                default:
                    startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
                    break;
            }
        }

        // Get cost metrics summary
        const costSummary = await getCostMetrics(period, startDate, endDate);

        // Get daily breakdown
        const dailyBreakdown = await getDailyBreakdown(startDate, endDate);

        // Get realtime metrics
        const realtimeMetrics = await getRealtimeMetrics();

        // Get budget status
        const budgetStatus = await getBudgetStatus(log);

        const response = {
            period,
            dateRange: {
                start: startDate.toISOString(),
                end: endDate.toISOString()
            },
            summary: costSummary,
            dailyBreakdown,
            realtime: realtimeMetrics,
            // Expose tokenBudget and costBudget at top level for frontend
            tokenBudget: budgetStatus.tokenBudget,
            costBudget: budgetStatus.costBudget,
            operationBreakdown: budgetStatus.operationBreakdown,
            // Keep budget wrapper for backwards compatibility
            budget: {
                budget: budgetStatus.tokenBudget, // Legacy field
                status: budgetStatus.status,
                recentAlerts: budgetStatus.recentAlerts
            }
        };

        timer.end({ period, days: dailyBreakdown.length });
        log.exit(200);

        return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(response)
        };

    } catch (error) {
        const err = /** @type {Error} */ (error instanceof Error ? error : new Error(String(error)));
        const errorMessage = err.message;
        log.error('Failed to get usage stats', { error: errorMessage, stack: err.stack });
        timer.end({ error: true });
        log.exit(500);

        return errorResponse(
            500,
            'internal_error',
            'Failed to retrieve usage statistics',
            { message: errorMessage },
            headers
        );
    }
};
