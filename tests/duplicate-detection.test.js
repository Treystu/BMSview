/**
 * Automated tests for duplicate file detection
 */

const { MongoClient } = require('mongodb');
const { uploadFile } = require('../src/services/uploadService');

// Mock MongoDB connection
const mockUri = 'mongodb://localhost:27017/test';
const client = new MongoClient(mockUri);
const database = client.db('test');

// Test utilities
const createTestUser = async () => {
  return {
    id: 'test-user-' + Date.now(),
    name: 'Test User'
  };
};

const createTestFile = (name = 'test-file.csv', size = 1024) => {
  return {
    name,
    size,
    type: 'text/csv',
    data: Buffer.from('test,data,here\n1,2,3')
  };
};

describe('Duplicate Detection Tests', () => {
  let testUser;
  let testFiles;

  beforeAll(async () => {
    // Setup test database
    await client.connect();
    testUser = await createTestUser();
    testFiles = [
      createTestFile('battery-data.csv'),
      createTestFile('system-logs.json'),
      createTestFile('measurements.txt')
    ];
  });

  afterAll(async () => {
    // Cleanup
    await database.collection('uploads').deleteMany({ userId: testUser.id });
    await client.close();
  });

  beforeEach(async () => {
    // Clean up before each test
    await database.collection('uploads').deleteMany({ userId: testUser.id });
  });

  test('should detect duplicate file in processing state', async () => {
    // Upload first file
    const firstResult = await uploadFile(testFiles[0], testUser.id);
    expect(firstResult.status).toBe('success');

    // Try to upload same file again
    const duplicateResult = await uploadFile(testFiles[0], testUser.id);
    expect(duplicateResult.status).toBe('skipped');
    expect(duplicateResult.reason).toBe('duplicate');
  });

  test('should detect duplicate file in completed state', async () => {
    // Upload file and mark as completed
    await database.collection('uploads').insertOne({
      filename: testFiles[1].name,
      userId: testUser.id,
      status: 'completed',
      createdAt: new Date(),
      fileSize: testFiles[1].size
    });

    // Try to upload same file
    const duplicateResult = await uploadFile(testFiles[1], testUser.id);
    expect(duplicateResult.status).toBe('skipped');
    expect(duplicateResult.reason).toBe('duplicate');
  });

  test('should allow upload of same filename by different users', async () => {
    const differentUser = { id: 'different-user', name: 'Different User' };

    // Upload file as first user
    const firstResult = await uploadFile(testFiles[0], testUser.id);
    expect(firstResult.status).toBe('success');

    // Upload same filename as different user
    const secondResult = await uploadFile(testFiles[0], differentUser.id);
    expect(secondResult.status).toBe('success');
  });

  test('should allow upload of failed files', async () => {
    // Upload file and mark as failed
    await database.collection('uploads').insertOne({
      filename: testFiles[2].name,
      userId: testUser.id,
      status: 'failed',
      createdAt: new Date(),
      fileSize: testFiles[2].size,
      error: 'Processing failed'
    });

    // Should be able to upload again
    const retryResult = await uploadFile(testFiles[2], testUser.id);
    expect(retryResult.status).toBe('success');
  });

  test('should handle case-sensitive filenames correctly', async () => {
    const upperCaseFile = createTestFile('BATTERY-DATA.CSV');
    const lowerCaseFile = createTestFile('battery-data.csv');

    // Upload lower case version
    const firstResult = await uploadFile(lowerCaseFile, testUser.id);
    expect(firstResult.status).toBe('success');

    // Upload upper case version (should be treated as different file)
    const secondResult = await uploadFile(upperCaseFile, testUser.id);
    expect(secondResult.status).toBe('success');
  });

  test('should handle database errors gracefully', async () => {
    // Simulate database error by closing connection
    await client.close();

    // Should not throw error but handle gracefully
    const result = await uploadFile(testFiles[0], testUser.id);
    
    // Should assume no duplicate on error
    expect(result.status).toBe('success');
  });

  test('should validate filename format', async () => {
    const invalidFiles = [
      createTestFile('file<with>brackets.csv'), // Invalid characters
      createTestFile('.hidden-file.csv'), // Hidden file
      createTestFile('script.exe'), // Executable
      createTestFile('a'.repeat(300) + '.csv') // Too long
    ];

    for (const file of invalidFiles) {
      const result = await uploadFile(file, testUser.id);
      expect(result.status).toBe('error');
      expect(result.reason).toContain('invalid');
    }
  });

  test('should allow valid file types', async () => {
    const validFiles = [
      createTestFile('data.csv'),
      createTestFile('config.json'),
      createTestFile('logs.txt'),
      createTestFile('measurements.log'),
      createTestFile('export.xml')
    ];

    for (const file of validFiles) {
      const result = await uploadFile(file, testUser.id);
      expect(result.status).toBe('success');
    }
  });

  test('should handle concurrent upload attempts', async () => {
    const concurrentPromises = Array(5).fill(null).map(() =>
      uploadFile(testFiles[0], testUser.id)
    );

    const results = await Promise.all(concurrentPromises);
    
    // Only one should succeed, others should be skipped as duplicates
    const successful = results.filter(r => r.status === 'success');
    const skipped = results.filter(r => r.status === 'skipped');
    
    expect(successful).toHaveLength(1);
    expect(skipped).toHaveLength(4);
  });
});

// Performance tests
describe('Duplicate Detection Performance', () => {
  test('should handle large number of existing uploads efficiently', async () => {
    await client.connect();
    
    const testUser = await createTestUser();
    
    // Insert many existing uploads
    const uploads = Array(1000).fill(null).map((_, i) => ({
      filename: `file-${i}.csv`,
      userId: testUser.id,
      status: 'completed',
      createdAt: new Date(),
      fileSize: 1024
    }));
    
    await database.collection('uploads').insertMany(uploads);
    
    const startTime = Date.now();
    const result = await uploadFile(createTestFile('new-file.csv'), testUser.id);
    const duration = Date.now() - startTime;
    
    expect(result.status).toBe('success');
    expect(duration).toBeLessThan(100); // Should complete in under 100ms
    
    await client.close();
  });
});

// Integration tests
describe('Duplicate Detection Integration', () => {
  test('should work with actual upload endpoint', async () => {
    // This would test the actual API endpoint
    // Requires a running server for integration testing
    
    const response = await fetch('http://localhost:8888/.netlify/functions/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: 'integration-test.csv',
        fileBase64: Buffer.from('test,data').toString('base64'),
        userId: 'integration-user'
      })
    });
    
    expect(response.ok).toBeTruthy();
    
    const result = await response.json();
    expect(result.success).toBeTruthy();
    
    // Try again - should be detected as duplicate
    const duplicateResponse = await fetch('http://localhost:8888/.netlify/functions/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: 'integration-test.csv',
        fileBase64: Buffer.from('test,data').toString('base64'),
        userId: 'integration-user'
      })
    });
    
    expect(duplicateResponse.status).toBe(409);
  });
});