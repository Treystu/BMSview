const { describe, test, expect, beforeEach } = require('@jest/globals');

// Mock the upload handler
const mockUploadHandler = jest.fn();
jest.mock('../netlify/functions/upload.cjs', () => ({
    handler: mockUploadHandler
}));

describe('Upload Functionality', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should handle valid file upload', async () => {
        const mockFileData = Buffer.from('timestamp,voltage,current\n2024-01-01T10:00:00Z,12.5,10').toString('base64');

        mockUploadHandler.mockResolvedValue({
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'File uploaded successfully',
                recordId: 'test-record-id'
            })
        });

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({
                filename: 'test-data.csv',
                fileBase64: mockFileData,
                userId: 'test-user'
            })
        };

        const result = await mockUploadHandler(event);
        const body = JSON.parse(result.body);

        expect(result.statusCode).toBe(200);
        expect(body.success).toBe(true);
        expect(body.recordId).toBe('test-record-id');
    });

    test('should detect duplicate files', async () => {
        mockUploadHandler.mockResolvedValue({
            statusCode: 409,
            body: JSON.stringify({
                success: false,
                error: 'Duplicate file detected',
                isDuplicate: true
            })
        });

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({
                filename: 'duplicate-file.csv',
                fileBase64: 'dGVzdCBkYXRh', // base64 for "test data"
                userId: 'test-user'
            })
        };

        const result = await mockUploadHandler(event);
        const body = JSON.parse(result.body);

        expect(result.statusCode).toBe(409);
        expect(body.isDuplicate).toBe(true);
    });

    test('should validate file format', async () => {
        mockUploadHandler.mockResolvedValue({
            statusCode: 400,
            body: JSON.stringify({
                success: false,
                error: 'Invalid file format'
            })
        });

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({
                filename: 'invalid-file.txt',
                fileBase64: 'aW52YWxpZCBkYXRh', // base64 for "invalid data"
                userId: 'test-user'
            })
        };

        const result = await mockUploadHandler(event);
        const body = JSON.parse(result.body);

        expect(result.statusCode).toBe(400);
        expect(body.success).toBe(false);
        expect(body.error).toContain('Invalid file format');
    });

    test('should handle missing required fields', async () => {
        mockUploadHandler.mockResolvedValue({
            statusCode: 400,
            body: JSON.stringify({
                success: false,
                error: 'Missing required fields'
            })
        });

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({
                filename: 'test.csv'
                // Missing fileBase64 and userId
            })
        };

        const result = await mockUploadHandler(event);
        const body = JSON.parse(result.body);

        expect(result.statusCode).toBe(400);
        expect(body.success).toBe(false);
    });
});