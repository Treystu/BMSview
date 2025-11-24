# Testing Guide for BMSview

## Testing Policy: No Mock Data

To ensure production-like testing, all tests in this project are run against **real services**, including the Gemini API and a MongoDB database. Mocks are strictly prohibited.

### Integration Tests with Real Services

All tests validate actual production behavior.

```bash
npm test
```

**Required Environment Variables:**
```bash
export GEMINI_API_KEY="your-real-gemini-api-key"
export MONGODB_URI="your-real-mongodb-uri"
export MONGODB_DB_NAME="bmsview-test"
```

**Advantages:**
- Validates real API behavior
- Catches integration issues
- True production parity

**Disadvantages:**
- Slower execution
- Consumes API quota
- Requires credentials

## Quick Start

### Running All Tests
```bash
npm test
```

### Running Specific Test File
```bash
npm test -- tests/insights-generation.simple.test.js
```

### With Coverage
```bash
npm run test:coverage
```

### Watch Mode
```bash
npm run test:watch
```

## Best Practices

### During Development
```bash
# Fast feedback loop
npm test -- tests/specific-feature.test.js
```

### Before Committing
```bash
# Run all integration tests
npm test
```

### In CI/CD
- All tests are integration tests.
- Set secrets in repository settings.