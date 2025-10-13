const { getStore } = require("@netlify/blobs");

/**
 * A centralized function to get a configured blob store.
 * Implements a robust, multi-layered fallback strategy with extensive diagnostic logging
 * to handle inconsistencies in blob store initialization.
 * 1. Tries automatic environment configuration first.
 * 2. If automatic fails, it falls back to an explicit configuration.
 * 3. In explicit mode, it tries a different calling convention for `getStore` by passing a single 
 *    configuration object, which is more robust against argument parsing issues.
 * 4. It still attempts multiple key variations ('siteID' and 'siteId') within this new strategy.
 */
const getConfiguredStore = (name, log) => {
    const storeOptions = {};
    
    // Some stores benefit from strong consistency for read-after-write scenarios.
    if (['bms-jobs', 'rate-limiting', 'verified-ips', 'bms-blocked-ips'].includes(name)) {
        storeOptions.consistency = 'strong';
        log('debug', `Requesting 'strong' consistency for store '${name}'.`);
    }

    // --- Primary attempt: Automatic configuration ---
    try {
        log('info', `Initializing blob store '${name}' using automatic configuration.`);
        const store = getStore(name, storeOptions);
        log('info', `[SUCCESS] Blob store '${name}' initialized successfully via automatic configuration.`);
        return store;
    } catch (error) {
        if (error.name === 'MissingBlobsEnvironmentError' || (error.message && error.message.includes('The environment has not been configured'))) {
            log('warn', `Automatic config failed for '${name}'. Falling back to explicit config.`, { errorName: error.name });
            
            // --- Fallback Mechanism: Read variables and try single-object config ---
            const siteId = process.env.NETLIFY_SITE_ID || process.env.BMS_APP_NETLIFY_SITE_ID;
            const token = process.env.NETLIFY_API_TOKEN || process.env.BMS_APP_NETLIFY_PAT;
            
            log('debug', '--- STARTING NEW SINGLE-OBJECT FALLBACK STRATEGY ---');
            log('debug', 'Read variables for fallback.', {
                hasSiteId: !!siteId,
                hasToken: !!token,
                siteId_val: siteId ? `(set, ends with: ...${siteId.slice(-6)})` : `(not set)`,
            });

            if (!siteId || !token) {
                const errorMessage = `CRITICAL: Fallback environment variables (NETLIFY_SITE_ID/NETLIFY_API_TOKEN) are missing. Cannot initialize blob store.`;
                log('error', errorMessage);
                throw new Error(errorMessage);
            }
            
            // --- Fallback Attempt 1: Single options object with 'siteID' (camelCase D) ---
            try {
                const options = { name, ...storeOptions, siteID: siteId, token: token };
                log('info', `[Fallback 1/2] Trying single config object with 'siteID'.`, { options: { name, siteID: '...', token: '...' } });
                const store = getStore(options);
                log('info', `[SUCCESS] Blob store '${name}' initialized with single config object ('siteID').`);
                return store;
            } catch (e1) {
                log('warn', `[Fallback 1/2] Failed with single config object ('siteID').`, { errorName: e1.name, errorMessage: e1.message });
            }

            // --- Fallback Attempt 2: Single options object with 'siteId' (lowercase d) ---
            try {
                const options = { name, ...storeOptions, siteId: siteId, token: token };
                log('info', `[Fallback 2/2] Trying single config object with 'siteId'.`, { options: { name, siteId: '...', token: '...' } });
                const store = getStore(options);
                log('info', `[SUCCESS] Blob store '${name}' initialized with single config object ('siteId').`);
                return store;
            } catch (e2) {
                log('error', `[Fallback 2/2] All fallback attempts failed for '${name}'. This is a critical configuration error.`, {
                    finalErrorName: e2.name,
                    finalErrorMessage: e2.message,
                });
                throw e2; // Throw the last error
            }
        } else {
            log('error', `An unexpected, non-configuration error occurred during blob store initialization for '${name}'.`, { errorName: error.name, errorMessage: error.message, errorStack: error.stack });
            throw error;
        }
    }
};

module.exports = { getConfiguredStore };
