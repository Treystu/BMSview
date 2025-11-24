const { createLogger } = require("./utils/logger.cjs");

function validateEnvironment(log) {
  // No specific env vars required for this function, but good practice to have the hook.
  return true;
}

exports.handler = async function(event, context) {
  const log = createLogger('get-ip', context);
  
  if (!validateEnvironment(log)) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }
  
  try {
    log.entry({ method: event.httpMethod, path: event.path });
    
    const ip = event.headers['x-nf-client-connection-ip'];
    const logContext = { clientIp: ip };
    
    log.debug('Function invoked', { ...logContext, headers: event.headers });
    
    if (!ip) {
        log.error('Could not determine client IP address from headers', logContext);
        log.exit(500);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Could not determine client IP address.' }),
            headers: { 'Content-Type': 'application/json' },
        };
    }

    log.info('Successfully determined client IP address', logContext);
    log.exit(200, { ip });
    return {
      statusCode: 200,
      body: JSON.stringify({ ip }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (error) {
    log.error('Error in get-ip function', {
      error: error.message,
      stack: error.stack
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
