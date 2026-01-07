const clientService = require('../../src/services/clientService');

// Mock window and netlifyIdentity
global.window = {
  netlifyIdentity: {
    currentUser: jest.fn().mockReturnValue({ jwt: () => 'mock-token' })
  }
};

describe('fetchWithCache', () => {
  let originalApiFetch;
  let mockApiFetch;

  beforeAll(() => {
    originalApiFetch = clientService.apiFetch;
    mockApiFetch = jest.fn();
    clientService.__internals.setApiFetch(mockApiFetch);
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockApiFetch.mockClear();
    clientService.__internals.clearCache();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterAll(() => {
    clientService.__internals.setApiFetch(originalApiFetch);
    delete global.window;
  });

  test('dedupes concurrent requests and caches results', async () => {
    const resp = { items: [{ id: 1 }], totalItems: 1 };
    mockApiFetch.mockResolvedValueOnce(resp);

    const promises = [
      clientService.__internals.fetchWithCache('test-endpoint', 10000),
      clientService.__internals.fetchWithCache('test-endpoint', 10000)
    ];
    jest.runAllTimers();
    const [a, b] = await Promise.all(promises);

    const expected = { items: [{ id: 1 }], totalItems: 1 };
    expect(a).toEqual(expected);
    expect(b).toEqual(expected);
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith('test-endpoint');
  });

  test('caches until ttl expires', async () => {
    const resp1 = { items: [{ id: 1 }], totalItems: 1 };
    const resp2 = { items: [{ id: 2 }], totalItems: 1 };

    mockApiFetch
      .mockResolvedValueOnce(resp1)
      .mockResolvedValueOnce(resp2);

    const ttl = 100; // Short TTL for testing

    // First request
    const promise1 = clientService.__internals.fetchWithCache('test-endpoint', ttl);
    jest.runAllTimers();
    const result1 = await promise1;
    expect(result1).toEqual(resp1);
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    // Second request within TTL window
    const promise2 = clientService.__internals.fetchWithCache('test-endpoint', ttl);
    jest.runAllTimers();
    const result2 = await promise2;
    expect(result2).toEqual(resp1);
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    // Advance past TTL
    jest.advanceTimersByTime(ttl + 10);

    // Third request after TTL expired
    const promise3 = clientService.__internals.fetchWithCache('test-endpoint', ttl);
    jest.runAllTimers();
    const result3 = await promise3;
    expect(result3).toEqual(resp2);
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  test('handles fetch errors', async () => {
    const error = new Error('Network error');
    mockApiFetch.mockRejectedValue(error);

    const promise = clientService.__internals.fetchWithCache('test-endpoint', 10000);
    jest.runAllTimers();
    await expect(promise).rejects.toThrow('Network error');
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  test('different endpoints use separate caches', async () => {
    const resp1 = { items: [{ id: 1 }], totalItems: 1 };
    const resp2 = { items: [{ id: 2 }], totalItems: 1 };

    mockApiFetch
      .mockResolvedValueOnce(resp1)
      .mockResolvedValueOnce(resp2);

    const promise1 = clientService.__internals.fetchWithCache('endpoint1', 10000);
    jest.runAllTimers();
    const promise2 = clientService.__internals.fetchWithCache('endpoint2', 10000);
    jest.runAllTimers();

    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(result1).toEqual(resp1);
    expect(result2).toEqual(resp2);
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(mockApiFetch).toHaveBeenNthCalledWith(1, 'endpoint1');
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, 'endpoint2');
  });
});
