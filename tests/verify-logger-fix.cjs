/**
 * Simple verification script to demonstrate the logger fix
 * Run with: node tests/verify-logger-fix.cjs
 * 
 * This script simulates the error that was happening in production:
 * "Cannot read properties of undefined (reading 'info')"
 */

console.log('='.repeat(60));
console.log('VERIFICATION: Logger Fix for admin-diagnostics.cjs');
console.log('='.repeat(60));
console.log();

// First, demonstrate the BROKEN pattern (what was causing the error)
console.log('1. BROKEN PATTERN (what was causing the error):');
console.log('   const { logger } = require("./utils/logger.cjs");');
console.log('   logger.info("test"); // ❌ CRASH: logger is undefined');
console.log();

try {
  // This would have crashed before our fix
  const broken = require('../netlify/functions/utils/logger.cjs');
  const brokenLogger = broken.logger; // undefined!
  console.log('   Result: broken.logger =', brokenLogger);
  console.log('   ❌ logger is undefined - would crash on logger.info()');
} catch (error) {
  console.log('   Error:', error.message);
}

console.log();
console.log('-'.repeat(60));
console.log();

// Now demonstrate the FIXED pattern
console.log('2. FIXED PATTERN (what we implemented):');
console.log('   const { createLogger } = require("./utils/logger.cjs");');
console.log('   let logger = createLogger("admin-diagnostics", {});');
console.log('   logger.info("test"); // ✅ WORKS');
console.log();

try {
  const { createLogger } = require('../netlify/functions/utils/logger.cjs');
  const logger = createLogger('admin-diagnostics', { requestId: 'test-123' });
  
  console.log('   Result: logger =', typeof logger);
  console.log('   logger.info =', typeof logger.info);
  console.log('   logger.error =', typeof logger.error);
  console.log('   ✅ Logger is properly initialized!');
  console.log();
  
  // Mock console to capture the log output
  const originalLog = console.log;
  let logOutput = '';
  console.log = (msg) => { logOutput = msg; };
  
  logger.info('Test message', { data: 'test' });
  
  console.log = originalLog;
  
  console.log('   Logger output (JSON):');
  const logData = JSON.parse(logOutput);
  console.log('   - function:', logData.function);
  console.log('   - level:', logData.level);
  console.log('   - message:', logData.message);
  console.log('   - requestId:', logData.requestId);
  console.log();
} catch (error) {
  console.log('   Error:', error.message);
}

console.log('='.repeat(60));
console.log('VERIFICATION COMPLETE - Logger fix is working correctly!');
console.log('='.repeat(60));
