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
                file: userFile,
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
            expect(result.current.fileError).toBe('Previews skipped: all selected files are known duplicates already uploaded.');
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

    test('mixed batch generates previews only for non-duplicates', async () => {
        const originalFileReader = global.FileReader;
        class SuccessFileReader {
            readyState = 0;
            result = null;
            onload = null;
            onerror = null;
            abort = jest.fn();
            readAsDataURL() {
                this.readyState = 2;
                this.result = 'data:mock';
                if (this.onload) {
                    this.onload();
                }
            }
        }
        // @ts-ignore
        global.FileReader = SuccessFileReader;

        const dup1 = new File(['dup1'], 'dup1.png', { type: 'image/png' });
        const dup2 = new File(['dup2'], 'dup2.png', { type: 'image/png' });
        const fresh1 = new File(['fresh1'], 'fresh1.png', { type: 'image/png' });
        const fresh2 = new File(['fresh2'], 'fresh2.png', { type: 'image/png' });

        checkFilesForDuplicates.mockResolvedValue({
            trueDuplicates: [{ file: dup1 }, { file: dup2 }],
            needsUpgrade: [],
            newFiles: [{ file: fresh1 }, { file: fresh2 }]
        });

        const { result } = renderHook(() => useFileUpload());

        await act(async () => {
            await result.current.processFileList(makeFileList([dup1, dup2, fresh1, fresh2]));
        });

        await waitFor(() => {
            expect(result.current.files).toHaveLength(4);
        });

        await waitFor(() => {
            expect(result.current.previews).toHaveLength(4);
        });

        expect(result.current.fileError).toBeNull();
        global.FileReader = originalFileReader;
    });

    test('filters non-blob entries while keeping previews for valid files', async () => {
        const validFile = new File(['valid'], 'valid.png', { type: 'image/png' });

        const { result } = renderHook(() => useFileUpload({ initialFiles: [validFile, { invalid: true }] }));

        await waitFor(() => {
            expect(result.current.previews).toHaveLength(1);
        });

        expect(result.current.fileError).toBeNull();
    });

    test('handles FileReader errors by clearing previews gracefully', async () => {
        const originalFileReader = global.FileReader;
        class ErrorFileReader {
            readyState = 0;
            onload = null;
            onerror = null;
            abort = jest.fn();
            readAsDataURL() {
                this.readyState = 2;
                if (this.onerror) {
                    this.onerror(new Error('read error'));
                }
            }
        }
        // @ts-ignore
        global.FileReader = ErrorFileReader;

        const userFile = new File(['data'], 'error.png', { type: 'image/png' });
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
            expect(result.current.previews).toHaveLength(0);
        });

        global.FileReader = originalFileReader;
    });
});
