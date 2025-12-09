/**
 * Duplicate Detection Integration Test
 * 
 * Tests the full flow from frontend file upload to backend hash checking
 */

const crypto = require('crypto');

// Mock MongoDB collection
class MockCollection {
    constructor() {
        this.records = [];
    }
    
    async insertOne(record) {
        const id = `record-${this.records.length + 1}`;
        this.records.push({ ...record, _id: id });
        return { insertedId: id };
    }
    
    async find(query, options) {
        // Simulate MongoDB $in query
        if (query.contentHash && query.contentHash.$in) {
            const hashSet = new Set(query.contentHash.$in);
            const matches = this.records.filter(r => hashSet.has(r.contentHash));
            return {
                toArray: async () => matches
            };
        }
        return { toArray: async () => [] };
    }
}

// Simulate backend calculateImageHash
function calculateImageHash(base64String) {
    const normalized = base64String.trim();
    const cleaned = normalized.startsWith('data:')
        ? normalized.slice(normalized.indexOf(',') + 1)
        : normalized;
    const sanitized = cleaned.replace(/\s+/g, '');
    const buffer = Buffer.from(sanitized, 'base64');
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return hash;
}

// Simulate frontend sha256Browser
async function sha256Browser(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

describe('Duplicate Detection Full Flow', () => {
    let mockDB;
    
    beforeEach(() => {
        mockDB = new MockCollection();
    });
    
    test('should detect duplicate when file uploaded twice', async () => {
        // 1x1 red pixel PNG
        const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
        const binaryData = Buffer.from(base64Image, 'base64');
        
        // === FIRST UPLOAD ===
        // Backend: receives base64, calculates hash, stores analysis
        const contentHash1 = calculateImageHash(base64Image);
        await mockDB.insertOne({
            contentHash: contentHash1,
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
            }
        });
        
        console.log('✓ First upload stored with hash:', contentHash1.substring(0, 16) + '...');
        
        // === SECOND UPLOAD (Duplicate) ===
        // Frontend: user selects same file again
        // Frontend calculates hash from binary File object
        const uploadHash = await sha256Browser(binaryData);
        
        console.log('✓ Frontend calculated hash:', uploadHash.substring(0, 16) + '...');
        
        // Frontend calls check-hashes endpoint with array of hashes
        const checkHashesResponse = await (async () => {
            const query = { contentHash: { $in: [uploadHash] } };
            const results = await mockDB.find(query);
            const allMatchingRecords = await results.toArray();
            
            console.log('✓ Database query found', allMatchingRecords.length, 'records');
            
            const duplicates = [];
            for (const record of allMatchingRecords) {
                const analysis = record.analysis || {};
                const hasAllCriticalFields = [
                    'dlNumber', 'stateOfCharge', 'overallVoltage', 'current',
                    'remainingCapacity', 'chargeMosOn', 'dischargeMosOn',
                    'balanceOn', 'highestCellVoltage', 'lowestCellVoltage',
                    'averageCellVoltage', 'cellVoltageDifference', 'cycleCount', 'power'
                ].every(field => analysis[field] !== undefined && analysis[field] !== null);
                
                if (hasAllCriticalFields) {
                    duplicates.push({
                        hash: record.contentHash,
                        data: analysis
                    });
                }
            }
            
            return { duplicates, upgrades: [] };
        })();
        
        console.log('✓ check-hashes returned', checkHashesResponse.duplicates.length, 'duplicates');
        
        // ASSERTIONS
        expect(contentHash1).toBe(uploadHash); // Hashes must match
        expect(checkHashesResponse.duplicates).toHaveLength(1);
        expect(checkHashesResponse.duplicates[0].data.dlNumber).toBe('DL-1234');
    });
    
    test('should handle multiple files with some duplicates', async () => {
        // Set up database with 2 existing records
        const image1Base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='; // red
        const image2Base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4//8/AAX+Av7czFnnAAAAAElFTkSuQmCC'; // white
        
        const hash1 = calculateImageHash(image1Base64);
        const hash2 = calculateImageHash(image2Base64);
        
        await mockDB.insertOne({
            contentHash: hash1,
            analysis: { dlNumber: 'DL-AAA', stateOfCharge: 80, overallVoltage: 52, current: 5, remainingCapacity: 160, chargeMosOn: true, dischargeMosOn: true, balanceOn: false, highestCellVoltage: 3.3, lowestCellVoltage: 3.25, averageCellVoltage: 3.275, cellVoltageDifference: 0.05, cycleCount: 50, power: 260 }
        });
        await mockDB.insertOne({
            contentHash: hash2,
            analysis: { dlNumber: 'DL-BBB', stateOfCharge: 90, overallVoltage: 53, current: 2, remainingCapacity: 180, chargeMosOn: true, dischargeMosOn: true, balanceOn: false, highestCellVoltage: 3.35, lowestCellVoltage: 3.3, averageCellVoltage: 3.325, cellVoltageDifference: 0.05, cycleCount: 20, power: 106 }
        });
        
        // Frontend: user uploads 3 files (2 duplicates, 1 new)
        const file1Binary = Buffer.from(image1Base64, 'base64'); // duplicate
        const file2Binary = Buffer.from(image2Base64, 'base64'); // duplicate
        const file3Binary = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQIHWNgAAIAAAUAAY27m/MAAAAASUVORK5CYII=', 'base64'); // new
        
        const uploadHashes = await Promise.all([
            sha256Browser(file1Binary),
            sha256Browser(file2Binary),
            sha256Browser(file3Binary)
        ]);
        
        console.log('Frontend generated', uploadHashes.length, 'hashes');
        
        // Call check-hashes
        const query = { contentHash: { $in: uploadHashes } };
        const results = await mockDB.find(query);
        const allMatchingRecords = await results.toArray();
        
        const duplicates = allMatchingRecords.filter(r => {
            const analysis = r.analysis || {};
            return ['dlNumber', 'stateOfCharge', 'overallVoltage', 'current', 'remainingCapacity', 'chargeMosOn', 'dischargeMosOn', 'balanceOn', 'highestCellVoltage', 'lowestCellVoltage', 'averageCellVoltage', 'cellVoltageDifference', 'cycleCount', 'power'].every(field => analysis[field] !== undefined && analysis[field] !== null);
        }).map(r => ({ hash: r.contentHash, data: r.analysis }));
        
        console.log('Found', duplicates.length, 'duplicates out of', uploadHashes.length, 'files');
        
        expect(duplicates).toHaveLength(2); // 2 duplicates
        expect(duplicates.map(d => d.data.dlNumber).sort()).toEqual(['DL-AAA', 'DL-BBB']);
    });
});
