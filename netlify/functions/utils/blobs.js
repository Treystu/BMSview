const { getStore } = require("@netlify/blobs");

// A centralized function to get a configured blob store.
// This code is correct, assuming Blobs is enabled in the Netlify UI.
const getConfiguredStore = (name, log) => {
    try {
        const siteId = process.env.NETLIFY_SITE_ID;
        const token = process.env.NETLIFY_API_TOKEN;

        log('info', 'Initializing blob store', { name, hasSiteId: !!siteId, hasToken: !!token });

        if (!siteId || !token) {
            // This error will now correctly fire if the re-deploy didn't work.
            const err = new Error("Blobs environment variables not found. Ensure Blobs is enabled in Netlify UI and the site has been re-deployed.");
            log('error', 'Blob store init failed', { name, error: err.message });
            throw err;
        }
        
        // The Netlify Blobs API requires the site ID property to be `siteId` (with a lowercase 'd').
        const storeOptions = {
            name: name,
            siteId: siteId,
            token: token,
        };

        // Use strong consistency for stores that need it.
        if (name === 'bms-jobs' || name === 'rate-limiting' || name === 'verified-ips' || name === 'bms-blocked-ips') {
            storeOptions.consistency = 'strong';
        }

        const store = getStore(storeOptions);
        log('info', 'Blob store ready', { name });
        return store;
    } catch (e) {
        log('error', 'Blob store init failed', { name, error: e.message, stack: e.stack });
        throw e;
    }
};

module.exports = { getConfiguredStore };