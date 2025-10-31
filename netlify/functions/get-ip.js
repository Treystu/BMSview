const { createLogger } = require("./utils/logger.js");

exports.handler = async function(event, context) {
  const log = createLogger('get-ip', context);
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
};
