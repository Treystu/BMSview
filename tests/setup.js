// Test setup file for Jest
jest.setTimeout(30000); // Increase timeout for comprehensive tests

// Mock console for cleaner test output
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(), // Changed to mock for cleaner output
  error: jest.fn(), // Changed to mock for cleaner output
};

// Mock environment variables
process.env.GEMINI_API_KEY = 'test-api-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

// Mock MongoDB client so tests don't require a real server
jest.mock('mongodb', () => {
  const { mockMongoDB } = require('./mocks/mongodb.mock');
  class MockMongoClient {
    constructor(uri) { this.uri = uri; }
    async connect() { return mockMongoDB.client.connect(); }
    db(name) { return mockMongoDB.client.db(name); }
    async close() { return Promise.resolve(); }
  }
  return { MongoClient: MockMongoClient };
});

// Mock Gemini API (mocking gemini-2.5-flash model)
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            healthStatus: 'Good',
            performance: {
              trend: 'stable',
              capacityRetention: 95,
              degradationRate: 0.01
            },
            recommendations: ['Routine monitoring recommended'],
            confidence: 'high'
          })
        }
      })
    })
  }))
}));

// Mock fetch for API tests
const mockFetch = jest.fn((url, options) => {
  if (typeof url === 'string' && url.includes('/.netlify/functions/upload')) {
    global.__uploadCallCount = (global.__uploadCallCount || 0) + 1;
    const isDuplicate = global.__uploadCallCount % 2 === 0;
    return Promise.resolve({
      ok: !isDuplicate,
      status: isDuplicate ? 409 : 200,
      json: () => Promise.resolve({ success: !isDuplicate, reason: isDuplicate ? 'duplicate' : undefined })
    });
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true })
  });
});

global.fetch = mockFetch;

// Global test hooks
beforeEach(() => {
  jest.clearAllMocks();
  // Reset fetch mock
  global.__uploadCallCount = 0;
  global.fetch.mockClear();
  // Reset console mocks
  Object.keys(global.console).forEach(key => {
    if (typeof global.console[key] === 'function' && global.console[key].mockClear) {
      global.console[key].mockClear();
    }
  });
});

afterEach(() => {
  // Only verify console.error in tests that explicitly check for it
  // Some tests intentionally trigger errors (e.g., error handling tests)
  // So we don't globally assert on console.error
});