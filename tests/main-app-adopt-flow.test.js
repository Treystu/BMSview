// @ts-nocheck
const clientService = require('../services/clientService');

describe('Main app adopt/link API wiring', () => {
    let mockApiFetch;

    beforeAll(() => {
        mockApiFetch = jest.fn().mockResolvedValue({ success: true });
        clientService.__internals.setApiFetch(mockApiFetch);
    });

    afterAll(() => {
        clientService.__internals.resetApiFetch();
    });

    beforeEach(() => {
        mockApiFetch.mockClear();
        clientService.__internals.clearCache();
    });

    test('linkAnalysisToSystem uses PUT /history (dlNumber)', async () => {
        await clientService.linkAnalysisToSystem('record-1', 'system-1', 'DL-4018');

        expect(mockApiFetch).toHaveBeenCalledTimes(1);
        expect(mockApiFetch).toHaveBeenCalledWith('history', {
            method: 'PUT',
            body: JSON.stringify({
                recordId: 'record-1',
                systemId: 'system-1',
                dlNumber: 'DL-4018'
            })
        });
    });
});
