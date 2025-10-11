const { createLogger } = require("./utils/logger.js");

exports.handler = async function(event, context) {
  const log = createLogger('get-ip', context);
  const ip = event.headers['x-nf-client-connection-ip'];
  log('info', 'Function invoked.', { clientIp: ip });
  
  if (!ip) {
      log('error', 'Could not determine client IP address.');
      return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Could not determine client IP address.' }),
          headers: { 'Content-Type': 'application/json' },
      };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ip }),
    headers: { 'Content-Type': 'application/json' },
  };
};