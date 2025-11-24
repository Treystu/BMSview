// Test setup file for Jest
jest.setTimeout(60000); // Increased timeout for real API calls

// IMPORTANT: Tests now use REAL services - no mocking
// You MUST set these environment variables for tests to pass:
// - GEMINI_API_KEY: Your Google Gemini API key
// - MONGODB_URI: Your MongoDB connection string
// - MONGODB_DB_NAME: Your MongoDB database name (default: bmsview-test)

// Set test environment
process.env.NODE_ENV = 'test';

// Use test database name to avoid polluting production data
if (!process.env.MONGODB_DB_NAME) {
  process.env.MONGODB_DB_NAME = 'bmsview-test';
}

// Validate required environment variables
const requiredEnvVars = ['GEMINI_API_KEY', 'MONGODB_URI'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.warn('\n⚠️  WARNING: Missing required environment variables for tests:');
  missingEnvVars.forEach(varName => {
    console.warn(`   - ${varName}`);
  });
  console.warn('\nTests that require these services will be skipped or fail.');
  console.warn('Set these variables in a .env file or export them before running tests.\n');
}

// Global test hooks
beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  // Cleanup after each test
});