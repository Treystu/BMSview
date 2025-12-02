/**
 * Simple test to verify the getIsActualError fix
 */

const fs = require('fs');
const path = require('path');

describe('Utils getIsActualError Fix', () => {
  test('should include "checking" in pendingStates', () => {
    const utilsPath = path.join(__dirname, '../utils.ts');
    const source = fs.readFileSync(utilsPath, 'utf8');
    
    // Verify "checking" is in the pendingStates array
    expect(source).toMatch(/['"]checking['"]/);
    
    // Verify it's in the pendingStates array context
    const pendingStatesMatch = source.match(/const pendingStates = \[([\s\S]*?)\];/);
    expect(pendingStatesMatch).toBeTruthy();
    expect(pendingStatesMatch[1]).toMatch(/['"]checking['"]/);
  });
  
  test('should have other expected pending states', () => {
    const utilsPath = path.join(__dirname, '../utils.ts');
    const source = fs.readFileSync(utilsPath, 'utf8');
    
    const pendingStatesMatch = source.match(/const pendingStates = \[([\s\S]*?)\];/);
    expect(pendingStatesMatch).toBeTruthy();
    
    const states = pendingStatesMatch[1];
    expect(states).toMatch(/['"]queued['"]/);
    expect(states).toMatch(/['"]processing['"]/);
    expect(states).toMatch(/['"]checking['"]/);
  });
});
