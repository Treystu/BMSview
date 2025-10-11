const createLogger = (functionName, context) => (level, message, extra = {}) => {
    try {
        const logPayload = {
            level: level.toUpperCase(),
            functionName: context?.functionName || functionName,
            awsRequestId: context?.awsRequestId,
            message,
            ...extra
        };
        console.log(JSON.stringify(logPayload));
    } catch (e) {
      const fallbackLog = {
        level: 'ERROR',
        functionName: context?.functionName || 'analyze',
        awsRequestId: context?.awsRequestId,
        timestamp: new Date().toISOString(),
        message: 'Serialization failed - raw: ' + (typeof message === 'string' ? message : JSON.stringify(message)),
        originalExtra: extra,
        error: e.message,
        stack: e.stack
      };
      const fallbackStr = JSON.stringify(fallbackLog);
      console.error(fallbackStr);  // Force immediate flush
      console.log(fallbackStr);    // Standard
    }
};

module.exports = { createLogger };