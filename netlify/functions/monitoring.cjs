const { createLogger } = require('./utils/logger.cjs');

exports.handler = async (event, context) => {
  const log = createLogger('monitoring', context);
  log.info('Monitoring endpoint called');

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Monitoring endpoint is active' })
  };
};