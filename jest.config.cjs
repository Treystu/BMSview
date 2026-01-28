/** @type {import('jest').Config} */
module.exports = {
  // Environment
  testEnvironment: 'jsdom',

  // Test discovery
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/src/**/*.(test|spec).{js,jsx,ts,tsx}',
    '<rootDir>/tests/**/*.{js,jsx,ts,tsx}',
    '**/*.simple.test.js'
  ],

  // Setup
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.js',
    '<rootDir>/src/__tests__/setup.ts'
  ],

  // Module resolution
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^components/(.*)$': '<rootDir>/src/components/$1',
    '^services/(.*)$': '<rootDir>/src/services/$1',
    '^state/(.*)$': '<rootDir>/src/state/$1',
    '^hooks/(.*)$': '<rootDir>/src/hooks/$1',
    '^utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$': 'jest-transform-stub',
  },

  // Transform
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        jsx: 'react-jsx',
      },
    }],
    '^.+\\.(js|jsx|mjs|cjs)$': ['babel-jest', { rootMode: 'upward' }]
  },

  transformIgnorePatterns: [
    '/node_modules/(?!(@babel/runtime|mongodb|bson|@google/genai|node-fetch|data-uri-to-buffer|fetch-blob|formdata-polyfill|@netlify)/)'
  ],

  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx', 'json', 'node', 'cjs', 'mjs'],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    'netlify/functions/**/*.{js,cjs,mjs}',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**/*',
    '!src/**/*.test.{js,jsx,ts,tsx}',
    '!src/**/*.spec.{js,jsx,ts,tsx}',
    '!src/index.tsx',
    '!src/vite-env.d.ts',
  ],

  coverageReporters: [
    'text',
    'lcov',
    'html',
    'json-summary',
    'clover'
  ],

  coverageDirectory: 'coverage',

  // Enhanced coverage thresholds
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 70,
      lines: 70,
      statements: 70
    },
    // Higher thresholds for critical utilities
    './src/utils/': {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85
    },
    './src/state/': {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // Test configuration
  testTimeout: 30000,
  verbose: process.env.CI === 'true',
  clearMocks: true,
  restoreMocks: true,
  errorOnDeprecated: true,
  maxWorkers: process.env.CI ? 1 : '50%',

  // ESM support
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],

  // Globals
  globals: {
    'ts-jest': {
      useESM: true,
      tsconfig: {
        jsx: 'react-jsx'
      }
    }
  },

  // Reporter configuration
  reporters: [
    'default',
    ...(process.env.CI ? [
      ['jest-junit', {
        outputDirectory: 'coverage',
        outputName: 'junit.xml',
        usePathForSuiteName: true
      }]
    ] : [])
  ]
};
