const clientService = require('../../../services/clientService');

describe('Paginated normalization', () => {
  test('getRegisteredSystems normalizes totalItems from total', async () => {
    const apiFetchSpy = jest.spyOn(clientService, 'apiFetch').mockImplementation(async () => ({ items: [{ id: 's1' }], total: 1 }));

    const res = await clientService.getRegisteredSystems(1, 10);
    expect(res).toHaveProperty('items');
    expect(res).toHaveProperty('totalItems');
    expect(res.totalItems).toBe(1);

    apiFetchSpy.mockRestore();
  });
});
