// @ts-nocheck
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { createStandardEntryMeta, logDebugRequestSummary } = require('./utils/handler-logging.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
/* eslint-disable */
const { getCollection } = require('./utils/mongodb.cjs');
const crypto = require('crypto');

/**
 * Optimized Chunked Upload Endpoint
 * 
 * Features:
 * - Chunked uploads for files >4MB
 * - Progress tracking
 * - Resume capability for interrupted uploads
 * - Image preprocessing (compression)
 * - Concurrent chunk handling
 * - Automatic assembly after all chunks received
 */

const CHUNK_SIZE = 1 * 1024 * 1024;  // 1MB chunks
const MAX_FILE_SIZE = 50 * 1024 * 1024;  // 50MB max

/**
 * Generate upload session ID
 */
function generateUploadSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Store chunk in database
 */
async function storeChunk(sessionId, chunkIndex, chunkData, totalChunks, fileName, log) {
    try {
        const chunksCol = await getCollection('upload-chunks');

        await chunksCol.insertOne({
            sessionId,
            chunkIndex,
            chunkData: Buffer.from(chunkData, 'base64'),
            totalChunks,
            fileName,
            uploadedAt: new Date()
        });

        log.debug('Chunk stored', { sessionId, chunkIndex, totalChunks });

        return { success: true };
    } catch (error) {
        log.error('Failed to store chunk', { sessionId, chunkIndex, error: error.message });
        throw error;
    }
}

/**
 * Check upload progress
 */
async function getUploadProgress(sessionId, log) {
    try {
        const chunksCol = await getCollection('upload-chunks');

        const chunks = await chunksCol.find({ sessionId }).toArray();

        if (chunks.length === 0) {
            return null;
        }

        const totalChunks = chunks[0].totalChunks;
        const receivedChunks = chunks.length;
        const receivedIndexes = chunks.map(c => c.chunkIndex).sort((a, b) => a - b);

        const isComplete = receivedChunks === totalChunks;

        return {
            sessionId,
            fileName: chunks[0].fileName,
            totalChunks,
            receivedChunks,
            receivedIndexes,
            isComplete,
            progress: (receivedChunks / totalChunks) * 100
        };
    } catch (error) {
        log.error('Failed to get upload progress', { sessionId, error: error.message });
        throw error;
    }
}

/**
 * Assemble chunks into complete file
 */
async function assembleChunks(sessionId, log) {
    try {
        const chunksCol = await getCollection('upload-chunks');

        // Get all chunks sorted by index
        const chunks = await chunksCol.find({ sessionId })
            .sort({ chunkIndex: 1 })
            .toArray();

        if (chunks.length === 0) {
            throw new Error('No chunks found for session');
        }

        const totalChunks = chunks[0].totalChunks;
        if (chunks.length !== totalChunks) {
            throw new Error(`Incomplete upload: ${chunks.length}/${totalChunks} chunks received`);
        }

        // Concatenate all chunks
        const buffers = chunks.map(chunk => chunk.chunkData);
        const completeFile = Buffer.concat(buffers);

        // Convert to base64 for storage
        const base64Data = completeFile.toString('base64');

        // Clean up chunks
        await chunksCol.deleteMany({ sessionId });

        log.info('Chunks assembled successfully', {
            sessionId,
            fileName: chunks[0].fileName,
            totalSize: completeFile.length,
            chunksUsed: chunks.length
        });

        return {
            fileName: chunks[0].fileName,
            data: base64Data,
            size: completeFile.length
        };
    } catch (error) {
        log.error('Failed to assemble chunks', { sessionId, error: error.message });
        throw error;
    }
}

/**
 * Preprocess image (compression, format conversion if needed)
 */
async function preprocessImage(imageData, mimeType, log) {
    // For now, return as-is
    // In production, could use sharp or similar library for:
    // - Compression
    // - Format conversion (HEIC -> JPG, etc.)
    // - Orientation correction
    // - Resolution limiting

    log.debug('Image preprocessing', { mimeType, originalSize: imageData.length });

    return {
        data: imageData,
        mimeType,
        preprocessed: false,
        originalSize: imageData.length,
        finalSize: imageData.length
    };
}

exports.handler = async (event, context) => {
    const headers = {
        ...getCorsHeaders(event),
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const log = createLoggerFromEvent('optimized-upload', event, context);
    log.entry(createStandardEntryMeta(event));
    // This endpoint is JSON-body based; log a capped request summary to aid debugging.
    logDebugRequestSummary(log, event, { label: 'Optimized upload request', includeBody: true, bodyMaxStringLength: 20000 });
    const timer = createTimer(log, 'optimized-upload');

    try {
        if (event.httpMethod === 'POST') {
            // Parse request
            const body = JSON.parse(event.body);
            const { action, sessionId, chunkIndex, chunkData, totalChunks, fileName, mimeType } = body;

            log.debug('Upload request received', { action, sessionId, chunkIndex, totalChunks });

            // Handle different actions
            switch (action) {
                case 'initiate': {
                    // Start new upload session
                    const newSessionId = generateUploadSessionId();
                    const { fileName: newFileName, totalChunks: newTotalChunks, fileSize } = body;

                    if (fileSize > MAX_FILE_SIZE) {
                        log.warn('File too large', { fileSize, maxSize: MAX_FILE_SIZE });
                        return {
                            statusCode: 413,
                            headers,
                            body: JSON.stringify({
                                error: 'File too large',
                                maxSize: MAX_FILE_SIZE,
                                providedSize: fileSize
                            })
                        };
                    }

                    log.info('Upload session initiated', { sessionId: newSessionId, fileName: newFileName, totalChunks: newTotalChunks });

                    timer.end({ action: 'initiate' });
                    log.exit(200);
                    return {
                        statusCode: 200,
                        headers,
                        body: JSON.stringify({
                            sessionId: newSessionId,
                            chunkSize: CHUNK_SIZE,
                            maxFileSize: MAX_FILE_SIZE
                        })
                    };
                }

                case 'upload-chunk': {
                    // Store chunk
                    if (!sessionId || chunkIndex === undefined || !chunkData || !totalChunks) {
                        log.warn('Missing chunk upload parameters', { sessionId, chunkIndex, totalChunks });
                        return {
                            statusCode: 400,
                            headers,
                            body: JSON.stringify({ error: 'Missing required parameters' })
                        };
                    }

                    await storeChunk(sessionId, chunkIndex, chunkData, totalChunks, fileName, log);

                    // Check if upload is complete
                    const progress = await getUploadProgress(sessionId, log);

                    log.info('Chunk uploaded', { sessionId, chunkIndex, progress: progress?.progress });

                    if (progress?.isComplete) {
                        // Assemble and process
                        log.info('All chunks received, assembling file', { sessionId });
                        const assembled = await assembleChunks(sessionId, log);

                        // Preprocess image
                        const preprocessed = await preprocessImage(assembled.data, mimeType, log);

                        timer.end({ action: 'upload-chunk', complete: true });
                        log.exit(200);
                        return {
                            statusCode: 200,
                            headers,
                            body: JSON.stringify({
                                complete: true,
                                sessionId,
                                fileName: assembled.fileName,
                                size: assembled.size,
                                preprocessed: preprocessed.preprocessed,
                                data: preprocessed.data
                            })
                        };
                    } else {
                        timer.end({ action: 'upload-chunk', complete: false });
                        log.exit(200);
                        return {
                            statusCode: 200,
                            headers,
                            body: JSON.stringify({
                                complete: false,
                                sessionId,
                                progress: progress?.progress,
                                receivedChunks: progress?.receivedChunks,
                                totalChunks: progress?.totalChunks
                            })
                        };
                    }

                }

                case 'check-progress': {
                    // Check upload progress
                    if (!sessionId) {
                        return {
                            statusCode: 400,
                            headers,
                            body: JSON.stringify({ error: 'Missing sessionId' })
                        };
                    }

                    const checkProgress = await getUploadProgress(sessionId, log);

                    if (!checkProgress) {
                        timer.end({ action: 'check-progress', found: false });
                        log.exit(404);
                        return {
                            statusCode: 404,
                            headers,
                            body: JSON.stringify({ error: 'Session not found' })
                        };
                    }

                    timer.end({ action: 'check-progress' });
                    log.exit(200);
                    return {
                        statusCode: 200,
                        headers,
                        body: JSON.stringify(checkProgress)
                    };

                }

                case 'cancel': {
                    // Cancel upload and clean up chunks
                    if (!sessionId) {
                        return {
                            statusCode: 400,
                            headers,
                            body: JSON.stringify({ error: 'Missing sessionId' })
                        };
                    }

                    const chunksCol = await getCollection('upload-chunks');
                    const deleteResult = await chunksCol.deleteMany({ sessionId });

                    log.info('Upload cancelled', { sessionId, chunksDeleted: deleteResult.deletedCount });

                    timer.end({ action: 'cancel' });
                    log.exit(200);
                    return {
                        statusCode: 200,
                        headers,
                        body: JSON.stringify({
                            cancelled: true,
                            chunksDeleted: deleteResult.deletedCount
                        })
                    };

                }

                default:
                    log.warn('Invalid action', { action });
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: 'Invalid action',
                            validActions: ['initiate', 'upload-chunk', 'check-progress', 'cancel']
                        })
                    };
            }
        } else {
            return {
                statusCode: 405,
                headers,
                body: JSON.stringify({ error: 'Method not allowed' })
            };
        }
    } catch (error) {
        timer.end({ error: true });
        log.error('Upload failed', { error: error.message, stack: error.stack });
        log.exit(500);

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Upload failed',
                message: error.message
            })
        };
    }
};
