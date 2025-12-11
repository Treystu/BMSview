import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileUpload } from '../hooks/useFileUpload';
import { checkFilesForDuplicates } from '../utils/duplicateChecker';

jest.mock('../utils/duplicateChecker', () => ({
    checkFilesForDuplicates: jest.fn(),
}));

const makeFileList = (files) => {
    const list = {
        length: files.length,
        item: (index) => files[index] ?? null,
        [Symbol.iterator]: function* () {
            for (const file of files) {
                yield file;
            }
        },
    };
    files.forEach((file, index) => {
        list[index] = file;
    });
    return list;
};

describe('useFileUpload preview safety', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('handles all-duplicate batch without generating blob previews', async () => {
        const userFile = new File(['duplicate'], 'dup.png', { type: 'image/png' });

        checkFilesForDuplicates.mockResolvedValue({
            trueDuplicates: [{
                file: { name: 'dup.png', type: 'image/png' },
                analysisData: { stateOfCharge: 80 },
                recordId: 'abc123',
                timestamp: '2025-01-01T00:00:00Z'
            }],
            needsUpgrade: [],
            newFiles: []
        });

        const { result } = renderHook(() => useFileUpload());

        await act(async () => {
            await result.current.processFileList(makeFileList([userFile]));
        });

        await waitFor(() => {
            expect(result.current.previews).toHaveLength(0);
            expect(result.current.fileError).toContain('duplicates');
        });

        expect(result.current.files).toHaveLength(1);
        const storedFile = result.current.files[0];
        expect(storedFile).toBeInstanceOf(File);
        expect(Object.prototype.hasOwnProperty.call(storedFile, '_isDuplicate')).toBe(true);
        expect((storedFile)._isDuplicate).toBe(true);
    });

    test('generates data URL previews for valid files', async () => {
        const userFile = new File(['hello world'], 'valid.png', { type: 'image/png' });

        checkFilesForDuplicates.mockResolvedValue({
            trueDuplicates: [],
            needsUpgrade: [],
            newFiles: [{ file: userFile }]
        });

        const { result } = renderHook(() => useFileUpload());

        await act(async () => {
            await result.current.processFileList(makeFileList([userFile]));
        });

        await waitFor(() => {
            expect(result.current.previews).toHaveLength(1);
        });

        expect(result.current.previews[0]).toMatch(/^data:/);
        expect(result.current.fileError).toBeNull();
    });
});
