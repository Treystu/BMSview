const { getStore } = require("@netlify/blobs");

// A centralized function to get a configured blob store.
const getConfiguredStore = (name, log) => {
    try {
        const siteId = process.env.NETLIFY_SITE_ID;
        const token = process.env.NETLIFY_API_TOKEN;

        log('info', 'Initializing blob store', { name, hasSiteId: !!siteId, hasToken: !!token });

        if (!siteId || !token) {
            const err = new Error("Blobs environment variables not found. Ensure Blobs is enabled in Netlify UI and the site has been re-deployed.");
            log('error', 'Blob store init failed', { name, error: err.message });
            throw err;
        }
        
        const storeOptions = {
            siteID: siteId, // As requested by the error message
            siteId: siteId, // As a fallback for any potential library inconsistencies
            token: token,
        };

        // Use strong consistency for stores that need it.
        if (name === 'bms-jobs' || name === 'rate-limiting' || name === 'verified-ips' || name === 'bms-blocked-ips') {
            storeOptions.consistency = 'strong';
        }

        const store = getStore(name, storeOptions);
        log('info', 'Blob store ready', { name });
        return store;
    } catch (e) {
        log('error', 'Blob store init failed', { name, error: e.message, stack: e.stack });
        throw e;
    }
};

module.exports = { getConfiguredStore };