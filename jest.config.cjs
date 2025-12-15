module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js',
    '**/*.simple.test.js'
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    'netlify/functions/**/*.js',
    '!src/**/*.test.js',
    '!src/**/*.spec.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 30000,
  verbose: true,
  transform: {
    '^.+\\.(js|jsx|ts|tsx|mjs|cjs)$': ['babel-jest', { rootMode: 'upward' }]
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@babel/runtime|mongodb|bson|@google/genai)/)'
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
