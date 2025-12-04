// @ts-nocheck
/**
 * Tests for generate-insights-background.cjs
 * 
 * NOTE: This endpoint is DEPRECATED as of [date].
 * These tests are kept for backward compatibility verification only.
 * The endpoint is no longer used in the normal workflow.
 * Background processing now happens in-process via insights-processor.cjs
 */

jest.mock('../netlify/functions/utils/insights-jobs.cjs', () => ({
    getInsightsJob: jest.fn(),
    failJob: jest.fn()
}));

jest.mock('../netlify/functions/utils/insights-processor.cjs', () => ({
    processInsightsInBackground: jest.fn()
}));

jest.mock('../netlify/functions/utils/rate-limiter.cjs', () => ({
    applyRateLimit: jest.fn().mockResolvedValue({ remaining: 10, limit: 10, headers: {} }),
    RateLimitError: class RateLimitError extends Error {}
}));

jest.mock('../netlify/functions/utils/security-sanitizer.cjs', () => ({
    sanitizeJobId: jest.fn(id => id),
    sanitizeSystemId: jest.fn(id => id),
    SanitizationError: class SanitizationError extends Error {}
}));

const { handler } = require('../netlify/functions/generate-insights-background.cjs');
const {
    getInsightsJob,
    failJob
} = require('../netlify/functions/utils/insights-jobs.cjs');
const { processInsightsInBackground } = require('../netlify/functions/utils/insights-processor.cjs');

const getInsightsJobMock = /** @type {import('jest-mock').Mock} */ (getInsightsJob);
const failJobMock = /** @type {import('jest-mock').Mock} */ (failJob);
const processInsightsInBackgroundMock = /** @type {import('jest-mock').Mock} */ (processInsightsInBackground);

describe('generate-insights-background handler (DEPRECATED)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        failJobMock.mockResolvedValue(undefined);
    });

    test('processes job successfully when job exists', async () => {
        getInsightsJobMock.mockResolvedValue({
            id: 'job-123',
            analysisData: { foo: 'bar' },
            systemId: 'sys-1',
            customPrompt: 'prompt'
        });
        processInsightsInBackgroundMock.mockResolvedValue({
            success: true,
            insights: { rawText: 'test insights' }
        });

        const response = await handler({ body: JSON.stringify({ jobId: 'job-123' }) }, {});
        const payload = JSON.parse(response.body);

        expect(processInsightsInBackgroundMock).toHaveBeenCalledWith(
            'job-123',
            { foo: 'bar' },
            'sys-1',
            'prompt',
            expect.anything()
        );
        expect(response.statusCode).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.jobId).toBe('job-123');
        expect(payload.error).toBeUndefined();
    });

    test('handles missing job by marking it failed', async () => {
        getInsightsJobMock.mockResolvedValue(null);

        const response = await handler({ body: JSON.stringify({ jobId: 'missing' }) }, {});
        const payload = JSON.parse(response.body);

        expect(getInsightsJobMock).toHaveBeenCalledWith('missing', expect.anything());
        expect(failJobMock).toHaveBeenCalledWith('missing', 'Job not found during background processing', expect.anything());
        expect(payload.success).toBe(false);
        expect(payload.error).toBe('Job not found');
    });

    test('returns error when no jobId provided', async () => {
        const response = await handler({}, {});
        const payload = JSON.parse(response.body);

        expect(getInsightsJobMock).not.toHaveBeenCalled();
        expect(payload.success).toBe(false);
        expect(payload.error).toBe('Missing jobId');
    });

    test('marks job as failed if processing throws', async () => {
        getInsightsJobMock.mockResolvedValue({
            id: 'job-err',
            analysisData: { foo: 'bar' },
            systemId: 'sys-2',
            customPrompt: null
        });
        processInsightsInBackgroundMock.mockRejectedValue(new Error('boom'));

        const response = await handler({ body: JSON.stringify({ jobId: 'job-err' }) }, {});
        const payload = JSON.parse(response.body);

        expect(processInsightsInBackgroundMock).toHaveBeenCalledWith(
            'job-err',
            { foo: 'bar' },
            'sys-2',
            null,
            expect.anything()
        );
        expect(failJobMock).toHaveBeenCalledWith('job-err', 'boom', expect.anything());
        expect(payload.success).toBe(false);
        expect(payload.error).toBe('boom');
    });
});
