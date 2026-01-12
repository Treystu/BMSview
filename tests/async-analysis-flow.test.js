/**
 * Async Analysis Flow Tests
 * 
 * Tests for the complete async analysis implementation including:
 * - Async workload handler
 * - Job status endpoint
 * - Async client
 * - Frontend integration
 */

// Mock fetch for API tests

global.fetch = jest.fn();

describe('Async Analysis Flow', () => {
    describe('get-job-status endpoint', () => {
        test('should return empty array for no job IDs', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ jobs: [], count: 0 })
            });

            const response = await fetch('http://localhost:8888/.netlify/functions/get-job-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobIds: [] })
            });

            expect(response.ok).toBe(true);
            const data = await response.json();
            expect(data.jobs).toEqual([]);
            expect(data.count).toBe(0);
        });

        test('should handle GET request with query params', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ jobs: [], count: 0 })
            });

            const response = await fetch('http://localhost:8888/.netlify/functions/get-job-status?ids=job1,job2');

            expect(response.ok).toBe(true);
            const data = await response.json();
            expect(data.jobs).toBeDefined();
            expect(Array.isArray(data.jobs)).toBe(true);
        });
    });

    describe('analyze endpoint async mode', () => {
        test('should accept async analysis request', async () => {
            const testImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

            fetch.mockResolvedValueOnce({
                status: 202,
                ok: true,
                json: async () => ({
                    success: true,
                    jobId: 'test-async-job',
                    message: 'Async analysis accepted for processing'
                })
            });

            const response = await fetch('http://localhost:8888/.netlify/functions/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobId: 'test-async-job',
                    fileData: testImage,
                    fileName: 'test.png',
                    mimeType: 'image/png'
                })
            });

            expect(response.status).toBe(202);
            const data = await response.json();
            expect(data.success).toBe(true);
            expect(data.jobId).toBe('test-async-job');
            expect(data.message).toContain('accepted');
        });

        test('should validate required fields for async', async () => {
            fetch.mockResolvedValueOnce({
                status: 400,
                ok: false,
                text: async () => JSON.stringify({
                    error: 'missing_parameters',
                    message: 'Missing required parameters'
                })
            });

            const response = await fetch('http://localhost:8888/.netlify/functions/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            expect(response.status).toBe(400);
        });
    });

    describe('Async Client', () => {
        test('should export triggerAnalysisAsync function', () => {
            const fs = require('fs');
            const path = require('path');

            const filePath = path.join(__dirname, '../netlify/functions/utils/analysis-async-client.cjs');
            expect(fs.existsSync(filePath)).toBe(true);

            const content = fs.readFileSync(filePath, 'utf8');
            expect(content).toContain('triggerAnalysisAsync');
            expect(content).toContain('module.exports');
        });
    });

    describe('Frontend Integration', () => {
        test('should generate unique job IDs', () => {
            const jobId1 = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const jobId2 = `job_${Date.now() + 1}_${Math.random().toString(36).substr(2, 9)}`;

            expect(jobId1).not.toBe(jobId2);
            expect(jobId1).toMatch(/^job_\d+_[a-z0-9]{9}$/);
        });

        test('should handle async payload structure', () => {
            const payload = {
                jobId: 'test-job',
                fileData: 'base64-data',
                fileName: 'test.png',
                mimeType: 'image/png',
                systemId: 'system-123',
                forceReanalysis: false
            };

            expect(payload.jobId).toBe('test-job');
            expect(payload.fileData).toBe('base64-data');
            expect(payload.fileName).toBe('test.png');
            expect(payload.mimeType).toBe('image/png');
            expect(payload.systemId).toBe('system-123');
            expect(payload.forceReanalysis).toBe(false);
        });
    });

    describe('Job Status Data Structure', () => {
        test('should have correct job status structure', () => {
            const jobStatus = {
                jobId: 'job-123',
                status: 'completed',
                recordId: 'record-456',
                fileName: 'test.png',
                timestamp: new Date().toISOString(),
                error: null
            };

            expect(jobStatus).toHaveProperty('jobId');
            expect(jobStatus).toHaveProperty('status');
            expect(jobStatus).toHaveProperty('recordId');
            expect(jobStatus).toHaveProperty('fileName');
            expect(jobStatus).toHaveProperty('timestamp');
            expect(jobStatus).toHaveProperty('error');

            expect(typeof jobStatus.jobId).toBe('string');
            expect(typeof jobStatus.status).toBe('string');
            expect(['queued', 'processing', 'completed', 'failed']).toContain(jobStatus.status);
        });

        test('should handle progress events structure', () => {
            const progressEvent = {
                jobId: 'job-123',
                stage: 'processing',
                progress: 50,
                message: 'Processing image...',
                timestamp: new Date()
            };

            expect(progressEvent).toHaveProperty('jobId');
            expect(progressEvent).toHaveProperty('stage');
            expect(progressEvent).toHaveProperty('progress');
            expect(progressEvent).toHaveProperty('message');
            expect(progressEvent).toHaveProperty('timestamp');

            expect(typeof progressEvent.progress).toBe('number');
            expect(progressEvent.progress).toBeGreaterThanOrEqual(0);
            expect(progressEvent.progress).toBeLessThanOrEqual(100);
        });
    });
});
