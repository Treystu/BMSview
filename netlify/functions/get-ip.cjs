// @ts-nocheck
const { createLoggerFromEvent } = require("./utils/logger.cjs");
const { createForwardingLogger } = require('./utils/log-forwarder.cjs');
const { createStandardEntryMeta } = require('./utils/handler-logging.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

exports.handler = async function (event, context) {exports.handler = async function (event, context) {
  const headers = getCorsHeaders(event);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('get-ip', event, context);

  // Unified logging: also forward to centralized collector
  const forwardLog = createForwardingLogger('get-ip');
  log.entry(createStandardEntryMeta(event));

  try {
    const ip = event.headers['x-nf-client-connection-ip'];

    log.debug('Getting client IP from headers');

    if (!ip) {
      log.error('Could not determine client IP address from headers');
      log.exit(500);
      return {
        statusCode: 500,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Could not determine client IP address.' }),
      };
    }

    log.info('Successfully determined client IP address', { ip });
    log.exit(200, { ip });
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip }),
    };
  } catch (error) {
    log.error('Error in get-ip function', {
      error: error.message,
      stack: error.stack
    });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

  const headers = getCorsHeaders(event);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('get-ip', event, context);
  log.entry(createStandardEntryMeta(event));

  try {
    const ip = event.headers['x-nf-client-connection-ip'];

    log.debug('Getting client IP from headers');

    if (!ip) {
      log.error('Could not determine client IP address from headers');
      log.exit(500);
      return {
        statusCode: 500,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Could not determine client IP address.' }),
      };
    }

    log.info('Successfully determined client IP address', { ip });
    log.exit(200, { ip });
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip }),
    };
  } catch (error) {
    log.error('Error in get-ip function', {
      error: error.message,
      stack: error.stack
    });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
