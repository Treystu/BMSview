# Testing Guide for BMSview

## ⚠️ IMPORTANT: No Mock Testing

**All tests in this project use REAL services and APIs.** There is no mock functionality. Tests interact with:
- Real Google Gemini AI API
- Real MongoDB database
- Real network requests

## Prerequisites

Before running tests, you MUST configure the following:

### 1. Google Gemini API Key

Get your API key from: https://makersuite.google.com/app/apikey

```bash
export GEMINI_API_KEY="your-actual-api-key-here"
```

### 2. MongoDB Database

You need a MongoDB instance (local or cloud). For tests, we recommend using a separate test database.

**MongoDB Atlas (Cloud):**
1. Create a free cluster at https://cloud.mongodb.com
2. Get your connection string
3. Create a database named `bmsview-test`

```bash
export MONGODB_URI="mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority"
export MONGODB_DB_NAME="bmsview-test"
```

**Local MongoDB:**
```bash
export MONGODB_URI="mongodb://localhost:27017"
export MONGODB_DB_NAME="bmsview-test"
```

### 3. Environment File

Copy the example and fill in real values:

```bash
cp .env.example .env
# Edit .env with your real credentials
```

**Required variables in .env:**
```
GEMINI_API_KEY=your-real-api-key
MONGODB_URI=your-real-mongodb-connection-string
MONGODB_DB_NAME=bmsview-test
```

## Running Tests

### All Tests
```bash
npm test
```

### Specific Test File
```bash
npm test -- tests/insights-generation.clean.test.js
```

### With Coverage
```bash
npm run test:coverage
```

### Watch Mode
```bash
npm run test:watch
```

## Test Timeout Configuration

Tests now have a 60-second timeout (increased from 30s) to accommodate real API calls. Individual tests that make multiple API calls may need longer timeouts.

## Cost Considerations

⚠️ **Running tests will consume:**
- **Gemini API quota** (free tier: 60 requests/minute)
- **MongoDB operations** (free tier: 512MB storage)

For extensive testing, consider:
1. Using a dedicated test Gemini API key
2. Using a separate MongoDB test database
3. Running specific test suites instead of all tests

## Test Database Cleanup

Tests use `bmsview-test` database by default. You may want to periodically clean it:

```javascript
// In MongoDB shell or Compass
use bmsview-test
db.dropDatabase()
```

## Troubleshooting

### "Missing required environment variables"
- Check that .env file exists and has real values
- Or export variables in your shell before running tests

### "GEMINI_API_KEY not configured"
- Verify your API key is valid
- Check quota limits at https://makersuite.google.com/app/apikey

### "MongoDB connection failed"
- Verify MongoDB is running (local) or accessible (cloud)
- Check connection string format
- Ensure network access (whitelist IP in MongoDB Atlas)

### Tests timeout
- Check your internet connection
- Verify Gemini API is responding
- Increase timeout in specific test files if needed

## What Tests Do

Since all tests use real services:

1. **Insights Generation Tests**: Make actual calls to Gemini AI to analyze battery data
2. **MongoDB Tests**: Create, read, update, and delete real database records
3. **Integration Tests**: Test complete workflows end-to-end

## CI/CD Considerations

For GitHub Actions or other CI systems:

1. Add secrets to your repository settings:
   - `GEMINI_API_KEY`
   - `MONGODB_URI`
   - `MONGODB_DB_NAME`

2. Reference them in your workflow:
```yaml
env:
  GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  MONGODB_URI: ${{ secrets.MONGODB_URI }}
  MONGODB_DB_NAME: bmsview-test
```

## Test Isolation

While tests use real services, they should be isolated:
- Each test should clean up its data
- Use unique identifiers (timestamps, UUIDs) for test data
- The test database should be separate from production

## Performance

Expect test suite to take longer than mocked tests:
- Full suite: 2-5 minutes (depending on network and API response times)
- Insights tests: 5-15 seconds each (real Gemini API calls)
- MongoDB tests: <1 second each (fast database operations)
