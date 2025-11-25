import { renderHook, act } from '@testing-library/react';
import { useFileUpload } from '../hooks/useFileUpload';

// No longer mocking checkHashes or sha256Browser since we removed client-side duplicate detection
// The backend now handles duplicate detection via content hash

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
  it('should add all valid image files to files list (backend handles duplicate detection)', async () => {
    const { result } = renderHook(() => useFileUpload({}));

    const dataTransfer = new DataTransfer();
    dataTransfer.add(new File(['content1'], 'existing-perfect.png', { type: 'image/png' }));
    dataTransfer.add(new File(['content2'], 'new-file.png', { type: 'image/png' }));
    dataTransfer.add(new File(['content3'], 'existing-imperfect.png', { type: 'image/png' }));

    await act(async () => {
      await result.current.processFileList(dataTransfer.files);
    });

    // All files should now be added to the files list
    // Backend will handle duplicate detection and return existing data with isDuplicate flag
    expect(result.current.files.length).toBe(3);
    expect(result.current.files.some(f => f.name === 'new-file.png')).toBe(true);
    expect(result.current.files.some(f => f.name === 'existing-perfect.png')).toBe(true);
    expect(result.current.files.some(f => f.name === 'existing-imperfect.png')).toBe(true);
    
    // No files should be skipped on client side - backend handles this
    expect(result.current.skippedFiles.size).toBe(0);
  });
});