/**
 * Production Test Suite
 * 
 * This is a stub implementation for the production test suite.
 * It can be expanded in the future to include comprehensive production tests.
 */

class ProductionTestSuite {
    constructor() {
        this.availableTests = [
            'database-connectivity',
            'api-endpoints',
            'gemini-integration',
            'weather-service',
            'solar-service',
            'system-analytics',
            'multi-tenancy-isolation'
        ];
    }

    /**
     * Get list of available tests
     * @returns {string[]} Array of test names
     */
    getAvailableTests() {
        return this.availableTests;
    }

    /**
     * Run all tests or selected tests
     * @param {string[]} selectedTests - Optional array of specific tests to run
     * @returns {Promise<Object>} Test results
     */
    async runAllTests(selectedTests = null) {
        const testsToRun = selectedTests || this.availableTests;
        const results = {
            success: true,
            timestamp: new Date().toISOString(),
            tests: [],
            summary: {
                total: testsToRun.length,
                passed: 0,
                failed: 0,
                skipped: 0
            }
        };

        for (const testName of testsToRun) {
            const testResult = await this.runTest(testName);
            results.tests.push(testResult);

            if (testResult.status === 'passed') {
                results.summary.passed++;
            } else if (testResult.status === 'failed') {
                results.summary.failed++;
                results.success = false;
            } else {
                results.summary.skipped++;
            }
        }

        return {
            success: results.success,
            results: results
        };
    }

