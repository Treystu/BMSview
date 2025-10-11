const { getConfiguredStore } = require('./utils/blobs');
const { createLogger } = require("./utils/logger");

const STORE_NAME = "bms-jobs";

exports.handler = async (event, context) => {
    const log = createLogger('job-status', context);

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { batchId } = event.queryStringParameters;

    if (!batchId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'batchId is required' }) };
    }

    try {
        const store = getConfiguredStore(STORE_NAME, log);
        log.info('Fetching status for batch', { batchId });
        const batchData = await store.get(batchId, { type: 'json' });

        if (!batchData) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Batch not found' }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(batchData),
        };
    } catch (error) {
        if (error.status === 404) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Batch not found' }) };
        }
        log.error('Error fetching batch status', { batchId, error: error.message, stack: error.stack });
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
    }
};