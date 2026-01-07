// @ts-nocheck
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

  test('getRegisteredSystems passes through total', async () => {
    const apiResponse = { items: [{ id: 's1' }], total: 1 };
    mockApiFetch.mockResolvedValueOnce(apiResponse);

    const promise = clientService.getRegisteredSystems(1, 10);
    jest.runAllTimers();
    const res = await promise;

    expect(res).toHaveProperty('items');
    expect(res).toHaveProperty('total');
    expect(res.total).toBe(1);
    expect(mockApiFetch).toHaveBeenCalledWith('systems?page=1&limit=10');
  });

  test('handles empty result sets', async () => {
    const apiResponse = { items: [], total: 0 };
    mockApiFetch.mockResolvedValueOnce(apiResponse);

    const promise = clientService.getRegisteredSystems(1, 10);
    jest.runAllTimers();
    const res = await promise;

    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
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
      // Test case 1: Empty items array with explicit total
      {
        response: { items: [], total: 5 },
        expected: { items: [], total: 5 }
      },
      // Test case 2: Plain array response
      {
        response: [1, 2, 3],
        expected: { items: [1, 2, 3], total: 3 }
      },
      // Test case 3: Empty array
      {
        response: [],
        expected: { items: [], total: 0 }
      }
    ];

    for (const tc of testCases) {
      // Reset mock and clear cache for each test case
      mockApiFetch.mockReset();
      clientService.__internals.clearCache();
      mockApiFetch.mockResolvedValueOnce(tc.response);

      const promise = clientService.getRegisteredSystems(1, 10);
      jest.runAllTimers();
      const res = await promise;

      // Debug test case on failure
      if (JSON.stringify(res) !== JSON.stringify(tc.expected)) {
        console.log('Failed test case:', {
          response: tc.response,
          expected: tc.expected,
          received: res
        });
      }

      expect(res).toEqual(tc.expected);
      expect(mockApiFetch).toHaveBeenCalledWith('systems?page=1&limit=10');
    }
  });
});
