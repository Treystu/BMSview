/**
 * Centralized definition of MongoDB collection names.
 * PREVENTS: Magic strings and usage of deprecated collections (like 'records').
 */
const COLLECTIONS = {
    HISTORY: 'history',
    SYSTEMS: 'systems',
    FILES: 'files',
    ANALYSIS_RESULTS: 'analysis-results',
    SYSTEM_ANALYTICS: 'system-analytics',
    SYSTEM_ADOPTION_LOG: 'system-adoption-log',
    HOURLY_WEATHER: 'hourly-weather',
    HOURLY_SOLAR_IRRADIANCE: 'hourly-solar-irradiance',
    PENDING_JOBS: 'pending-jobs',
    SYNC_METADATA: 'sync-metadata',
    DELETED_RECORDS: 'deleted-records',
    UPLOADS: 'uploads',
    MEASUREMENTS: 'measurements', // Used in upload key flow
    IDEMPOTENT_REQUESTS: 'idempotent-requests',
    PROGRESS_EVENTS: 'progress-events',
    LOGS: 'logs', // Unified log collection

    // Explicitely Deprecated - DO NOT USE
    // RECORDS: 'records', 
};

module.exports = { COLLECTIONS };
