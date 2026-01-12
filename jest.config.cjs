module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
    '**/*.simple.test.js'
  ],
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    'netlify/functions/**/*.{js,cjs,mjs}',
    '!src/**/*.test.{js,jsx,ts,tsx}',
    '!src/**/*.spec.{js,jsx,ts,tsx}'
  ],
  coverageThreshold: {
    global: {
      branches: 30,
      functions: 40,
      lines: 40,
      statements: 40
    }
  },
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 30000,
  verbose: true,
  transform: {
    '^.+\\.(js|jsx|ts|tsx|mjs|cjs)$': ['babel-jest', { rootMode: 'upward' }]
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@babel/runtime|mongodb|bson|@google/genai|node-fetch|data-uri-to-buffer|fetch-blob|formdata-polyfill|@netlify)/)'
  ],
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx', 'json', 'node', 'cjs', 'mjs'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^components/(.*)$': '<rootDir>/components/$1',
    '^services/(.*)$': '<rootDir>/services/$1',
    '^state/(.*)$': '<rootDir>/state/$1',
    '^hooks/(.*)$': '<rootDir>/hooks/$1',
    '^utils/(.*)$': '<rootDir>/utils/$1',
    '^@types/(.*)$': '<rootDir>/types/$1'
  }
};
