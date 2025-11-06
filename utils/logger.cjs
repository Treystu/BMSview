function createLogger(functionName, context = {}) {
  return {
    debug: (message, data = {}) => {
      // Only log debug messages if LOG_LEVEL is DEBUG
      const logLevel = process.env.LOG_LEVEL || 'INFO';
      if (logLevel === 'DEBUG') {
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'DEBUG',
          function: functionName,
          requestId: context.awsRequestId || 'unknown',
          elapsed: data.elapsed || '0ms',
          message,
          ...data,
          context
        }));
      }
    },
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