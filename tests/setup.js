const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env.test');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  envConfig.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
      process.env[key.trim()] = value.trim().replace(/"/g, '');
    }
  });
}

// Test setup file for Jest
jest.setTimeout(60000); // Increased timeout for real API calls

// Mock console for cleaner test output
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// ALWAYS run tests with REAL services (Gemini API + MongoDB) per project policy.
console.log('\n⚙️  Running tests with REAL services (Gemini API + MongoDB)');
console.log('   Mocks are disabled to ensure production-like testing.\n');

// Validate required environment variables for real services
const requiredEnvVars = ['GEMINI_API_KEY', 'MONGODB_URI'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('\n❌ ERROR: Missing required environment variables for integration tests:');
  missingEnvVars.forEach(varName => {
    console.error(`   - ${varName}`);
  });
  console.error('\nSet these environment variables to run tests.\n');
  process.exit(1);
}

// Set test environment
process.env.NODE_ENV = 'test';

// Use test database name to avoid polluting production data
if (!process.env.MONGODB_DB_NAME) {
  process.env.MONGODB_DB_NAME = 'bmsview-test';
}

// Global test hooks
beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  // Cleanup after each test
});