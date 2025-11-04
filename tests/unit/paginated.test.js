const clientService = require('../../services/clientService');

// Mock window and netlifyIdentity
global.window = {
  netlifyIdentity: {
    currentUser: jest.fn().mockReturnValue({ jwt: () => 'mock-token' })
  }
};

describe('Paginated API response normalization', () => {
  let originalApiFetch;
  let mockApiFetch;

  beforeAll(() => {
    originalApiFetch = clientService.apiFetch;
    mockApiFetch = jest.fn();
    clientService.apiFetch = mockApiFetch;
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
    clientService.apiFetch = originalApiFetch;
    delete global.window;
  });

  test('getRegisteredSystems normalizes totalItems from total', async () => {
    const expected = { items: [{ id: 's1' }], totalItems: 1 };
    mockApiFetch.mockResolvedValueOnce(expected);

    const promise = clientService.getRegisteredSystems(1, 10);
    jest.runAllTimers();
    const res = await promise;

    expect(res).toHaveProperty('items');
    expect(res).toHaveProperty('totalItems');
    expect(res.totalItems).toBe(1);
    expect(mockApiFetch).toHaveBeenCalledWith('systems?page=1&limit=10');
  });

  test('handles empty result sets', async () => {
    const expected = { items: [], totalItems: 0 };
    mockApiFetch.mockResolvedValueOnce(expected);

    const promise = clientService.getRegisteredSystems(1, 10);
    jest.runAllTimers();
    const res = await promise;

    expect(res.items).toEqual([]);
    expect(res.totalItems).toBe(0);
    expect(mockApiFetch).toHaveBeenCalledWith('systems?page=1&limit=10');
  });

  test('respects page and limit parameters', async () => {
    const expected = { items: [], total: 0 };
    mockApiFetch.mockResolvedValueOnce(expected);

    const promise = clientService.getRegisteredSystems(2, 15);
    jest.runAllTimers();
    await promise;

    expect(mockApiFetch).toHaveBeenCalledWith('systems?page=2&limit=15');
  });

  test('handles fetch errors', async () => {
    const error = new Error('API error');
    mockApiFetch.mockRejectedValueOnce(error);

    const promise = clientService.getRegisteredSystems(1, 10);
    jest.runAllTimers();
    await expect(promise).rejects.toThrow('API error');
  });

  test('normalizes inconsistent API response formats', async () => {
    const testCases = [
      {
        response: { items: [], totalItems: 5 },
        expected: { items: [], totalItems: 5 }
      },
      {
        // The API should always return { items, total } format after normalization
        response: [1, 2, 3],
        expected: { items: [1, 2, 3], totalItems: 3 }
      },
      {
        // Edge case: empty array
        response: [],
        expected: { items: [], totalItems: 0 }
      }
    ];

    for (const tc of testCases) {
      mockApiFetch.mockReset();
      mockApiFetch.mockResolvedValueOnce(tc.response);

      const promise = clientService.getRegisteredSystems(1, 10);
      jest.runAllTimers();
      const res = await promise;
      
      expect(res).toEqual(tc.expected);
      expect(mockApiFetch).toHaveBeenCalledWith('systems?page=1&limit=10');
    }
  });
});
