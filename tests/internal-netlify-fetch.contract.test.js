const { internalFetchJson, resolveInternalUrl } = require('../netlify/functions/utils/internal-netlify-fetch.cjs');

describe('internal-netlify-fetch contract', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('resolveInternalUrl should prepend base URL for relative paths', () => {
        process.env.BMSVIEW_BASE_URL = 'http://example.com';
        expect(resolveInternalUrl('/.netlify/functions/weather')).toBe('http://example.com/.netlify/functions/weather');
    });

    test('internalFetchJson should throw when fetch is not available', async () => {
        await expect(internalFetchJson('/.netlify/functions/weather', { fetchImpl: null }, null)).rejects.toThrow(
            'Fetch is not available in this environment'
        );
    });

    test('internalFetchJson should return JSON on 200', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ ok: true }),
            text: async () => JSON.stringify({ ok: true })
        });

        const result = await internalFetchJson('http://example.com/test', { fetchImpl }, null);
        expect(result).toEqual({ ok: true });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('internalFetchJson should retry on 5xx and then succeed', async () => {
        const fetchImpl = jest
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                headers: { get: () => 'application/json' },
                json: async () => ({ error: 'service unavailable' }),
                text: async () => JSON.stringify({ error: 'service unavailable' })
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({ ok: true }),
                text: async () => JSON.stringify({ ok: true })
            });

        const result = await internalFetchJson('http://example.com/test', { fetchImpl, retries: 1, initialDelayMs: 1 }, null);
        expect(result).toEqual({ ok: true });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    test('internalFetchJson should not retry on 4xx', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: false,
            status: 400,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: 'bad request' }),
            text: async () => JSON.stringify({ error: 'bad request' })
        });

        await expect(
            internalFetchJson('http://example.com/test', { fetchImpl, retries: 2, initialDelayMs: 1 }, null)
        ).rejects.toThrow('bad request');

        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
