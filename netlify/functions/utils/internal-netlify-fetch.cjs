const { createLogger } = require('./logger.cjs');

function resolveSiteBaseUrl() {
    const url =
        process.env.BMSVIEW_BASE_URL ||
        process.env.URL ||
        process.env.DEPLOY_PRIME_URL ||
        process.env.DEPLOY_URL ||
        process.env.SITE_URL ||
        'http://localhost:8888';

    return String(url).replace(/\/$/, '');
}

function resolveInternalUrl(pathOrUrl) {
    if (typeof pathOrUrl !== 'string' || pathOrUrl.length === 0) {
        throw new Error('Internal URL path is required');
    }

    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

    const baseUrl = resolveSiteBaseUrl();
    const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    return `${baseUrl}${normalizedPath}`;
}

async function internalFetchJson(pathOrUrl, options = {}, log = null) {
    const logger = log || createLogger('internal-netlify-fetch');
    const url = resolveInternalUrl(pathOrUrl);

    const {
        method = 'GET',
        headers = {},
        body,
        fetchImpl,
        retries = 2,
        initialDelayMs = 250,
        retryOnStatuses = [500, 502, 503, 504]
    } = options;

    const fetchFn = fetchImpl || global.fetch;
    if (typeof fetchFn !== 'function') {
        throw new Error('Fetch is not available in this environment');
    }

    const finalHeaders = { ...headers };
    if (body != null && !('Content-Type' in finalHeaders) && !('content-type' in finalHeaders)) {
        finalHeaders['Content-Type'] = 'application/json';
    }

    const attemptOnce = async (attempt) => {
        logger.debug('Internal fetch', { url, method, attempt });

        const response = await fetchFn(url, { method, headers: finalHeaders, body });

        const contentType = response.headers?.get?.('content-type') || '';
        const isJson = contentType.includes('application/json');

        const parseBody = async () => {
            if (isJson) return response.json();
            const text = await response.text();
            try {
                return JSON.parse(text);
            } catch {
                return { error: text };
            }
        };

        if (response.ok) {
            return parseBody();
        }

        const errBody = await parseBody();
        const errMessage =
            (errBody && typeof errBody === 'object' && 'error' in errBody && typeof errBody.error === 'string'
                ? errBody.error
                : `Internal fetch failed with status ${response.status}`);

        const error = new Error(errMessage);
        error.statusCode = response.status;
        error.response = errBody;
        throw error;
    };

    for (let i = 0; i <= retries; i += 1) {
        const attempt = i + 1;
        try {
            return await attemptOnce(attempt);
        } catch (err) {
            const statusCode = err && typeof err === 'object' ? err.statusCode : undefined;
            const shouldRetry =
                i < retries &&
                (statusCode == null || retryOnStatuses.includes(Number(statusCode)));

            if (!shouldRetry) throw err;

            const delay = initialDelayMs * Math.pow(2, i);
            logger.warn('Internal fetch retrying', { url, method, attempt, delayMs: delay, statusCode });
            await new Promise((r) => setTimeout(r, delay));
        }
    }

    throw new Error('Internal fetch failed');
}

module.exports = {
    resolveSiteBaseUrl,
    resolveInternalUrl,
    internalFetchJson
};
