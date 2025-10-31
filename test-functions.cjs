/**
 * Test Netlify Functions
 * Tests each function for proper structure and exports
 */

const fs = require('fs');
const path = require('path');

class FunctionTester {
    constructor() {
        this.results = {
            passed: 0,
            failed: 0,
            tests: []
        };
    }

    log(level, message, context = {}) {
        console.log(JSON.stringify({
            level: level.toUpperCase(),
            timestamp: new Date().toISOString(),
            tester: 'FunctionTester',
            message,
            context
        }));
    }

    test(name, testFn) {
        this.log('info', `Testing: ${name}`);
        try {
            const result = testFn();
            if (result.pass) {
                this.results.passed++;
                this.results.tests.push({ name, status: 'PASS', message: result.message });
                this.log('info', `✅ ${name}: ${result.message}`);
            } else {
                this.results.failed++;
                this.results.tests.push({ name, status: 'FAIL', message: result.message });
                this.log('error', `❌ ${name}: ${result.message}`);
            }
        } catch (error) {
            this.results.failed++;
            this.results.tests.push({ name, status: 'ERROR', message: error.message });
            this.log('error', `💥 ${name}: ${error.message}`);
        }
    }

    testFunctionStructure() {
        const functionsDir = path.join(process.cwd(), 'netlify/functions');
        const functionFiles = fs.readdirSync(functionsDir)
            .filter(file => file.endsWith('.js') && !file.startsWith('utils'))
            .map(file => path.join(functionsDir, file));

        const validFunctions = [];
        const issues = [];

        functionFiles.forEach(filePath => {
            const fileName = path.basename(filePath);
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                
                // Check for handler export
                const hasHandler = content.includes('exports.handler') || content.includes('module.exports.handler');
                if (!hasHandler) {
                    issues.push(`${fileName}: Missing handler export`);
                    return;
                }

                // Check for proper error handling
                const hasTryCatch = content.includes('try {') && content.includes('catch');
                if (!hasTryCatch) {
                    issues.push(`${fileName}: Missing try-catch error handling`);
                }

                // Check for logging
                const hasLogging = content.includes('createLogger') || content.includes('log(');
                if (!hasLogging) {
                    issues.push(`${fileName}: Missing logging`);
                }

                // Check for proper response format
                const hasResponseFormat = content.includes('statusCode') && content.includes('headers');
                if (!hasResponseFormat) {
                    issues.push(`${fileName}: Missing proper response format`);
                }

                // Check for environment variable validation
                if (fileName !== 'get-ip.js') { // Exclude simple functions
                    const hasEnvValidation = content.includes('process.env');
                    if (!hasEnvValidation) {
                        issues.push(`${fileName}: May need environment variable validation`);
                    }
                }

                validFunctions.push(fileName);

            } catch (error) {
                issues.push(`${fileName}: Cannot read file - ${error.message}`);
            }
        });

