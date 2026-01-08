
const { handler } = require('../netlify/functions/ai-budget-settings.cjs');
const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');

jest.mock('../netlify/functions/utils/mongodb.cjs', () => {
    const mockDb = {
        collection: jest.fn(),
    };
    const mockCollection = {
        findOne: jest.fn(),
        updateOne: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
    };
    return {
        getCollection: jest.fn().mockResolvedValue(mockCollection),
        mockCollection 
    };
});

jest.mock('../netlify/functions/utils/logger.cjs', () => ({
    createLoggerFromEvent: () => ({
        entry: jest.fn(),
        exit: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        audit: jest.fn(),
    }),
    createTimer: () => ({
        end: jest.fn(),
    }),
}));

describe('AI Budget Settings - Alert Reset', () => {
    let mockCollection;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCollection = require('../netlify/functions/utils/mongodb.cjs').mockCollection;
    });

    it('should handle DELETE request to reset alerts', async () => {
        mockCollection.deleteMany.mockResolvedValue({ deletedCount: 5 });
        mockCollection.updateMany.mockResolvedValue({ modifiedCount: 3 });

        const event = {
            httpMethod: 'DELETE',
            path: '/ai-budget-settings',
            headers: {}
        };

        const response = await handler(event, {});

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.message).toBe('Budget alerts reset successfully');
        expect(body.details.deletedBudgetAlerts).toBe(5);
        expect(body.details.resolvedAnomalyAlerts).toBe(3);

        expect(getCollection).toHaveBeenCalledWith('budget_alerts');
        expect(getCollection).toHaveBeenCalledWith('anomaly_alerts');
        expect(mockCollection.deleteMany).toHaveBeenCalled();
        expect(mockCollection.updateMany).toHaveBeenCalled();
    });

    it('should reject non-DELETE/GET/POST methods', async () => {
        const event = {
            httpMethod: 'PUT',
            path: '/ai-budget-settings',
            headers: {}
        };

        const response = await handler(event, {});
        expect(response.statusCode).toBe(405);
    });
});
