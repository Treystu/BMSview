import { renderHook, act } from '@testing-library/react';
import { useFileUpload } from '../hooks/useFileUpload';

// Mock FileReader for base64 conversion
class MockFileReader {
  constructor() {
    this.onload = null;
    this.onerror = null;
    this.result = null;
  }
  
  readAsDataURL(file) {
    // Simulate async file reading with immediate resolution
    Promise.resolve().then(() => {
      this.result = `data:image/png;base64,${btoa(file.name)}`;
      if (this.onload) {
        this.onload();
      }
    });
  }
}

global.FileReader = MockFileReader;
global.btoa = (str) => Buffer.from(str).toString('base64');

// Mock fetch for the batch API
global.fetch = jest.fn().mockImplementation(async (url, options) => {
  if (url.includes('check-duplicates-batch')) {
    const body = JSON.parse(options.body);
    const results = body.files.map(f => {
      if (f.fileName === 'existing-perfect.png') {
        return { 
          fileName: f.fileName, 
          isDuplicate: true, 
          needsUpgrade: false,
          recordId: 'record-123',
          timestamp: '2024-01-01T00:00:00Z'
        };
      } else if (f.fileName === 'existing-imperfect.png') {
        return { 
          fileName: f.fileName, 
          isDuplicate: true, 
          needsUpgrade: true,
          recordId: 'record-456'
        };
      } else {
        return { 
          fileName: f.fileName, 
          isDuplicate: false, 
          needsUpgrade: false 
        };
      }
    });
    
    return {
      ok: true,
      json: async () => ({
        results,
        summary: {
          total: body.files.length,
          duplicates: results.filter(r => r.isDuplicate && !r.needsUpgrade).length,
          upgrades: results.filter(r => r.needsUpgrade).length,
          new: results.filter(r => !r.isDuplicate).length
        }
      })
    };
  }
  return { ok: false, status: 404 };
});

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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should correctly categorize files as new, duplicate, or upgradeable', async () => {
    const { result } = renderHook(() => useFileUpload({}));

    const dataTransfer = new DataTransfer();
    dataTransfer.add(new File(['content1'], 'existing-perfect.png', { type: 'image/png' }));
    dataTransfer.add(new File(['content2'], 'new-file.png', { type: 'image/png' }));
    dataTransfer.add(new File(['content3'], 'existing-imperfect.png', { type: 'image/png' }));

    await act(async () => {
      await result.current.processFileList(dataTransfer.files);
      // Wait for async operations to complete (microtasks and setTimeout)
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // All files should be in the files array now (duplicates are marked but not skipped)
    // existing-perfect.png (duplicate), new-file.png (new), existing-imperfect.png (upgrade)
    expect(result.current.files.length).toBe(3);
    
    // Check new file
    expect(result.current.files.some(f => f.name === 'new-file.png')).toBe(true);
    
    // Check duplicate file (should be marked with _isDuplicate)
    const duplicateFile = result.current.files.find(f => f.name === 'existing-perfect.png');
    expect(duplicateFile).toBeDefined();
    expect(duplicateFile._isDuplicate).toBe(true);
    expect(duplicateFile._recordId).toBe('record-123');
    
    // Check upgrade file (should be marked with _isUpgrade)
    const upgradeFile = result.current.files.find(f => f.name === 'existing-imperfect.png');
    expect(upgradeFile).toBeDefined();
    expect(upgradeFile._isUpgrade).toBe(true);
    
    // No files should be skipped in the current implementation
    expect(result.current.skippedFiles.size).toBe(0);
  }, 10000); // 10 second timeout
});