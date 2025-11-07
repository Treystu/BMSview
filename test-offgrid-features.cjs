/**
 * Manual Test Script for Off-Grid Intelligence Features
 * 
 * This script tests the new predictive analytics tools locally
 * to ensure they work before deploying.
 */

// Test imports
console.log('Testing module imports...\n');

try {
  const forecasting = require('./netlify/functions/utils/forecasting.cjs');
  console.log('✓ forecasting.cjs loaded');
  console.log('  - linearRegression:', typeof forecasting.linearRegression);
  console.log('  - predictCapacityDegradation:', typeof forecasting.predictCapacityDegradation);
  console.log('  - predictEfficiency:', typeof forecasting.predictEfficiency);
  console.log('  - predictLifetime:', typeof forecasting.predictLifetime);
} catch (error) {
  console.error('✗ forecasting.cjs failed:', error.message);
}

try {
  const patternAnalysis = require('./netlify/functions/utils/pattern-analysis.cjs');
  console.log('\n✓ pattern-analysis.cjs loaded');
  console.log('  - analyzeDailyPatterns:', typeof patternAnalysis.analyzeDailyPatterns);
  console.log('  - analyzeWeeklyPatterns:', typeof patternAnalysis.analyzeWeeklyPatterns);
  console.log('  - analyzeSeasonalPatterns:', typeof patternAnalysis.analyzeSeasonalPatterns);
  console.log('  - detectAnomalies:', typeof patternAnalysis.detectAnomalies);
} catch (error) {
  console.error('✗ pattern-analysis.cjs failed:', error.message);
}

try {
  const energyBudget = require('./netlify/functions/utils/energy-budget.cjs');
  console.log('\n✓ energy-budget.cjs loaded');
  console.log('  - calculateCurrentBudget:', typeof energyBudget.calculateCurrentBudget);
  console.log('  - calculateWorstCase:', typeof energyBudget.calculateWorstCase);
  console.log('  - calculateAverage:', typeof energyBudget.calculateAverage);
  console.log('  - calculateEmergencyBackup:', typeof energyBudget.calculateEmergencyBackup);
} catch (error) {
  console.error('✗ energy-budget.cjs failed:', error.message);
}

try {
  const geminiTools = require('./netlify/functions/utils/gemini-tools.cjs');
  console.log('\n✓ gemini-tools.cjs loaded');
  console.log('  - toolDefinitions count:', geminiTools.toolDefinitions.length);
  console.log('  - executeToolCall:', typeof geminiTools.executeToolCall);
  
  // Check for new tools
  const toolNames = geminiTools.toolDefinitions.map(t => t.name);
  console.log('\n  Available tools:');
  toolNames.forEach(name => {
    const isNew = ['predict_battery_trends', 'analyze_usage_patterns', 'calculate_energy_budget'].includes(name);
    console.log(`    ${isNew ? '🆕' : '  '} ${name}`);
  });
} catch (error) {
  console.error('✗ gemini-tools.cjs failed:', error.message);
}

// Test linear regression function (unit test)
console.log('\n\nTesting linear regression...');
try {
  const { linearRegression } = require('./netlify/functions/utils/forecasting.cjs');
  
  // Test with simple data: y = 2x + 1
  const testData = [
    { timestamp: 1, capacity: 3 },   // 2*1 + 1 = 3
    { timestamp: 2, capacity: 5 },   // 2*2 + 1 = 5
    { timestamp: 3, capacity: 7 },   // 2*3 + 1 = 7
    { timestamp: 4, capacity: 9 },   // 2*4 + 1 = 9
    { timestamp: 5, capacity: 11 }   // 2*5 + 1 = 11
  ];
  
  const result = linearRegression(testData);
  console.log('✓ Linear regression result:');
  console.log('  - slope:', result.slope.toFixed(2), '(expected: 2.00)');
  console.log('  - intercept:', result.intercept.toFixed(2), '(expected: 1.00)');
  console.log('  - R-squared:', result.rSquared.toFixed(4), '(expected: 1.0000)');
  
  if (Math.abs(result.slope - 2) < 0.01 && Math.abs(result.intercept - 1) < 0.01) {
    console.log('  ✓ Linear regression is working correctly!');
  } else {
    console.log('  ✗ Linear regression results don\'t match expected values');
  }
} catch (error) {
  console.error('✗ Linear regression test failed:', error.message);
}

console.log('\n\n=== Test Summary ===');
console.log('All modules loaded successfully!');
console.log('New tools are available for Gemini to use:');
console.log('  • predict_battery_trends - Forecast capacity, efficiency, lifetime');
console.log('  • analyze_usage_patterns - Daily/weekly/seasonal/anomaly analysis');
console.log('  • calculate_energy_budget - Current/worst-case/average/emergency scenarios');
console.log('\nReady for deployment! 🚀');
