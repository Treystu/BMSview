// Test setup file for Jest
global.console = {
  ...console,
  // Suppress console.log in tests unless explicitly needed
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: console.warn,
  error: console.error,
};

// Mock environment variables
process.env.GEMINI_API_KEY = 'test-api-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

// Mock fetch for API tests
global.fetch = jest.fn();

// Setup and teardown hooks
beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  // Clean up any test-specific state
});