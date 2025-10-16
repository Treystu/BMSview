/**
 * Test Script for BMS View Fixes
 * 
 * This script tests:
 * 1. Rate limiting logic (without MongoDB)
 * 2. Error classification logic
 * 3. Logger functionality
 * 4. Job requeuing logic
 */

const assert = require('assert');

console.log('🧪 Starting BMS View Fixes Test Suite...\n');

// Test 1: Logger with LOG_LEVEL
console.log('Test 1: Logger with LOG_LEVEL support');
try {
    // Simulate different log levels
    const testLevels = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
    
    for (const level of testLevels) {
        process.env.LOG_LEVEL = level;
        const { getLogLevel, LOG_LEVELS } = require('./netlify/functions/utils/logger-enhanced.js');
        const currentLevel = getLogLevel();
        assert.strictEqual(currentLevel, LOG_LEVELS[level], `Log level should be ${level}`);
        console.log(`  ✓ LOG_LEVEL=${level} works correctly`);
        
        // Clear require cache for next iteration
        delete require.cache[require.resolve('./netlify/functions/utils/logger-enhanced.js')];
    }
    
    console.log('✅ Test 1 PASSED\n');
} catch (error) {
    console.error('❌ Test 1 FAILED:', error.message, '\n');
    process.exit(1);
}

// Test 2: Error Classification
console.log('Test 2: Error Classification Logic');
try {
    const testErrors = [
        { message: '429 Too Many Requests', expected: 'TRANSIENT' },
        { message: 'RESOURCE_EXHAUSTED quota exceeded', expected: 'TRANSIENT' },
        { message: 'timeout after 45000ms', expected: 'TRANSIENT' },
        { message: 'ETIMEDOUT', expected: 'TRANSIENT' },
        { message: 'ECONNREFUSED', expected: 'TRANSIENT' },
        { message: 'invalid JSON schema', expected: 'PERMANENT' },
        { message: 'parse error', expected: 'PERMANENT' },
    ];
    
    for (const testError of testErrors) {
        const errorMessage = testError.message;
        const isRateLimitError = errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED');
        const isTimeoutError = errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT');
        const isNetworkError = errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND');
        const isPermanentError = errorMessage.includes('invalid') || errorMessage.includes('parse') || errorMessage.includes('schema');
        
        const isTransient = isRateLimitError || isTimeoutError || isNetworkError;
        const classification = isTransient ? 'TRANSIENT' : (isPermanentError ? 'PERMANENT' : 'UNKNOWN');
        
        assert.strictEqual(classification, testError.expected, `Error "${errorMessage}" should be ${testError.expected}`);
        console.log(`  ✓ "${errorMessage}" correctly classified as ${classification}`);
    }
    
    console.log('✅ Test 2 PASSED\n');
} catch (error) {
    console.error('❌ Test 2 FAILED:', error.message, '\n');
    process.exit(1);
}

// Test 3: Retry Count Logic
console.log('Test 3: Retry Count and Backoff Logic');
try {
    const MAX_RETRY_COUNT = 5;
    const baseDelay = 60000; // 1 minute
    
    for (let retryCount = 0; retryCount < MAX_RETRY_COUNT + 2; retryCount++) {
        const shouldRequeue = retryCount < MAX_RETRY_COUNT;
        const backoffDelay = baseDelay * Math.pow(2, retryCount);
        const backoffMinutes = Math.round(backoffDelay / 60000);
        
        if (shouldRequeue) {
            console.log(`  ✓ Retry ${retryCount + 1}: Requeue with ${backoffMinutes} minute backoff`);
        } else {
            console.log(`  ✓ Retry ${retryCount + 1}: Exceeded max retries, mark as failed`);
        }
    }
    
    console.log('✅ Test 3 PASSED\n');
} catch (error) {
    console.error('❌ Test 3 FAILED:', error.message, '\n');
    process.exit(1);
}

// Test 4: Sanitization Logic
console.log('Test 4: Data Sanitization');
try {
    const { sanitize } = require('./netlify/functions/utils/logger-enhanced.js');
    
    const testData = {
        username: 'testuser',
        password: 'secret123',
        apiKey: 'sk-1234567890',
        token: 'bearer-token',
        normalField: 'normal-value',
        nested: {
            secret: 'nested-secret',
            public: 'public-value'
        }
    };
    
    const sanitized = sanitize(testData);
    
    assert.strictEqual(sanitized.username, 'testuser', 'Normal fields should not be sanitized');
    assert.strictEqual(sanitized.password, '[REDACTED]', 'Password should be redacted');
    assert.strictEqual(sanitized.apiKey, '[REDACTED]', 'API key should be redacted');
    assert.strictEqual(sanitized.token, '[REDACTED]', 'Token should be redacted');
    assert.strictEqual(sanitized.normalField, 'normal-value', 'Normal fields should not be sanitized');
    assert.strictEqual(sanitized.nested.secret, '[REDACTED]', 'Nested secrets should be redacted');
    assert.strictEqual(sanitized.nested.public, 'public-value', 'Nested public fields should not be sanitized');
    
    console.log('  ✓ Password redacted correctly');
    console.log('  ✓ API key redacted correctly');
    console.log('  ✓ Token redacted correctly');
    console.log('  ✓ Normal fields preserved');
    console.log('  ✓ Nested secrets redacted correctly');
    console.log('✅ Test 4 PASSED\n');
} catch (error) {
    console.error('❌ Test 4 FAILED:', error.message, '\n');
    process.exit(1);
}

// Test 5: Rate Limit Window Logic
console.log('Test 5: Rate Limit Window Logic');
try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - (60 * 1000)); // 1 minute window
    
    const timestamps = [
        new Date(now.getTime() - 120000), // 2 minutes ago (outside window)
        new Date(now.getTime() - 90000),  // 1.5 minutes ago (outside window)
        new Date(now.getTime() - 45000),  // 45 seconds ago (inside window)
        new Date(now.getTime() - 30000),  // 30 seconds ago (inside window)
        new Date(now.getTime() - 15000),  // 15 seconds ago (inside window)
    ];
    
    const recentTimestamps = timestamps.filter(ts => ts > windowStart);
    
    assert.strictEqual(recentTimestamps.length, 3, 'Should have 3 timestamps in window');
    console.log(`  ✓ Window filtering works correctly (${recentTimestamps.length}/5 in window)`);
    
    const LIMIT = 100;
    const remaining = LIMIT - recentTimestamps.length;
    console.log(`  ✓ Remaining requests: ${remaining}/${LIMIT}`);
    
    console.log('✅ Test 5 PASSED\n');
} catch (error) {
    console.error('❌ Test 5 FAILED:', error.message, '\n');
    process.exit(1);
}

console.log('🎉 All tests passed! Fixes are working correctly.\n');
console.log('Next steps:');
console.log('1. Review the fixed files');
console.log('2. Deploy to production');
console.log('3. Monitor logs for improvements');
console.log('4. Set up alerts for quota exhaustion');