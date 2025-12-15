/**
 * Hash Consistency Test
 * 
 * Verifies that frontend hash generation matches backend hash generation
 * to ensure duplicate detection works correctly.
 */

const crypto = require('crypto');

// Simulate frontend sha256Browser function
async function sha256Browser(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// Simulate backend calculateImageHash function (from unified-deduplication.cjs)
function calculateImageHash(base64String) {
    // Normalize payload: trim whitespace and strip data URL prefix if present
    const normalized = base64String.trim();
    const cleaned = normalized.startsWith('data:')
        ? normalized.slice(normalized.indexOf(',') + 1)
        : normalized;
    
    // Remove whitespace that may be introduced by transport layers
    const sanitized = cleaned.replace(/\s+/g, '');
    const buffer = Buffer.from(sanitized, 'base64');
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return hash;
}

describe('Hash Consistency Between Frontend and Backend', () => {
    test('should generate same hash for same binary data', async () => {
        // Create a simple test image (1x1 red pixel PNG)
        const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
        
        // Decode to binary (same as what browser would have from File object)
        const binaryBuffer = Buffer.from(base64Image, 'base64');
        
        // Frontend: hash the binary buffer directly
        const frontendHash = await sha256Browser(binaryBuffer);
        
        // Backend: receives base64, decodes it, then hashes
        const backendHash = calculateImageHash(base64Image);
        
        // These should match!
        console.log('Frontend hash:', frontendHash);
        console.log('Backend hash: ', backendHash);
        console.log('Match:', frontendHash === backendHash ? '✓' : '✗');
        
        expect(frontendHash).toBe(backendHash);
    });
    
    test('should handle base64 with data URL prefix', () => {
        const base64WithPrefix = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
        const base64WithoutPrefix = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
        
        // Backend strips data URL prefix properly
        const hash1 = calculateImageHash(base64WithPrefix);
        const hash2 = calculateImageHash(base64WithoutPrefix);
        
        console.log('Hash with prefix:   ', hash1);
        console.log('Hash without prefix:', hash2);
        console.log('Match:', hash1 === hash2 ? '✓' : '✗');
        
        // These should be equal after backend strips the prefix
        expect(hash1).toBe(hash2);
    });
    
    test('should handle whitespace in base64', () => {
        const base64Clean = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
        const base64Whitespace = 'iVBORw0KGgoAAAANSUhEUgAA\nAAEAAAABCAYAAAAfFcSJ\nAAAADUlEQVR42mP8z8DwHwAF\nBQIAX8jx0gAAAABJRU5ErkJggg==';
        
        // Backend strips whitespace
        const hash1 = calculateImageHash(base64Clean);
        const hash2 = calculateImageHash(base64Whitespace);
        
        expect(hash1).toBe(hash2);
    });
});

describe('check-hashes Endpoint Simulation', () => {
    test('should find duplicates in mock database', async () => {
        const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
        const contentHash = calculateImageHash(base64Image);
        
        // Mock database with one record
        const mockDatabase = [
            {
                contentHash: contentHash,
                analysis: {
                    dlNumber: 'DL-1234',
                    stateOfCharge: 75,
                    overallVoltage: 51.2,
                    current: 10.5,
                    remainingCapacity: 150,
                    chargeMosOn: true,
                    dischargeMosOn: true,
                    balanceOn: false,
                    highestCellVoltage: 3.25,
                    lowestCellVoltage: 3.20,
                    averageCellVoltage: 3.225,
                    cellVoltageDifference: 0.05,
                    cycleCount: 100,
                    power: 537.6
                },
                _id: 'test-record-1'
            }
        ];
        
        // Simulate frontend uploading same image
        const binaryBuffer = Buffer.from(base64Image, 'base64');
        const uploadHash = await sha256Browser(binaryBuffer);
        
        // Simulate check-hashes lookup
        const foundRecord = mockDatabase.find(r => r.contentHash === uploadHash);
        
        console.log('Upload hash:', uploadHash);
        console.log('DB record hash:', contentHash);
        console.log('Found duplicate:', foundRecord ? '✓' : '✗');
        
        expect(foundRecord).toBeDefined();
        expect(foundRecord.analysis.dlNumber).toBe('DL-1234');
    });
});
