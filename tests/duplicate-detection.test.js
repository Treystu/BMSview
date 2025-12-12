import { renderHook, act } from '@testing-library/react';
import { useFileUpload } from '../hooks/useFileUpload';

// Mock sha256Browser
jest.mock('../utils', () => ({
  sha256Browser: jest.fn().mockImplementation(async (file) => {
    return `hash-${file.name}`;
  }),
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
    expect(result.current.files.length).toBe(2);
    
    // Check new file
    expect(result.current.files.some(f => f.name === 'new-file.png')).toBe(true);
    
    // Check upgrade file (should be marked)
    const upgradeFile = result.current.files.find(f => f.name === 'existing-imperfect.png');
    expect(upgradeFile).toBeDefined();
    expect(upgradeFile._isUpgrade).toBe(true);
    
    // Duplicate should be tracked as skipped
    expect(result.current.skippedFiles.size).toBe(1);
  });
});
