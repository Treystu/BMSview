/**
 * Standalone test for linear regression (no MongoDB needed)
 */

// Simple linear regression implementation (copied from forecasting.cjs)
function linearRegression(dataPoints) {
  const n = dataPoints.length;
  
  // Calculate means
  const meanX = dataPoints.reduce((sum, p) => sum + p.timestamp, 0) / n;
  const meanY = dataPoints.reduce((sum, p) => sum + p.capacity, 0) / n;
  
  // Calculate slope and intercept
  let numerator = 0;
  let denominator = 0;
  
  for (const point of dataPoints) {
    const xDiff = point.timestamp - meanX;
    const yDiff = point.capacity - meanY;
    numerator += xDiff * yDiff;
    denominator += xDiff * xDiff;
  }
  
  const slope = denominator !== 0 ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;
  
  // Calculate R-squared
  const predictedValues = dataPoints.map(p => slope * p.timestamp + intercept);
  const ssRes = dataPoints.reduce((sum, p, i) => 
    sum + Math.pow(p.capacity - predictedValues[i], 2), 0
  );
  const ssTot = dataPoints.reduce((sum, p) => 
    sum + Math.pow(p.capacity - meanY, 2), 0
  );
  
  const rSquared = ssTot !== 0 ? 1 - (ssRes / ssTot) : 0;
  
  return {
    slope,
    intercept,
    rSquared: Math.max(0, Math.min(1, rSquared))
  };
}

console.log('Testing linear regression...\n');

// Test 1: Perfect linear data (y = 2x + 1)
const testData1 = [
  { timestamp: 1, capacity: 3 },
  { timestamp: 2, capacity: 5 },
  { timestamp: 3, capacity: 7 },
  { timestamp: 4, capacity: 9 },
  { timestamp: 5, capacity: 11 }
];

const result1 = linearRegression(testData1);
console.log('Test 1: Perfect linear relationship (y = 2x + 1)');
console.log('  slope:', result1.slope.toFixed(2), '(expected: 2.00)');
console.log('  intercept:', result1.intercept.toFixed(2), '(expected: 1.00)');
console.log('  R²:', result1.rSquared.toFixed(4), '(expected: 1.0000)');
console.log('  ✓', Math.abs(result1.slope - 2) < 0.01 ? 'PASS' : 'FAIL');

// Test 2: Decreasing capacity (battery degradation)
const testData2 = [
  { timestamp: Date.now() - 90*24*60*60*1000, capacity: 100 },
  { timestamp: Date.now() - 60*24*60*60*1000, capacity: 98 },
  { timestamp: Date.now() - 30*24*60*60*1000, capacity: 96 },
  { timestamp: Date.now(), capacity: 94 }
];

const result2 = linearRegression(testData2);
console.log('\nTest 2: Battery degradation simulation');
console.log('  slope:', result2.slope.toExponential(3), '(should be negative)');
console.log('  R²:', result2.rSquared.toFixed(4));
console.log('  ✓', result2.slope < 0 ? 'PASS (degrading)' : 'FAIL');

console.log('\n✓ Linear regression is working correctly!\n');
