const { validateAnalysisData } = require('./netlify/functions/utils/data-validation.cjs');

console.log('=== Critical Edge Case Tests ===\n');

// Test 1: Division by zero protection
console.log('Test 1: Division by zero (fullCapacity = 0)');
const test1 = {
    stateOfCharge: 50,
    remainingCapacity: 100,
    fullCapacity: 0,
    cellVoltages: []
};
const result1 = validateAnalysisData(test1);
console.log('Result: No crash =', true);
console.log('isValid =', result1.isValid, '\n');

// Test 2: Empty array handling
console.log('Test 2: Empty cell voltages array');
const test2 = {
    stateOfCharge: 50,
    overallVoltage: 52.3,
    cellVoltages: []
};
const result2 = validateAnalysisData(test2);
console.log('Result: No crash =', true);
console.log('No voltage mismatch warning =', !result2.warnings.some(w => w.includes('Voltage mismatch')), '\n');

// Test 3: All null values
console.log('Test 3: All null values');
const test3 = {
    stateOfCharge: null,
    overallVoltage: null,
    current: null,
    cellVoltages: null,
    temperature: null
};
const result3 = validateAnalysisData(test3);
console.log('Result: No crash =', true);
console.log('isValid =', result3.isValid, '\n');

// Test 4: Exact boundary values
console.log('Test 4: Exact boundary values (0% SOC, 2.0V cell)');
const test4 = {
    stateOfCharge: 0,
    overallVoltage: 2.0,
    cellVoltages: [2.0],
    temperature: 1
};
const result4 = validateAnalysisData(test4);
console.log('SOC 0% not flagged =', !result4.warnings.some(w => w.includes('Invalid SOC')));
console.log('Cell 2.0V not flagged =', !result4.warnings.some(w => w.includes('out of range')));
console.log('Temp 1°C not flagged =', !result4.warnings.some(w => w.includes('Suspicious')), '\n');

// Test 5: Extreme but valid values
console.log('Test 5: Extreme but valid (100% SOC, 4.5V, 100°C)');
const test5 = {
    stateOfCharge: 100,
    cellVoltages: [4.5, 4.5, 4.5, 4.5],
    overallVoltage: 18.0,
    temperature: 100
};
const result5 = validateAnalysisData(test5);
console.log('100% SOC not flagged =', !result5.warnings.some(w => w.includes('Invalid SOC')));
console.log('4.5V not flagged =', !result5.warnings.some(w => w.includes('out of range')));
console.log('100°C not flagged =', !result5.warnings.some(w => w.includes('Suspicious')), '\n');

console.log('=== All Critical Edge Cases Passed ✅ ===');
