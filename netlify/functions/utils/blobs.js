const { getBlobStore } = require("@netlify/blobs");

// A centralized function to get a configured blob store.
// This ensures all functions use the same explicit configuration,
// avoiding potential issues with Netlify's automatic context detection.
const getConfiguredStore = (name, log) => {
    try {
        log('info', 'Initializing blob store', { name, hasSiteId: !!process.env.NETLIFY_SITE_ID, hasToken: !!process.env.NETLIFY_API_TOKEN });
        const siteID = process.env.NETLIFY_SITE_ID;
        const token = process.env.NETLIFY_API_TOKEN;

        if (!siteID || !token) {
            const err = new Error("Missing NETLIFY_SITE_ID or NETLIFY_API_TOKEN env vars. Please check project settings.");
            log('error', 'Blob store init failed', { name, error: err.message });
            throw err;
        }
        
        const storeOptions = {
            name,
            siteID,
            token,
        };

        // Use strong consistency for stores that need it to prevent race conditions
        // or for security-sensitive data that must be immediately consistent.
        if (name === 'bms-jobs' || name === 'rate-limiting' || name === 'verified-ips' || name === 'bms-blocked-ips') {
            storeOptions.consistency = 'strong';
        }

        const store = getBlobStore(storeOptions);
        log('info', 'Blob store ready', { name });
        return store;
    } catch (e) {
        log('error', 'Blob store init failed', { name, error: e.message, stack: e.stack });
        throw e;
    }
};

module.exports = { getConfiguredStore };