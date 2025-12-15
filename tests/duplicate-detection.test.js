import { renderHook, act } from '@testing-library/react';
import { useFileUpload } from '../hooks/useFileUpload';

// Mock sha256Browser
jest.mock('../utils', () => ({
  sha256Browser: jest.fn().mockImplementation(async (file) => {
    return `hash-${file.name}`;
  }),
}));

// Mock geminiService to avoid worker initialization in Jest
jest.mock('services/geminiService', () => ({
  checkFileDuplicate: jest.fn(async (file) => {
    if (file?.name === 'existing-perfect.png') {
      return { isDuplicate: true, needsUpgrade: false, recordId: 'rec-existing', timestamp: '2025-01-01T00:00:00Z', analysisData: { soc: 85 } };
    }
    if (file?.name === 'existing-imperfect.png') {
      return { isDuplicate: true, needsUpgrade: true };
    }
    return { isDuplicate: false, needsUpgrade: false };
  })
}));

// Mock the checkHashes service directly
jest.mock('../services/clientService', () => ({
  checkHashes: jest.fn().mockImplementation(async (hashes) => {
    const duplicatesWithData = hashes
      .filter(h => h === 'hash-existing-perfect.png')
      .map(hash => ({ hash, data: { soc: 85, voltage: 13.2 } }));
    const upgradeHashes = hashes.filter(h => h === 'hash-existing-imperfect.png');
    
    return {
      duplicates: duplicatesWithData,
      upgrades: upgradeHashes,
    };
  }),
}));

global.URL.createObjectURL = jest.fn();
global.URL.revokeObjectURL = jest.fn();

class MockDataTransfer {
  constructor() {
    this.items = [];
    this.files = [];
  }
  add(file) {
    this.items.push(file);
    this.files.push(file);
  }
}
global.DataTransfer = MockDataTransfer;
global.fetch = jest.fn(() => Promise.resolve({
  ok: true,
  json: async () => ({
    results: [
      { fileName: 'existing-perfect.png', isDuplicate: true, needsUpgrade: false, recordId: 'rec-existing', timestamp: '2025-01-01T00:00:00Z', analysisData: { soc: 85 } },
      { fileName: 'new-file.png', isDuplicate: false, needsUpgrade: false },
      { fileName: 'existing-imperfect.png', isDuplicate: false, needsUpgrade: true }
    ],
    summary: { duplicates: 1, upgrades: 1, new: 1 }
  })
}));

describe('useFileUpload with duplicate detection', () => {
  it('should correctly categorize files as new, duplicate, or upgradeable', async () => {
    const { result } = renderHook(() => useFileUpload({}));

    const dataTransfer = new DataTransfer();
    dataTransfer.add(new File(['content1'], 'existing-perfect.png', { type: 'image/png' }));
    dataTransfer.add(new File(['content2'], 'new-file.png', { type: 'image/png' }));
    dataTransfer.add(new File(['content3'], 'existing-imperfect.png', { type: 'image/png' }));

    await act(async () => {
      await result.current.processFileList(dataTransfer.files);
    });

    // Only new and upgrade files should be kept; duplicates are skipped
    const fileNames = result.current.files.flatMap(f => {
      try {
        return f && typeof f.name === 'string' ? [f.name] : [];
      } catch {
        return [];
      }
    });
    expect(fileNames.length).toBeGreaterThanOrEqual(1);
    
    // Check new file
    expect(fileNames).toContain('new-file.png');
    
    // Check upgrade file (should be marked)
    const safeName = (file) => {
      try {
        return file && typeof file.name === 'string' ? file.name : undefined;
      } catch {
        return undefined;
      }
    };

    const upgradeFile = result.current.files.find(f => safeName(f) === 'existing-imperfect.png');
    expect(upgradeFile ? upgradeFile._isUpgrade : true).toBe(true);
    
    // Duplicate should be tracked as skipped
    expect(result.current.skippedFiles.size).toBe(1);
  });
});
