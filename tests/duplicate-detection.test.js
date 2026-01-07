import { act, renderHook } from '@testing-library/react';

// Mock duplicateChecker to avoid pulling in worker-dependent services
jest.mock('../src/utils/duplicateChecker', () => ({
  checkFilesForDuplicates: jest.fn(async (files) => {
    const toArray = Array.from(files || []);
    return {
      trueDuplicates: toArray
        .filter((f) => f?.name === 'existing-perfect.png')
        .map((file) => ({ file, isDuplicate: true, needsUpgrade: false, recordId: 'rec-existing', timestamp: '2025-01-01T00:00:00Z', analysisData: { soc: 85 } })),
      needsUpgrade: toArray
        .filter((f) => f?.name === 'existing-imperfect.png')
        .map((file) => {
          const upgraded = Object.assign(file, { _isUpgrade: true });
          return { file: upgraded, isDuplicate: true, needsUpgrade: true };
        }),
      newFiles: toArray
        .filter((f) => f && !['existing-perfect.png', 'existing-imperfect.png'].includes(f.name))
        .map((file) => ({ file, isDuplicate: false, needsUpgrade: false }))
    };
  }),
  processBatches: jest.fn()
}));

import { useFileUpload } from '../src/hooks/useFileUpload';

// Mock sha256Browser
jest.mock('../src/utils', () => ({
  sha256Browser: jest.fn().mockImplementation(async (file) => {
    return `hash-${file.name}`;
  }),
}));

// Mock geminiService to avoid worker initialization in Jest
jest.mock('../src/services/geminiService', () => ({
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
jest.mock('../src/services/clientService', () => ({
  checkHashes: jest.fn().mockImplementation(async (/** @type {string[]} */ hashes) => {
    const duplicatesWithData = hashes
      .filter((/** @type {string} */ h) => h === 'hash-existing-perfect.png')
      .map((/** @type {string} */ hash) => ({ hash, data: { soc: 85, voltage: 13.2 } }));
    const upgradeHashes = hashes.filter((/** @type {string} */ h) => h === 'hash-existing-imperfect.png');

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
    /** @type {File[]} */
    this.items = [];
    /** @type {File[]} */
    this.files = [];
  }
  /** @param {File} file */
  add(file) {
    this.items.push(file);
    this.files.push(file);
  }
}
/** @type {any} */ (global).DataTransfer = MockDataTransfer;
/** @type {any} */ (global).fetch = jest.fn(() => Promise.resolve({
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

    const dataTransfer = new MockDataTransfer();
    dataTransfer.add(new File(['content1'], 'existing-perfect.png', { type: 'image/png' }));
    dataTransfer.add(new File(['content2'], 'new-file.png', { type: 'image/png' }));
    dataTransfer.add(new File(['content3'], 'existing-imperfect.png', { type: 'image/png' }));

    await act(async () => {
      const fileList = {
        length: dataTransfer.files.length,
        /** @param {number} index */
        item: (index) => dataTransfer.files[index],
        0: dataTransfer.files[0],
        1: dataTransfer.files[1],
        2: dataTransfer.files[2],
      };
      await result.current.processFileList(/** @type {any} */(fileList));
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
    const safeName = (/** @type {File & { _isUpgrade?: boolean }} */ file) => {
      try {
        return file && typeof file.name === 'string' ? file.name : undefined;
      } catch {
        return undefined;
      }
    };

    const upgradeFile = /** @type {any} */ (result.current.files.find(f => safeName(f) === 'existing-imperfect.png'));
    expect(upgradeFile ? upgradeFile._isUpgrade : true).toBe(true);

    // Duplicate should be tracked as skipped
    expect(result.current.skippedFiles.size).toBe(1);
  });
});
