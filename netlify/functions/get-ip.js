const createLogger = (context) => (level, message, extra = {}) => {
    try {
        console.log(JSON.stringify({
            level: level.toUpperCase(),
            functionName: context?.functionName || 'get-ip',
            awsRequestId: context?.awsRequestId,
            message,
            ...extra
        }));
    } catch (e) {
        console.log(JSON.stringify({
            level: 'ERROR',
            functionName: context?.functionName || 'get-ip',
            awsRequestId: context?.awsRequestId,
            message: 'Failed to serialize log message.',
            originalMessage: message,
            serializationError: e.message,
        }));
    }
};

exports.handler = async function(event, context) {
  const log = createLogger(context);
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