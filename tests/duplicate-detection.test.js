import { rest } from 'msw';
import { setupServer } from 'msw/node';
import { renderHook, act } from '@testing-library/react';
import { useFileUpload } from '../hooks/useFileUpload';

// Mock the checkHashes service
const server = setupServer(
  rest.post('/.netlify/functions/check-hashes', (req, res, ctx) => {
    const { hashes } = req.body;
    const response = {
      duplicates: hashes.filter(h => h === 'hash-existing-perfect.png'),
      upgrades: hashes.filter(h => h === 'hash-existing-imperfect.png'),
    };
    return res(ctx.json(response));
  })
);

// Mock sha256Browser
jest.mock('../utils', () => ({
  sha256Browser: jest.fn().mockImplementation(async (file) => {
    return `hash-${file.name}`;
  }),
}));

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

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

    // new-file.png and existing-imperfect.png (for upgrade) should be in files
    expect(result.current.files.length).toBe(2);
    expect(result.current.files.some(f => f.name === 'new-file.png')).toBe(true);
    const imperfectFile = result.current.files.find(f => f.name === 'existing-imperfect.png');
    expect(imperfectFile).toBeDefined();
    expect(imperfectFile._isUpgrade).toBe(true);
    
    // existing-perfect.png should be skipped
    expect(result.current.skippedFiles.size).toBe(1);
    expect(result.current.skippedFiles.get('existing-perfect.png')).toBe('Skipped (duplicate)');
  });
});