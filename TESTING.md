# Testing Guide for BMSview

## Testing Modes

BMSview supports two testing modes:

### 1. Unit Tests with Mocks (Default - Fast)

Fast, isolated tests using mocks for Gemini API and MongoDB. **This is the default mode.**

```bash
npm test
# or explicitly
USE_REAL_SERVICES=false npm test
```

**Advantages:**
- Fast execution (~20 seconds for full suite)
- No external dependencies
- No API costs
- Works in any environment
- Ideal for CI/CD pipelines

### 2. Integration Tests with Real Services (Optional)

Tests that validate actual production behavior with real Gemini API and MongoDB.

```bash
USE_REAL_SERVICES=true npm test
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
- Slow (~2-5 minutes)
- Consumes API quota
- Requires credentials
- Use sparingly

## Quick Start

### Running Unit Tests (Default)
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
# Run all unit tests
npm test
```

### Before Releasing
```bash
# Run integration tests to validate production behavior
USE_REAL_SERVICES=true npm test
```

### In CI/CD
- Use unit tests (mocks) for all PRs
- Use integration tests only on main/release branches
- Set secrets in repository settings