    /**
     * Run a single test
     * @param {string} testName - Name of the test to run
     * @returns {Promise<Object>} Test result
     */
    async runTest(testName) {
        const startedAt = Date.now();
        try {
            switch (testName) {
                case 'database-connectivity':
                    return await this.testDatabaseConnectivity(startedAt);
                case 'api-endpoints':
                    return await this.testApiEndpoints(startedAt);
                case 'gemini-integration':
                    return await this.testGeminiIntegration(startedAt);
                case 'weather-service':
                    return await this.testWeatherService(startedAt);
                case 'solar-service':
                    return await this.testSolarService(startedAt);
                case 'system-analytics':
                    return await this.testSystemAnalytics(startedAt);
                case 'multi-tenancy-isolation':
                    return await this.testMultiTenancyIsolation(startedAt);
                default:
                    return {
                        name: testName,
                        status: 'skipped',
                        message: `Unknown test: ${testName}`,
                        durationMs: Date.now() - startedAt,
                        timestamp: new Date().toISOString()
                    };
            }
        } catch (error) {
            return {
                name: testName,
                status: 'failed',
                message: error instanceof Error ? error.message : 'Unknown error',
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Run database connectivity test
     * @returns {Promise<Object>} Test result
     */
    async testDatabaseConnectivity(startedAt = Date.now()) {
        if (!process.env.MONGODB_URI) {
            return {
                name: 'database-connectivity',
                status: 'skipped',
                message: 'MONGODB_URI not set; skipping database connectivity test',
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        const { getDb } = require('../netlify/functions/utils/mongodb.cjs');
        const db = await getDb();

        if (!db || typeof db.collection !== 'function') {
            return {
                name: 'database-connectivity',
                status: 'failed',
                message: 'Database handle is invalid (missing collection())',
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        return {
            name: 'database-connectivity',
            status: 'passed',
            message: 'Database connection available',
            durationMs: Date.now() - startedAt,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Run API endpoints test
     * @returns {Promise<Object>} Test result
     */
    async testApiEndpoints(startedAt = Date.now()) {
        const baseUrl = this.resolveBaseUrl();
        if (baseUrl) {
            const endpoints = [
                '/.netlify/functions/analyze',
                '/.netlify/functions/generate-insights-with-tools',
                '/.netlify/functions/weather',
                '/.netlify/functions/solar-estimate',
                '/.netlify/functions/system-analytics'
            ];

            const failures = [];
            for (const path of endpoints) {
                try {
                    const resp = await fetch(`${baseUrl}${path}`, { method: 'OPTIONS' });
                    if (!resp || typeof resp.status !== 'number') {
                        failures.push(`${path}: no response`);
                        continue;
                    }
                    if (resp.status >= 500) failures.push(`${path}: ${resp.status}`);
                } catch (e) {
                    failures.push(`${path}: ${(e instanceof Error ? e.message : String(e))}`);
                }
            }

            if (failures.length > 0) {
                return {
                    name: 'api-endpoints',
                    status: 'failed',
                    message: `Endpoint checks failed: ${failures.join('; ')}`,
                    durationMs: Date.now() - startedAt,
                    timestamp: new Date().toISOString()
                };
            }

            return {
                name: 'api-endpoints',
                status: 'passed',
                message: 'API endpoints responded to OPTIONS requests',
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        const fs = require('fs');
        const path = require('path');
        const requiredFiles = [
            'netlify/functions/analyze.cjs',
            'netlify/functions/generate-insights-with-tools.cjs',
            'netlify/functions/weather.cjs',
            'netlify/functions/solar-estimate.ts',
            'netlify/functions/system-analytics.cjs'
        ];

        const missingFiles = requiredFiles.filter(f => !fs.existsSync(path.join(__dirname, '..', f)));
        if (missingFiles.length > 0) {
            return {
                name: 'api-endpoints',
                status: 'failed',
                message: `Missing endpoint source files: ${missingFiles.join(', ')}`,
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        const cjsModules = [
            '../netlify/functions/analyze.cjs',
            '../netlify/functions/generate-insights-with-tools.cjs',
            '../netlify/functions/weather.cjs',
            '../netlify/functions/system-analytics.cjs'
        ];

        const moduleErrors = [];
        for (const rel of cjsModules) {
            try {
                const mod = require(rel);
                const handler = mod?.handler || mod?.default || mod;
                if (typeof handler !== 'function') moduleErrors.push(`${rel}: missing handler export`);
            } catch (e) {
                moduleErrors.push(`${rel}: ${(e instanceof Error ? e.message : String(e))}`);
            }
        }

        if (moduleErrors.length > 0) {
            return {
                name: 'api-endpoints',
                status: 'failed',
                message: `Endpoint modules not loadable: ${moduleErrors.join('; ')}`,
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        return {
            name: 'api-endpoints',
            status: 'passed',
            message: 'API endpoint handlers are present and loadable',
            durationMs: Date.now() - startedAt,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Run Gemini integration test
     * @returns {Promise<Object>} Test result
     */
    async testGeminiIntegration(startedAt = Date.now()) {
        if (!process.env.GEMINI_API_KEY) {
            return {
                name: 'gemini-integration',
                status: 'skipped',
                message: 'GEMINI_API_KEY not set; skipping Gemini integration test',
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }
        require('@google/genai');
        if (process.env.USE_REAL_SERVICES === '1' || process.env.USE_REAL_SERVICES === 'true') {
            const { GoogleGenAI } = require('@google/genai');
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
            const res = await model.generateContent('Respond with the single word: OK');
            const text = res?.response?.text?.() || '';
            if (!String(text).toUpperCase().includes('OK')) {
                return {
                    name: 'gemini-integration',
                    status: 'failed',
                    message: `Unexpected Gemini response: ${String(text).slice(0, 200)}`,
                    durationMs: Date.now() - startedAt,
                    timestamp: new Date().toISOString()
                };
            }
        }

        return {
            name: 'gemini-integration',
            status: 'passed',
            message: 'Gemini SDK available (and optional real-call passed if enabled)',
            durationMs: Date.now() - startedAt,
            timestamp: new Date().toISOString()
        };
    }

    async testWeatherService(startedAt = Date.now()) {
        if (!process.env.WEATHER_API_KEY) {
            return {
                name: 'weather-service',
                status: 'skipped',
                message: 'WEATHER_API_KEY not set; skipping weather service test',
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        const { handler } = require('../netlify/functions/weather.cjs');
        if (typeof handler !== 'function') {
            return {
                name: 'weather-service',
                status: 'failed',
                message: 'Weather handler export missing',
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        return {
            name: 'weather-service',
            status: 'passed',
            message: 'Weather handler present',
            durationMs: Date.now() - startedAt,
            timestamp: new Date().toISOString()
        };
    }

    async testSolarService(startedAt = Date.now()) {
        const fs = require('fs');
        const path = require('path');
        const solarPath = path.join(__dirname, '../netlify/functions/solar-estimate.ts');
        if (!fs.existsSync(solarPath)) {
            return {
                name: 'solar-service',
                status: 'failed',
                message: 'Solar-estimate source file missing',
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        return {
            name: 'solar-service',
            status: 'passed',
            message: 'Solar-estimate source file present',
            durationMs: Date.now() - startedAt,
            timestamp: new Date().toISOString()
        };
    }

    async testSystemAnalytics(startedAt = Date.now()) {
        const { handler } = require('../netlify/functions/system-analytics.cjs');
        if (typeof handler !== 'function') {
            return {
                name: 'system-analytics',
                status: 'failed',
                message: 'System-analytics handler export missing',
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        const res = await handler({ httpMethod: 'GET', queryStringParameters: { systemId: 'test-system' } }, {});
        if (!res || res.statusCode !== 200) {
            return {
                name: 'system-analytics',
                status: 'failed',
                message: `Unexpected system-analytics response: ${res?.statusCode}`,
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        const body = JSON.parse(res.body || '{}');
        if (!body || !Array.isArray(body.hourlyAverages)) {
            return {
                name: 'system-analytics',
                status: 'failed',
                message: 'system-analytics response missing hourlyAverages[]',
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        return {
            name: 'system-analytics',
            status: 'passed',
            message: 'System analytics handler returned expected structure',
            durationMs: Date.now() - startedAt,
            timestamp: new Date().toISOString()
        };
    }

    async testMultiTenancyIsolation(startedAt = Date.now()) {
        const multiTenantEnabled = process.env.MULTI_TENANT === '1' || process.env.MULTI_TENANT === 'true';
        if (!multiTenantEnabled) {
            return {
                name: 'multi-tenancy-isolation',
                status: 'skipped',
                message: 'Multi-tenancy is not enabled; set MULTI_TENANT=1 to run this check',
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        const fs = require('fs');
        const path = require('path');
        const analyzePath = path.join(__dirname, '../netlify/functions/analyze.cjs');
        if (!fs.existsSync(analyzePath)) {
            return {
                name: 'multi-tenancy-isolation',
                status: 'skipped',
                message: 'analyze.cjs not found; skipping multi-tenancy check',
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        const content = fs.readFileSync(analyzePath, 'utf8');
        const hasUserIdFilterHint = content.includes('userId') && content.includes('contentHash');
        if (!hasUserIdFilterHint) {
            return {
                name: 'multi-tenancy-isolation',
                status: 'failed',
                message: 'analyze.cjs does not appear to scope dedupe/storage by userId (expected multi-tenant guard)',
                durationMs: Date.now() - startedAt,
                timestamp: new Date().toISOString()
            };
        }

        return {
            name: 'multi-tenancy-isolation',
            status: 'passed',
            message: 'analyze.cjs appears to include userId scoping logic',
            durationMs: Date.now() - startedAt,
            timestamp: new Date().toISOString()
        };
    }

    resolveBaseUrl() {
        const url = process.env.BMSVIEW_BASE_URL || process.env.URL || process.env.DEPLOY_URL || process.env.SITE_URL;
        if (!url) return null;
        return String(url).replace(/\/$/, '');
    }
}

module.exports = {
    ProductionTestSuite
};

