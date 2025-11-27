const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    // In a real app, this would send to a logging service
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        component: 'telemetry',
        message,
        context
    }));
};

export const telemetry = {
    log,
};