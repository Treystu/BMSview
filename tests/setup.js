// Test setup file for Jest
jest.setTimeout(60000); // Increased timeout for real API calls (when enabled)

// Mock console for cleaner test output
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Check if integration tests should use real services
// Set USE_REAL_SERVICES=true to run integration tests with real Gemini API and MongoDB
const useRealServices = process.env.USE_REAL_SERVICES === 'true';

if (useRealServices) {
  console.log('\n⚙️  Running tests with REAL services (Gemini API + MongoDB)');
  console.log('   Set USE_REAL_SERVICES=false to use mocks for faster unit tests\n');
  
  // Validate required environment variables for real services
  const requiredEnvVars = ['GEMINI_API_KEY', 'MONGODB_URI'];
  const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingEnvVars.length > 0) {
    console.error('\n❌ ERROR: Missing required environment variables for integration tests:');
    missingEnvVars.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('\nEither set these variables or run unit tests with USE_REAL_SERVICES=false\n');
    process.exit(1);
  }
  
  // Set test environment
  process.env.NODE_ENV = 'test';
  
  // Use test database name to avoid polluting production data
  if (!process.env.MONGODB_DB_NAME) {
    process.env.MONGODB_DB_NAME = 'bmsview-test';
  }
} else {
  // Use mocks for fast, isolated unit tests (default)
  console.log('\n⚙️  Running tests with MOCKS for fast unit testing');
  console.log('   Set USE_REAL_SERVICES=true for integration tests with real services\n');
  
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

  // Mock Gemini SDK (@google/genai)
  jest.mock('@google/genai', () => ({
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: {
        generateContent: jest.fn().mockResolvedValue({
          response: {
            text: () => 'OK - Test response from Gemini API'
          },
          text: () => 'OK - Test response from Gemini API'
        })
      }
    })),
    Type: {
      TYPE_UNSPECIFIED: 'TYPE_UNSPECIFIED',
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT'
    }
  }));

  // Mock fetch for API tests - includes Gemini API endpoint
  const mockFetch = jest.fn((url, options) => {
    // Mock Gemini API (generativelanguage.googleapis.com)
    if (typeof url === 'string' && url.includes('generativelanguage.googleapis.com')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          candidates: [{
            content: {
              parts: [{
                text: 'This is a mock AI response. The battery system shows good health with no critical issues detected.'
              }],
              role: 'model'
            },
            finishReason: 'STOP'
          }],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
            totalTokenCount: 150
          }
        })
      });
    }
    
    // Mock upload endpoint
    if (typeof url === 'string' && url.includes('/.netlify/functions/upload')) {
      global.__uploadCallCount = (global.__uploadCallCount || 0) + 1;
      const isDuplicate = global.__uploadCallCount % 2 === 0;
      return Promise.resolve({
        ok: !isDuplicate,
        status: isDuplicate ? 409 : 200,
        json: () => Promise.resolve({ success: !isDuplicate, reason: isDuplicate ? 'duplicate' : undefined })
      });
    }
    
    // Default mock response for other endpoints
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true })
    });
  });

  global.fetch = mockFetch;
}

// Global test hooks
beforeEach(() => {
  jest.clearAllMocks();
  if (!useRealServices) {
    // Reset fetch mock
    global.__uploadCallCount = 0;
    if (global.fetch && global.fetch.mockClear) {
      global.fetch.mockClear();
    }
    // Reset console mocks
    Object.keys(global.console).forEach(key => {
      if (typeof global.console[key] === 'function' && global.console[key].mockClear) {
        global.console[key].mockClear();
      }
    });
  }
});

afterEach(() => {
  // Cleanup after each test
});