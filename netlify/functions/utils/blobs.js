const { getStore } = require("@netlify/blobs");

/**
 * A centralized function to get a configured blob store.
 * Implements a hybrid approach ("Option H") with extensive diagnostic logging.
 * 1. Tries automatic environment configuration first.
 * 2. If automatic configuration fails, it falls back to an explicit configuration,
 *    logging every step to diagnose the persistent initialization error.
 */
const getConfiguredStore = (name, log) => {
    const storeOptions = {};
    
    if (['bms-jobs', 'rate-limiting', 'verified-ips', 'bms-blocked-ips'].includes(name)) {
        storeOptions.consistency = 'strong';
        log('debug', `Requesting 'strong' consistency for store '${name}'.`);
    }

    try {
        log('info', `Initializing blob store '${name}' using automatic configuration.`);
        const store = getStore(name, storeOptions);
        log('info', `Blob store '${name}' initialized successfully via automatic configuration.`);
        return store;
    } catch (error) {
        if (error.name === 'MissingBlobsEnvironmentError' || (error.message && error.message.includes('The environment has not been configured'))) {
            log('warn', `Automatic blob store init failed for '${name}'. Falling back to explicit configuration.`, { autoConfigErrorName: error.name, autoConfigErrorMessage: error.message });

            // --- START: SUPER DETAILED DEBUG LOGGING ---
            log('debug', '--- STARTING DETAILED FALLBACK DEBUGGING ---');
            
            // 1. Check all available environment variables
            const envKeys = Object.keys(process.env);
            log('debug', 'Available environment variable keys.', { keyCount: envKeys.length, keys: envKeys });

            const expectedVars = ['BMS_APP_NETLIFY_SITE_ID', 'BMS_APP_NETLIFY_PAT', 'NETLIFY_SITE_ID', 'NETLIFY_API_TOKEN'];
            const foundVars = {};
            expectedVars.forEach(v => {
                foundVars[v] = process.env[v] ? 'found' : 'NOT_FOUND';
            });
            log('debug', 'Checking for expected Netlify Blob env vars.', { status: foundVars });

            // 2. Read the specific variables we intend to use
            const siteId = process.env.BMS_APP_NETLIFY_SITE_ID;
            const token = process.env.BMS_APP_NETLIFY_PAT;
            
            // 3. Log details about these variables
            log('debug', 'Read fallback variables from process.env.', {
                siteId_value: siteId ? `(set, ends with: ...${siteId.slice(-6)})` : `(not set or empty)`,
                siteId_type: typeof siteId,
                token_length: token ? token.length : 0,
                token_type: typeof token,
            });

            if (!siteId || !token) {
                const errorMessage = `CRITICAL: Fallback variables (BMS_APP_NETLIFY_SITE_ID, BMS_APP_NETLIFY_PAT) are missing or empty. Cannot initialize blob store.`;
                log('error', errorMessage);
                throw new Error(errorMessage); // Throw a more specific error
            }

            // 4. Construct and log the options object
            const explicitStoreOptions = {
                ...storeOptions,
                siteId: siteId, // CRITICAL FIX: Use camelCase `siteId`
                token: token,
            };
            log('debug', `Constructed explicit options for getStore.`, {
                options: {
                    consistency: explicitStoreOptions.consistency,
                    siteId: explicitStoreOptions.siteId,
                    token: token ? `(set, length: ${token.length})` : '(not set)',
                },
            });
            // --- END: SUPER DETAILED DEBUG LOGGING ---

            try {
                log('info', `Initializing blob store '${name}' using explicit fallback configuration.`);
                const store = getStore(name, explicitStoreOptions);
                log('info', `Blob store '${name}' initialized successfully via explicit fallback.`);
                return store;
            } catch (fallbackError) {
                // --- START: DETAILED FALLBACK ERROR LOGGING ---
                log('error', `Explicit fallback blob store init FAILED for '${name}'. This is a critical configuration error.`, {
                    fallbackErrorName: fallbackError.name,
                    fallbackErrorMessage: fallbackError.message,
                    fallbackErrorStack: fallbackError.stack,
                    // Log all enumerable properties of the error object
                    fullErrorObject: JSON.stringify(fallbackError, Object.getOwnPropertyNames(fallbackError)),
                });
                // --- END: DETAILED FALLBACK ERROR LOGGING ---
                throw fallbackError;
            }
        } else {
            log('error', `An unexpected error occurred during blob store initialization for '${name}'.`, { errorName: error.name, errorMessage: error.message, errorStack: error.stack });
            throw error;
        }
    }
};

module.exports = { getConfiguredStore };