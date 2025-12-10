import { partitionCachedFiles } from '../utils/duplicateChecker';

describe('partitionCachedFiles', () => {
    const now = new Date().toISOString();

    it('separates cached duplicates, upgrades, and remaining files with metadata', () => {
        const duplicateFile = {
            name: 'dup.png',
            _isDuplicate: true,
            _analysisData: { some: 'data', _recordId: 'r1', _timestamp: now }
        };

        const upgradeFile = { name: 'upgrade.png', _isUpgrade: true };
        const newFile = { name: 'new.png' };

        const { cachedDuplicates, cachedUpgrades, remainingFiles } = partitionCachedFiles([
            duplicateFile,
            upgradeFile,
            newFile
        ]);

        expect(cachedDuplicates).toHaveLength(1);
        expect(cachedDuplicates[0].recordId).toBe('r1');
        expect(cachedDuplicates[0].timestamp).toBe(now);
        expect(cachedDuplicates[0].analysisData).toEqual({ some: 'data', _recordId: 'r1', _timestamp: now });

        expect(cachedUpgrades.map(f => f.name)).toEqual(['upgrade.png']);
        expect(remainingFiles.map(f => f.name)).toEqual(['new.png']);
    });
});
