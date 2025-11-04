function createLogger(functionName, context = {}) {
  return {
    info: (message, data = {}) => {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        function: functionName,
        requestId: context.awsRequestId || 'unknown',
        elapsed: data.elapsed || '0ms',
        message,
        ...data,
        context
      }));
    },
    warn: (message, data = {}) => {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'WARN',
        function: functionName,
        requestId: context.awsRequestId || 'unknown',
        elapsed: data.elapsed || '0ms',
        message,
        ...data,
        context
      }));
    },
    error: (message, data = {}) => {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        function: functionName,
        requestId: context.awsRequestId || 'unknown',
        elapsed: data.elapsed || '0ms',
        message,
        ...data,
        context
      }));
    }
  };
}

function createTimer(log, name) {
  const start = Date.now();
  return {
    end: () => {
      const duration = Date.now() - start;
      log.info(`${name} completed`, {
        duration: `${duration}ms`
      });
      return duration;
    }
  };
}

module.exports = {
  createLogger,
  createTimer
};