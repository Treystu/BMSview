import '@testing-library/jest-dom';
import { customMatchers } from './utils/testUtils';

// Extend Jest matchers
expect.extend(customMatchers);

// Mock environment variables
process.env.NODE_ENV = 'test';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock performance API
Object.defineProperty(global, 'performance', {
  writable: true,
  value: {
    now: jest.fn(() => Date.now()),
    mark: jest.fn(),
    measure: jest.fn(),
    memory: {
      usedJSHeapSize: 1000000,
      totalJSHeapSize: 2000000,
      jsHeapSizeLimit: 10000000,
    },
    getEntriesByType: jest.fn(() => []),
  },
});

// Mock URL constructor
global.URL = URL;
global.URLSearchParams = URLSearchParams;

// Mock File and FileReader
global.File = File;
global.FileReader = FileReader;

// Mock crypto for UUID generation
Object.defineProperty(global, 'crypto', {
  value: {
    getRandomValues: jest.fn((arr) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    }),
    randomUUID: jest.fn(() => 'test-uuid-1234'),
  },
});

// Mock console methods with more control
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

// Allow tests to suppress console output when needed
global.suppressConsole = () => {
  console.error = jest.fn();
  console.warn = jest.fn();
};

global.restoreConsole = () => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
};

// Global error handler for uncaught test errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Clean up after each test
afterEach(() => {
  // Clean up any global state
  jest.clearAllMocks();

  // Restore console if it was suppressed
  global.restoreConsole();
});

// Global setup for all tests
beforeAll(() => {
  // Any global setup that needs to run once before all tests
});

// Global cleanup
afterAll(() => {
  // Any global cleanup that needs to run once after all tests
});