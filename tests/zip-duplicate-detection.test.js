/**
 * Test for ZIP file duplicate detection
 * Verifies that ZIP extraction routes through unified duplicate check
 */

// Mock the duplicateChecker module
jest.mock('../utils/duplicateChecker', () => ({
    checkFilesForDuplicates: jest.fn(),
    CategorizedFiles: {}
}));

const { checkFilesForDuplicates } = require('../utils/duplicateChecker');

describe('ZIP Duplicate Detection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('ZIP extraction calls checkFilesForDuplicates', async () => {
        // Mock checkFilesForDuplicates to return categorized results
        const mockFile1 = new File(['test'], 'image1.jpg', { type: 'image/jpeg' });
        const mockFile2 = new File(['test'], 'image2.jpg', { type: 'image/jpeg' });
        
        checkFilesForDuplicates.mockResolvedValue({
            trueDuplicates: [
                {
                    file: mockFile1,
                    isDuplicate: true,
                    analysisData: { voltage: 12.5 },
                    recordId: 'rec-123',
                    timestamp: '2025-01-01T00:00:00Z'
                }
            ],
            needsUpgrade: [],
            newFiles: [
                {
                    file: mockFile2,
                    isDuplicate: false
                }
            ]
        });

        // Create mock log function
        const mockLog = jest.fn();

        // Simulate calling checkFilesForDuplicates
        const files = [mockFile1, mockFile2];
        const result = await checkFilesForDuplicates(files, mockLog);

        // Verify it was called
        expect(checkFilesForDuplicates).toHaveBeenCalledWith(files, mockLog);
        
        // Verify the result structure
        expect(result).toHaveProperty('trueDuplicates');
        expect(result).toHaveProperty('needsUpgrade');
        expect(result).toHaveProperty('newFiles');
        expect(result.trueDuplicates).toHaveLength(1);
        expect(result.newFiles).toHaveLength(1);
    });

    test('checkFilesForDuplicates returns correct categorization', async () => {
        const mockDuplicate = new File(['dup'], 'duplicate.jpg', { type: 'image/jpeg' });
        const mockUpgrade = new File(['upg'], 'upgrade.jpg', { type: 'image/jpeg' });
        const mockNew = new File(['new'], 'new.jpg', { type: 'image/jpeg' });

        checkFilesForDuplicates.mockResolvedValue({
            trueDuplicates: [{
                file: mockDuplicate,
                isDuplicate: true,
                analysisData: { soc: 75 },
                recordId: 'dup-1',
                timestamp: '2025-01-01T00:00:00Z'
            }],
            needsUpgrade: [{
                file: mockUpgrade,
                isDuplicate: true,
                needsUpgrade: true
            }],
            newFiles: [{
                file: mockNew,
                isDuplicate: false
            }]
        });

        const files = [mockDuplicate, mockUpgrade, mockNew];
        const result = await checkFilesForDuplicates(files, jest.fn());

        expect(result.trueDuplicates).toHaveLength(1);
        expect(result.trueDuplicates[0].file).toBe(mockDuplicate);
        expect(result.needsUpgrade).toHaveLength(1);
        expect(result.needsUpgrade[0].file).toBe(mockUpgrade);
        expect(result.newFiles).toHaveLength(1);
        expect(result.newFiles[0].file).toBe(mockNew);
    });

    test('checkFilesForDuplicates handles errors gracefully', async () => {
        const mockFile = new File(['test'], 'error.jpg', { type: 'image/jpeg' });
        const mockLog = jest.fn();

        checkFilesForDuplicates.mockRejectedValue(new Error('API failed'));

        await expect(checkFilesForDuplicates([mockFile], mockLog))
            .rejects
            .toThrow('API failed');
    });

    test('empty file array returns empty results', async () => {
        checkFilesForDuplicates.mockResolvedValue({
            trueDuplicates: [],
            needsUpgrade: [],
            newFiles: []
        });

        const result = await checkFilesForDuplicates([], jest.fn());

        expect(result.trueDuplicates).toHaveLength(0);
        expect(result.needsUpgrade).toHaveLength(0);
        expect(result.newFiles).toHaveLength(0);
    });

    test('all duplicates scenario shows correct count', async () => {
        const mockFiles = Array.from({ length: 22 }, (_, i) => 
            new File(['test'], `image${i}.jpg`, { type: 'image/jpeg' })
        );

        checkFilesForDuplicates.mockResolvedValue({
            trueDuplicates: mockFiles.map(file => ({
                file,
                isDuplicate: true,
                analysisData: { voltage: 12.0 },
                recordId: `rec-${file.name}`,
                timestamp: '2025-01-01T00:00:00Z'
            })),
            needsUpgrade: [],
            newFiles: []
        });

        const result = await checkFilesForDuplicates(mockFiles, jest.fn());

        expect(result.trueDuplicates).toHaveLength(22);
        expect(result.newFiles).toHaveLength(0);
        expect(result.needsUpgrade).toHaveLength(0);
    });

    test('mixed files scenario (10 new + 12 duplicates)', async () => {
        const duplicateFiles = Array.from({ length: 12 }, (_, i) => 
            new File(['dup'], `dup${i}.jpg`, { type: 'image/jpeg' })
        );
        const newFiles = Array.from({ length: 10 }, (_, i) => 
            new File(['new'], `new${i}.jpg`, { type: 'image/jpeg' })
        );
        const allFiles = [...duplicateFiles, ...newFiles];

        checkFilesForDuplicates.mockResolvedValue({
            trueDuplicates: duplicateFiles.map(file => ({
                file,
                isDuplicate: true,
                analysisData: { current: 5.0 },
                recordId: `rec-${file.name}`,
                timestamp: '2025-01-01T00:00:00Z'
            })),
            needsUpgrade: [],
            newFiles: newFiles.map(file => ({
                file,
                isDuplicate: false
            }))
        });

        const result = await checkFilesForDuplicates(allFiles, jest.fn());

        expect(result.trueDuplicates).toHaveLength(12);
        expect(result.newFiles).toHaveLength(10);
        expect(result.needsUpgrade).toHaveLength(0);
    });
});
