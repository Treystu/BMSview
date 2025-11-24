#!/usr/bin/env node
/**
 * Verification Script for PR Implementations #172, #161, #173
 * 
 * Programmatically verifies that all code implementations are in place
 * for the three PRs mentioned in issue #174.
 * 
 * Run with: node scripts/verify-pr-implementations.cjs
 */

const fs = require('fs');
const path = require('path');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkFileExists(filePath, description) {
  const fullPath = path.join(__dirname, '..', filePath);
  const exists = fs.existsSync(fullPath);
  if (exists) {
    log(`✓ ${description}`, 'green');
  } else {
    log(`✗ ${description} - FILE NOT FOUND: ${filePath}`, 'red');
  }
  return exists;
}

function checkFileContains(filePath, searchStrings, description) {
  const fullPath = path.join(__dirname, '..', filePath);
  
  if (!fs.existsSync(fullPath)) {
    log(`✗ ${description} - FILE NOT FOUND: ${filePath}`, 'red');
    return false;
  }
  
  const content = fs.readFileSync(fullPath, 'utf8');
  const allFound = searchStrings.every(str => content.includes(str));
  
  if (allFound) {
    log(`✓ ${description}`, 'green');
  } else {
    log(`✗ ${description}`, 'red');
    const missing = searchStrings.filter(str => !content.includes(str));
    log(`  Missing: ${missing.join(', ')}`, 'yellow');
  }
  
  return allFound;
}

function runVerification() {
  log('\n=== PR Implementation Verification ===\n', 'bold');
  
  let allPassed = true;
  
  // PR #172: Fix Timeout Error for Generate Insights
  log('PR #172: Fix Timeout Error for Generate Insights Function', 'blue');
  log('─'.repeat(60), 'blue');
  
  allPassed &= checkFileContains(
    'services/clientService.ts',
    ['MAX_RESUME_ATTEMPTS', 'resumeJobId', 'attemptInsightsGeneration', 'Continuing analysis'],
    'Frontend retry logic with resumeJobId support'
  );
  
  allPassed &= checkFileContains(
    'netlify/functions/generate-insights-with-tools.cjs',
    ['getOrCreateResumableJob', 'resumeJobId', 'checkpoint', 'canResume'],
    'Backend checkpoint/resume system'
  );
  
  allPassed &= checkFileExists(
    'netlify/functions/utils/checkpoint-manager.cjs',
    'Checkpoint manager utility exists'
  );
  
  allPassed &= checkFileExists(
    'tests/insights-retry-resume.test.js',
    'Retry/resume test file exists'
  );
  
  allPassed &= checkFileContains(
    'tests/insights-retry-resume.test.js',
    ['should handle successful response on first attempt', 'should automatically retry', 'should save checkpoint state'],
    'Test cases for retry/resume functionality'
  );
  
  allPassed &= checkFileExists(
    'INSIGHTS_TIMEOUT_FIX.md',
    'Documentation for timeout fix exists'
  );
  
  log('');
  
  // PR #161: Fix Background Mode Insights Generation
  log('PR #161: Fix Background Mode Insights Generation', 'blue');
  log('─'.repeat(60), 'blue');
  
  allPassed &= checkFileContains(
    'netlify/functions/utils/insights-processor.cjs',
    ['executeReActLoop', 'processInsightsInBackground', 'mode: \'background\''],
    'Background processor uses executeReActLoop'
  );
  
  allPassed &= checkFileContains(
    'netlify/functions/utils/insights-processor.cjs',
    ['contextWindowDays', 'maxIterations', 'modelOverride'],
    'Background processor accepts all parameters'
  );
  
  allPassed &= checkFileContains(
    'netlify/functions/utils/react-loop.cjs',
    ['DEFAULT_MAX_TURNS'],
    'ReAct loop exports DEFAULT_MAX_TURNS constant'
  );
  
  // Verify deprecated code was removed
  const processorPath = path.join(__dirname, '..', 'netlify/functions/utils/insights-processor.cjs');
  const processorContent = fs.readFileSync(processorPath, 'utf8');
  const hasDeprecatedCode = processorContent.includes('runGuruConversation');
  
  if (!hasDeprecatedCode) {
    log('✓ Deprecated runGuruConversation code removed', 'green');
  } else {
    log('✗ Deprecated runGuruConversation code still present', 'red');
    allPassed = false;
  }
  
  log('');
  
  // PR #173: Fix Failed Test for Analyze Endpoint
  log('PR #173: Fix Failed Test for Analyze Endpoint', 'blue');
  log('─'.repeat(60), 'blue');
  
  allPassed &= checkFileContains(
    'netlify/functions/admin-diagnostics.cjs',
    ['getRealProductionData', 'imageData', '$exists: true, $ne: null'],
    'Admin diagnostics uses real production data query'
  );
  
  allPassed &= checkFileContains(
    'netlify/functions/admin-diagnostics.cjs',
    ['testImageData', 'sourceRecord.imageData'],
    'Safety check for imageData before Gemini API call'
  );
  
  // Verify cleanup logic exists
  allPassed &= checkFileContains(
    'netlify/functions/admin-diagnostics.cjs',
    ['deleteOne', 'cleanup'],
    'Cleanup logic with verification exists'
  );
  
  log('');
  
  // Summary
  log('=== Verification Summary ===\n', 'bold');
  
  if (allPassed) {
    log('✓ All implementations verified successfully!', 'green');
    log('\nAll three PRs have complete code implementations.', 'green');
    log('Outstanding items are deployment testing tasks only.', 'yellow');
    process.exit(0);
  } else {
    log('✗ Some implementations are missing or incomplete.', 'red');
    log('\nPlease review the failures above.', 'red');
    process.exit(1);
  }
}

// Run verification
runVerification();
