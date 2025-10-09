import { useState, useCallback, useEffect } from 'react';
import JSZip from 'jszip';

const getMimeTypeFromFileName = (fileName: string): string => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    switch (extension) {
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'png':
            return 'image/png';
        case 'gif':
            return 'image/gif';
        case 'webp':
            return 'image/webp';
        default:
            return 'application/octet-stream';
    }
};

interface FileUploadOptions {
    maxFileSizeMb?: number;
}

export const useFileUpload = ({ maxFileSizeMb = 4.5 }: FileUploadOptions = {}) => {
    const [files, setFiles] = useState<File[]>([]);
    const [previews, setPreviews] = useState<string[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [fileError, setFileError] = useState<string | null>(null);

    const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;

    useEffect(() => {
        const newPreviews = files.map(file => URL.createObjectURL(file));
        setPreviews(newPreviews);
        
        return () => {
            newPreviews.forEach(url => URL.revokeObjectURL(url));
        };
    }, [files]);

    const handleZipFile = useCallback(async (zipFile: File) => {
        setIsProcessing(true);
        setFileError(null);
        try {
            const zip = await JSZip.loadAsync(zipFile);
            const imagePromises: Promise<File>[] = [];
            zip.forEach((_, zipEntry) => {
                if (!zipEntry.dir && /\.(jpe?g|png|gif|webp)$/i.test(zipEntry.name)) {
                    const promise = zipEntry.async('blob').then(blob => {
                        const mimeType = blob.type || getMimeTypeFromFileName(zipEntry.name);
                        return new File([blob], zipEntry.name, { type: mimeType });
                    });
                    imagePromises.push(promise);
                }
            });
            const extractedFiles = await Promise.all(imagePromises);
            setFiles(prevFiles => [...prevFiles, ...extractedFiles]);
        } catch (e) {
            console.error("Error unzipping file:", e);
            setFileError("Failed to unzip the file. It may be corrupt.");
        } finally {
            setIsProcessing(false);
        }
    }, []);

    const processFileList = useCallback((fileList: FileList) => {
        setFileError(null);
        const fileArray = Array.from(fileList);

        const validImageFiles: File[] = [];
        const oversizedFiles: string[] = [];
        const imageFiles = fileArray.filter(f => f.type.startsWith('image/'));
        
        for (const f of imageFiles) {
            if (f.size > maxFileSizeBytes) {
                oversizedFiles.push(f.name);
            } else {
                validImageFiles.push(f);
            }
        }

        const zipFiles = fileArray.filter(f => f.name.endsWith('.zip') || f.type === 'application/zip' || f.type === 'application/x-zip-compressed');
        
        if (validImageFiles.length > 0) {
            setFiles(prevFiles => [...prevFiles, ...validImageFiles]);
        }

        if (oversizedFiles.length > 0) {
            setFileError(`The following files are too large (max ${maxFileSizeMb}MB): ${oversizedFiles.join(', ')}. Please resize them and try again.`);
        }
        
        zipFiles.forEach(handleZipFile);
    }, [handleZipFile, maxFileSizeBytes, maxFileSizeMb]);

    const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            processFileList(event.target.files);
        }
    }, [processFileList]);
    
    const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer.files) {
            processFileList(event.dataTransfer.files);
        }
    }, [processFileList]);

    const clearFiles = () => {
        setFiles([]);
        setPreviews([]);
        setFileError(null);
    };

    return {
        files,
        previews,
        isProcessing,
        fileError,
        handleFileChange,
        handleDrop,
        clearFiles,
    };
};