        return {
            pass: issues.length === 0,
            message: issues.length === 0
                ? `All ${validFunctions.length} functions have proper structure`
                : `Issues found: ${issues.join(', ')}`
        };
    }

    testUtilsFunctions() {
        const utilsDir = path.join(process.cwd(), 'netlify/functions/utils');
        const utilFiles = fs.readdirSync(utilsDir)
            .filter(file => file.endsWith('.js'))
            .map(file => path.join(utilsDir, file));

        const validUtils = [];
        const issues = [];

        utilFiles.forEach(filePath => {
            const fileName = path.basename(filePath);
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                
                // Check for proper module.exports
                const hasExports = content.includes('module.exports') || content.includes('exports.');
                if (!hasExports) {
                    issues.push(`${fileName}: Missing module.exports`);
                    return;
                }

                // Check for error handling in utilities
                const hasErrorHandling = content.includes('try') || content.includes('catch') || fileName === 'config.js';
                if (!hasErrorHandling) {
                    issues.push(`${fileName}: Missing error handling`);
                }

                validUtils.push(fileName);

            } catch (error) {
                issues.push(`${fileName}: Cannot read file - ${error.message}`);
            }
        });

        return {
            pass: issues.length === 0,
            message: issues.length === 0
                ? `All ${validUtils.length} utility functions are properly structured`
                : `Issues found: ${issues.join(', ')}`
        };
    }

    testImportConsistency() {
        const functionsDir = path.join(process.cwd(), 'netlify/functions');
        const functionFiles = fs.readdirSync(functionsDir)
            .filter(file => file.endsWith('.js'))
            .map(file => path.join(functionsDir, file));

        const importIssues = [];

        functionFiles.forEach(filePath => {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const fileName = path.basename(filePath);

                // Check for relative imports
                const relativeImports = content.match(/require\(['"]\.\.\/[^'"]+/g) || [];
                
                relativeImports.forEach(importPath => {
                    const cleanPath = importPath.replace(/require\(['"]/, '').replace(/['"].*/, '');
                    const fullPath = path.resolve(path.dirname(filePath), cleanPath);
                    
                    if (!fs.existsSync(fullPath + '.js')) {
                        importIssues.push(`${fileName}: Invalid import - ${importPath}`);
                    }
                });

            } catch (error) {
                // Skip files that can't be read
            }
        });

        return {
            pass: importIssues.length === 0,
            message: importIssues.length === 0
                ? 'All imports are valid'
                : `Import issues: ${importIssues.join(', ')}`
        };
    }

    testEnvironmentVariables() {
        const functionsDir = path.join(process.cwd(), 'netlify/functions');
        const functionFiles = fs.readdirSync(functionsDir)
            .filter(file => file.endsWith('.js'))
            .map(file => path.join(functionsDir, file));

        const envVars = new Set();
        const criticalVars = ['MONGODB_URI', 'GEMINI_API_KEY'];

        functionFiles.forEach(filePath => {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const matches = content.match(/process\.env\.([A-Z_]+)/g) || [];
                
                matches.forEach(match => {
                    const varName = match.replace('process.env.', '');
                    envVars.add(varName);
                });

            } catch (error) {
                // Skip files that can't be read
            }
        });

        const missingCritical = criticalVars.filter(varName => !envVars.has(varName));

        return {
            pass: missingCritical.length === 0,
            message: missingCritical.length === 0
                ? `Found ${envVars.size} environment variables, all critical ones present`
                : `Missing critical vars: ${missingCritical.join(', ')}. Found: ${Array.from(envVars).join(', ')}`
        };
    }

    testSecurityMeasures() {
        const functionsDir = path.join(process.cwd(), 'netlify/functions');
        const functionFiles = fs.readdirSync(functionsDir)
            .filter(file => file.endsWith('.js'))
            .map(file => path.join(functionsDir, file));

        const securityIssues = [];
        let securityCount = 0;

        functionFiles.forEach(filePath => {
            const fileName = path.basename(filePath);
            try {
                const content = fs.readFileSync(filePath, 'utf8');

                // Check for security imports
                if (content.includes('security.js') || fileName === 'security.js') {
                    securityCount++;
                }

                // Check for CORS headers
                if (content.includes('Access-Control-Allow-Origin')) {
                    securityCount++;
                }

                // Check for input validation
                if (content.includes('JSON.parse') && !content.includes('try')) {
                    securityIssues.push(`${fileName}: Missing validation for JSON.parse`);
                }

                // Check for SQL injection patterns (should not exist since using MongoDB)
                if (content.includes('SELECT') || content.includes('INSERT')) {
                    securityIssues.push(`${fileName}: Potential SQL injection vectors`);
                }

                // Check for eval usage
                if (content.includes('eval(')) {
                    securityIssues.push(`${fileName}: Dangerous eval() usage`);
                }

            } catch (error) {
                // Skip files that can't be read
            }
        });

        return {
            pass: securityIssues.length === 0 && securityCount > 0,
            message: securityIssues.length === 0
                ? `Security measures found in ${securityCount} functions`
                : `Security issues: ${securityIssues.join(', ')}`
        };
    }

    runAllTests() {
        this.log('info', 'Starting Netlify functions test suite');

        this.test('Function Structure', () => this.testFunctionStructure());
        this.test('Utils Functions', () => this.testUtilsFunctions());
        this.test('Import Consistency', () => this.testImportConsistency());
        this.test('Environment Variables', () => this.testEnvironmentVariables());
        this.test('Security Measures', () => this.testSecurityMeasures());

        this.log('info', 'Function test suite completed', this.results);
        
        console.log('\n' + '='.repeat(60));
        console.log('NETLIFY FUNCTIONS TEST RESULTS');
        console.log('='.repeat(60));
        console.log(`✅ Passed: ${this.results.passed}`);
        console.log(`❌ Failed: ${this.results.failed}`);
        console.log('='.repeat(60));

        this.results.tests.forEach(test => {
            const icon = test.status === 'PASS' ? '✅' : test.status === 'FAIL' ? '❌' : '💥';
            console.log(`${icon} ${test.name}: ${test.message}`);
        });

        return this.results.failed === 0;
    }
}

// Run the tests if this file is executed directly
if (require.main === module) {
    const tester = new FunctionTester();
    const success = tester.runAllTests();
    process.exit(success ? 0 : 1);
}

module.exports = { FunctionTester };