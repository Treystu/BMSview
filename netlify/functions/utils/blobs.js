const { getStore } = require("@netlify/blobs");

// A centralized function to get a configured blob store.
// This ensures all functions use the same explicit configuration,
// avoiding potential issues with Netlify's automatic context detection.
const getConfiguredStore = (name, log) => {
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_API_TOKEN;

    if (!siteID || !token) {
        log('error', "Function is not configured with required Netlify environment variables (NETLIFY_SITE_ID, NETLIFY_API_TOKEN). Please check project settings.");
        throw new Error("Missing required Netlify environment variables for blob store access.");
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

    return getStore(storeOptions);
};

module.exports = { getConfiguredStore };