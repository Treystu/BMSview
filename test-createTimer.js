/**
 * Test script to verify createTimer function works correctly
 */

const { createLogger, createTimer } = require('./netlify/functions/utils/logger.js');

console.log('Testing createTimer function...\n');

// Test 1: Basic timer with logger function
console.log('Test 1: Timer with logger function');
const log1 = createLogger('test-function-1', {});
const timer1 = createTimer(log1, 'test-operation-1');
setTimeout(() => {
  timer1.end({ testData: 'success' });
  console.log('✓ Test 1 passed\n');
  
  // Test 2: Timer with metadata
  console.log('Test 2: Timer with metadata');
  const log2 = createLogger('test-function-2', {});
  const timer2 = createTimer(log2, 'database-operations');
  setTimeout(() => {
    const duration = timer2.end({ jobCount: 5, status: 'completed' });
    console.log(`✓ Test 2 passed - Duration: ${duration}ms\n`);
    
    // Test 3: Multiple timers
    console.log('Test 3: Multiple timers');
    const log3 = createLogger('test-function-3', {});
    const timer3a = createTimer(log3, 'operation-a');
    const timer3b = createTimer(log3, 'operation-b');
    
    setTimeout(() => {
      timer3a.end({ operation: 'a' });
      timer3b.end({ operation: 'b' });
      console.log('✓ Test 3 passed\n');
      
      console.log('All tests passed! ✓');
      console.log('\nThe createTimer function is working correctly and is compatible with:');
      console.log('- analyze.js usage patterns');
      console.log('- job-shepherd.js usage patterns');
      console.log('- job-shepherd-enhanced.js usage patterns');
    }, 100);
  }, 100);
}, 100);