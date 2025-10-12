const createLogger = (functionName, context) => (level, message, extra = {}) => {
    try {
        const logPayload = {
            timestamp: new Date().toISOString(),
            level: level.toUpperCase(),
            functionName: context?.functionName || functionName,
            awsRequestId: context?.awsRequestId,
            message,
            ...extra
        };
        console.log(JSON.stringify(logPayload));
    } catch (e) {
      try {
        const fallbackLog = {
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            functionName: context?.functionName || functionName,
            awsRequestId: context?.awsRequestId,
            message: `Log serialization failed: ${e.message}`,
            originalMessage: message, // Keep original message
        };
        console.error(JSON.stringify(fallbackLog));
      } catch (finalError) {
        console.error(`{"timestamp":"${new Date().toISOString()}","level":"ERROR","functionName":"${functionName}","message":"CRITICAL: Failed to serialize log message and fallback log message."}`);
      }
    }
};

module.exports = { createLogger };
