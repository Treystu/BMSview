const createRetryWrapper = (log) => async (fn, maxRetries = 3, initialDelay = 250) => {
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            // Retry on 401 (auth issue), 429 (rate limit), 5xx server errors, or generic TypeError (network issue)
            const isRetryable = (error instanceof TypeError) || 
                                (error.status && error.status >= 500) ||
                                (error.status === 401) ||
                                (error.status === 429) ||
                                (error.message && (error.message.includes('401') || error.message.includes('429') || error.message.includes('502')));
                                
            if (isRetryable && i < maxRetries) {
                const delay = initialDelay * Math.pow(2, i) + Math.random() * initialDelay;
                log('warn', `A retryable blob store operation failed. Retrying...`, { attempt: i + 1, error: error.message });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
};

module.exports = { createRetryWrapper };
