"use strict";

const { getCorsHeaders } = require('./utils/cors.cjs');
const { errorResponse } = require('./utils/errors.cjs');

exports.handler = async (event, context) => {
    const corsHeaders = getCorsHeaders(event);
    const headers = {
        ...corsHeaders,
        'Content-Type': 'application/json'
    };

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
