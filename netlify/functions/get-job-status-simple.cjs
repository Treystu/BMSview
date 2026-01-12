"use strict";

const { getCorsHeaders } = require('./utils/cors.cjs');
const { errorResponse } = require('./utils/errors.cjs');
const { createForwardingLogger } = require('./utils/log-forwarder.cjs');

exports.handler = async (event, context) => {
    const corsHeaders = getCorsHeaders(event);
    const headers = {
        ...corsHeaders,
        'Content-Type': 'application/json'
    };

    // Unified logging: also forward to centralized collector
    const forwardLog = createForwardingLogger('get-job-status-simple');

    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ message: 'CORS preflight' })
            };
        }

        if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
            return {
                statusCode: 405,
                headers,
                body: JSON.stringify({ error: 'Method not allowed' })
            };
        }

        // For now, return empty results
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                jobs: [],
                count: 0,
                message: 'Job status endpoint is working (minimal version)'
            })
        };
    } catch (error) {
        return errorResponse(500, 'internal_error', 'Failed to get job status', { message: error.message }, headers);
    }
};
