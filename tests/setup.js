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

// Mock Gemini API
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
global.fetch = jest.fn(() => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({ success: true })
}));

// Global test hooks
beforeEach(() => {
  jest.clearAllMocks();
  // Reset fetch mock
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