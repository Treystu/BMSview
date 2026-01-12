// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { TextEncoder, TextDecoder } = require('util');

// Polyfill for TextEncoder/TextDecoder (required for mongodb in jsdom environment)
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Polyfill fetch for Node environment tests
const nodeFetch = require('node-fetch');
global.fetch = nodeFetch;
global.Request = nodeFetch.Request;
global.Response = nodeFetch.Response;
global.Headers = nodeFetch.Headers;

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

const useRealServices = process.env.USE_REAL_SERVICES === '1' || process.env.USE_REAL_SERVICES === 'true';

if (useRealServices) {
  console.log('\n⚙️  Running tests with REAL services (Gemini API + MongoDB)');
  console.log('   USE_REAL_SERVICES is enabled.\n');

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
} else {
  console.log('\n⚙️  Running tests in mocked/offline mode');
  console.log('   Set USE_REAL_SERVICES=1 to enable live service integration tests.\n');

  process.env.FORCE_TEST_MOCK = process.env.FORCE_TEST_MOCK || '1';
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
  process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bmsview-test';
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

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection Details:', JSON.stringify(reason, null, 2));
  console.error('Stack:', reason.stack);
});

afterEach(() => {
  // Cleanup after each test
});