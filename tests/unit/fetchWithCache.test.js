const clientService = require('../../../services/clientService');

describe('fetchWithCache', () => {
  test('dedupes concurrent requests and caches results', async () => {
    const resp = { items: [{ id: 1 }], total: 1 };
    const apiFetchSpy = jest.spyOn(clientService, 'apiFetch').mockImplementation(async () => resp);

    const [a, b] = await Promise.all([
      clientService.__internals.fetchWithCache('test-endpoint', 10000),
      clientService.__internals.fetchWithCache('test-endpoint', 10000),
    ]);

    expect(a).toEqual(resp);
    expect(b).toEqual(resp);
    expect(apiFetchSpy).toHaveBeenCalledTimes(1);

    apiFetchSpy.mockRestore();
  });
});
