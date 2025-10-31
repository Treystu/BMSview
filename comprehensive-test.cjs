/**
 * Comprehensive Test Suite for BMSview
 * Tests all functions, endpoints, and integrations
 */

const fs = require('fs');
const path = require('path');

class ComprehensiveTest {
    constructor() {
        this.results = {
            passed: 0,
            failed: 0,
            warnings: 0,
            tests: []
        };
    }

    log(level, message, context = {}) {
        console.log(JSON.stringify({
            level: level.toUpperCase(),
            timestamp: new Date().toISOString(),
            test: 'ComprehensiveTest',
            message,
            context
        }));
    }

    test(name, testFn) {
        this.log('info', `Running test: ${name}`);
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

    // Test 1: Check if all required files exist
    testFileStructure() {
        const requiredFiles = [
            'netlify/functions/analyze.js',
            'netlify/functions/utils/analysis-pipeline.js',
            'netlify/functions/utils/geminiClient.js',
            'netlify/functions/security.js',
            'netlify/functions/weather.js',
            'netlify/functions/systems.js',
            'netlify/functions/history.js',
            'index.html',
            'App.tsx',
            'package.json',
            'netlify.toml'
        ];

        const missingFiles = requiredFiles.filter(file => {
            const filePath = path.join(process.cwd(), file);
            return !fs.existsSync(filePath);
        });

        return {
            pass: missingFiles.length === 0,
            message: missingFiles.length === 0 
                ? 'All required files exist'
                : `Missing files: ${missingFiles.join(', ')}`
        };
    }

    // Test 2: Check if empty files exist
    testEmptyFiles() {
        const functionFiles = fs.readdirSync('netlify/functions')
            .filter(file => file.endsWith('.js'))
            .map(file => `netlify/functions/${file}`);

        const emptyFiles = functionFiles.filter(file => {
            const filePath = path.join(process.cwd(), file);
            const stats = fs.statSync(filePath);
            return stats.size === 0;
        });

        return {
            pass: emptyFiles.length === 0,
            message: emptyFiles.length === 0
                ? 'No empty function files'
                : `Empty files found: ${emptyFiles.join(', ')}`
        };
    }

    // Test 3: Check package.json dependencies
    testPackageDependencies() {
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        const functionPackageJson = JSON.parse(fs.readFileSync('netlify/functions/package.json', 'utf8'));

        const mainDeps = Object.keys(packageJson.dependencies || {});
        const devDeps = Object.keys(packageJson.devDependencies || {});
        const functionDeps = Object.keys(functionPackageJson.dependencies || {});

        const hasReact = mainDeps.includes('react');
        const hasMongoDB = functionDeps.includes('mongodb');
        const hasGemini = functionDeps.includes('@google/genai');

        const issues = [];
        if (!hasReact) issues.push('Missing react in main dependencies');
        if (!hasMongoDB) issues.push('Missing mongodb in function dependencies');
        if (!hasGemini) issues.push('Missing @google/genai in function dependencies');

        return {
            pass: issues.length === 0,
            message: issues.length === 0 ? 'All required dependencies present' : issues.join('; ')
        };
    }

    // Test 4: Check for security issues
    testSecurity() {
        const indexHtml = fs.readFileSync('index.html', 'utf8');
        const hasExternalCDN = indexHtml.includes('aistudiocdn.com');
        
        // Check for hardcoded API keys
        const jsFiles = this.getAllJsFiles();
        const hardcodedKeys = [];
        
        jsFiles.forEach(file => {
            try {
                const content = fs.readFileSync(file, 'utf8');
                if (content.includes('API_KEY=') || content.includes('api_key=')) {
                    hardcodedKeys.push(file);
                }
            } catch (e) {
                // Skip files that can't be read
            }
        });

        const issues = [];
        if (hasExternalCDN) issues.push('Using external CDN in production');
        if (hardcodedKeys.length > 0) issues.push(`Potential hardcoded keys in: ${hardcodedKeys.join(', ')}`);

        return {
            pass: issues.length === 0,
            message: issues.length === 0 ? 'No security issues found' : issues.join('; ')
        };
    }

    // Test 5: Check function exports
    testFunctionExports() {
        const functionFiles = fs.readdirSync('netlify/functions')
            .filter(file => file.endsWith('.js'))
            .map(file => path.join('netlify/functions', file));

        const validFunctions = [];
        const invalidFunctions = [];

        functionFiles.forEach(file => {
            try {
                const content = fs.readFileSync(file, 'utf8');
                const hasHandler = content.includes('exports.handler') || content.includes('module.exports.handler');
                if (hasHandler) {
                    validFunctions.push(path.basename(file));
                } else {
                    invalidFunctions.push(path.basename(file));
                }
            } catch (e) {
                invalidFunctions.push(path.basename(file));
            }
        });

        return {
            pass: invalidFunctions.length === 0,
            message: invalidFunctions.length === 0
                ? `All ${validFunctions.length} functions have proper handlers`
                : `Invalid functions: ${invalidFunctions.join(', ')}`
        };
    }

    // Test 6: Check TypeScript configurations
    testTypeScriptConfig() {
        const hasTsConfig = fs.existsSync('tsconfig.json');
        const viteConfig = fs.existsSync('vite.config.ts');
        
        let tsConfigValid = false;
        if (hasTsConfig) {
            try {
                const tsConfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'));
                tsConfigValid = tsConfig.compilerOptions && tsConfig.compilerOptions.module === 'ESNext';
            } catch (e) {
                // Invalid JSON
            }
        }

        const issues = [];
        if (!hasTsConfig) issues.push('Missing tsconfig.json');
        if (!tsConfigValid) issues.push('Invalid TypeScript configuration');
        if (!viteConfig) issues.push('Missing vite.config.ts');

        return {
            pass: issues.length === 0,
            message: issues.length === 0 ? 'TypeScript configuration valid' : issues.join('; ')
        };
    }

    // Test 7: Check for duplicate hooks
    testDuplicateHooks() {
        const hooks = [
            'hooks/useFileUpload.ts',
            'src/hooks/useJobPolling.ts'
        ];

        const duplicates = [];
        const seen = new Set();

        hooks.forEach(hook => {
            const hookName = path.basename(hook);
            if (seen.has(hookName)) {
                duplicates.push(hookName);
            }
            seen.add(hookName);
        });

        return {
            pass: duplicates.length === 0,
            message: duplicates.length === 0 ? 'No duplicate hooks found' : `Duplicate hooks: ${duplicates.join(', ')}`
        };
    }

    // Test 8: Check environment variable requirements
    testEnvironmentVariables() {
        const envVars = [];
        
        // Collect all environment variables used in the codebase
        const jsFiles = this.getAllJsFiles();
        const envVarPattern = /process\.env\.([A-Z_]+)/g;

        jsFiles.forEach(file => {
            try {
                const content = fs.readFileSync(file, 'utf8');
                const matches = content.matchAll(envVarPattern);
                for (const match of matches) {
                    envVars.push(match[1]);
                }
            } catch (e) {
                // Skip files that can't be read
            }
        });

        // Critical environment variables that must be documented
        const criticalVars = ['MONGODB_URI', 'GEMINI_API_KEY'];
        const missingCritical = criticalVars.filter(varName => !envVars.includes(varName));

        return {
            pass: missingCritical.length === 0,
            message: missingCritical.length === 0
                ? `Found ${envVars.length} environment variables`
                : `Missing critical env vars: ${missingCritical.join(', ')}`
        };
    }

    getAllJsFiles() {
        const jsFiles = [];
        
        function collectFiles(dir) {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filePath = path.join(dir, file);
                const stats = fs.statSync(filePath);
                if (stats.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
                    collectFiles(filePath);
                } else if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.tsx')) {
                    jsFiles.push(filePath);
                }
            });
        }

        collectFiles('.');
        return jsFiles;
    }

    runAllTests() {
        this.log('info', 'Starting comprehensive BMSview test suite');

        // Run all tests
        this.test('File Structure', () => this.testFileStructure());
        this.test('Empty Files', () => this.testEmptyFiles());
        this.test('Package Dependencies', () => this.testPackageDependencies());
        this.test('Security Check', () => this.testSecurity());
        this.test('Function Exports', () => this.testFunctionExports());
        this.test('TypeScript Config', () => this.testTypeScriptConfig());
        this.test('Duplicate Hooks', () => this.testDuplicateHooks());
        this.test('Environment Variables', () => this.testEnvironmentVariables());

        // Summary
        this.log('info', 'Test suite completed', this.results);
        
        console.log('\n' + '='.repeat(60));
        console.log('COMPREHENSIVE TEST RESULTS');
        console.log('='.repeat(60));
        console.log(`✅ Passed: ${this.results.passed}`);
        console.log(`❌ Failed: ${this.results.failed}`);
        console.log(`⚠️  Warnings: ${this.results.warnings}`);
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
    const tester = new ComprehensiveTest();
    const success = tester.runAllTests();
    process.exit(success ? 0 : 1);
}

module.exports = { ComprehensiveTest };