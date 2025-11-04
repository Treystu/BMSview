module.exports = {
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover'],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    }
  },
  testMatch: [
    '**/tests/**/*.comprehensive.test.js'
  ],
  testEnvironment: 'node',
  setupFilesAfterEnv: ['./tests/setup.js'],
  verbose: true
};