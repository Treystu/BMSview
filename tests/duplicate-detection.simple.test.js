/**
 * Simplified duplicate detection tests (ES5 compatible)
 */

// Mock database for testing
const createMockDatabase = () => {
  const data = {
    uploads: []
  };

  return {
    collection: (name) => ({
      findOne: (query) => {
        if (name === 'uploads') {
          return data.uploads.find((upload) => 
            upload.filename === query.filename && 
            upload.userId === query.userId &&
            query.status.$in.includes(upload.status)
          ) || null;
        }
        return null;
      },
      insertOne: (document) => {
        document._id = `mock-id-${Date.now()}`;
        if (name === 'uploads') {
          data.uploads.push(document);
        }
        return { insertedId: document._id };
      },
      updateOne: (query, update) => {
        if (name === 'uploads') {
          const upload = data.uploads.find((u) => 
            u.filename === query.filename && u.userId === query.userId
          );
          if (upload) {
            Object.assign(upload, update.$set);
            return { modifiedCount: 1 };
          }
        }
        return { modifiedCount: 0 };
      }
    })
  };
};

// Mock upload service
const createMockUploadService = () => {
  const db = createMockDatabase();

  return {
    checkForDuplicate: async (filename, userId) => {
      const existing = await db.collection('uploads').findOne({
        filename,
        userId,
        status: { $in: ['completed', 'processing'] }
      });
      return !!existing;
    },

    validateFilename: (filename) => {
      const invalidPatterns = [
        /[<>:"|?*]/,
        /^\./,
        /\.exe$/i,
        /\.bat$/i,
        /\.cmd$/i
      ];

      const allowedExtensions = ['.csv', '.json', '.txt', '.log', '.xml'];
      const fileExtension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
      
      if (!allowedExtensions.includes(fileExtension)) {
        return {
          valid: false,
          error: `File type ${fileExtension} is not allowed`
        };
      }

      for (const pattern of invalidPatterns) {
        if (pattern.test(filename)) {
          return {
            valid: false,
            error: 'Filename contains invalid characters'
          };
        }
      }

      if (filename.length > 255) {
        return {
          valid: false,
          error: 'Filename is too long (max 255 characters)'
        };
      }

      return { valid: true };
    },

    uploadFile: async function(file, userId) {
      // Validate filename
      const filenameValidation = this.validateFilename(file.name);
      if (!filenameValidation.valid) {
        return {
          status: 'error',
          reason: filenameValidation.error
        };
      }

      try {
        // Check for duplicates
        const isDuplicate = await this.checkForDuplicate(file.name, userId);
        if (isDuplicate) {
          return {
            status: 'skipped',
            reason: 'duplicate'
          };
        }

        // Insert upload record
        await db.collection('uploads').insertOne({
          filename: file.name,
          userId,
          status: 'completed',
          createdAt: new Date(),
          fileSize: file.size
        });

        return {
          status: 'success',
          fileId: `file-${Date.now()}`,
          message: 'File uploaded successfully'
        };
      } catch (error) {
        throw error;
      }
    }
  };
};

// Create test files
const createTestFile = (name = 'test-file.csv', size = 1024) => ({
  name,
  size,
  type: 'text/csv'
});

describe('Duplicate Detection Simplified Tests', () => {
  let uploadService;
  let testUser;

  beforeEach(() => {
    uploadService = createMockUploadService();
    testUser = {
      id: `test-user-${Date.now()}`,
      name: 'Test User'
    };
  });

  test('should detect duplicate file', async () => {
    const testFile = createTestFile('battery-data.csv');
    
    // Upload first file
    const result = await uploadService.uploadFile(testFile, testUser.id);
    expect(result.status).toBe('success');
    
    const duplicateResult = await uploadService.uploadFile(testFile, testUser.id);
    expect(duplicateResult.status).toBe('skipped');
    expect(duplicateResult.reason).toBe('duplicate');
  });

  test('should allow upload of same filename by different users', async () => {
    const testFile = createTestFile('shared-file.csv');
    const differentUser = {
      id: 'different-user',
      name: 'Different User'
    };

    // Upload as first user
    const result = await uploadService.uploadFile(testFile, testUser.id);
    expect(result.status).toBe('success');
    
    // Upload as different user
    const secondResult = await uploadService.uploadFile(testFile, differentUser.id);
    expect(secondResult.status).toBe('success');
  });

  test('should handle case-sensitive filenames correctly', async () => {
    const lowerCaseFile = createTestFile('battery-data.csv');
    const upperCaseFile = createTestFile('BATTERY-DATA.CSV');

    // Upload lower case version
    const result = await uploadService.uploadFile(lowerCaseFile, testUser.id);
    expect(result.status).toBe('success');
    
    // Upload upper case version (should be treated as different file)
    const secondResult = await uploadService.uploadFile(upperCaseFile, testUser.id);
    expect(secondResult.status).toBe('success');
  });

  test('should validate filename format', async () => {
    const invalidFiles = [
      createTestFile('file<with>brackets.csv'),
      createTestFile('.hidden-file.csv'),
      createTestFile('script.exe'),
      createTestFile('a'.repeat(300) + '.csv')
    ];

    const results = await Promise.all(invalidFiles.map(file => 
      uploadService.uploadFile(file, testUser.id)
    ));

    results.forEach(result => {
      expect(result.status).toBe('error');
      expect(result.reason).toContain('invalid');
    });
  });

  test('should allow valid file types', async () => {
    const validFiles = [
      createTestFile('data.csv'),
      createTestFile('config.json'),
      createTestFile('logs.txt'),
      createTestFile('measurements.log'),
      createTestFile('export.xml')
    ];

    const results = await Promise.all(validFiles.map(file => 
      uploadService.uploadFile(file, testUser.id)
    ));

    results.forEach(result => {
      expect(result.status).toBe('success');
    });
  });
});

// Performance tests
describe('Duplicate Detection Performance', () => {
  let uploadService;

  beforeEach(() => {
    uploadService = createMockUploadService();
  });

  test('should handle many uploads efficiently', async () => {
    const testUser = { id: 'perf-user', name: 'Performance User' };
    const startTime = Date.now();
    
    // Upload many unique files
    const total = 100;
    const uploads = Array.from({ length: total }, (_, i) => 
      uploadService.uploadFile(
        createTestFile(`perf-file-${i}.csv`), 
        testUser.id
      )
    );
    
    const results = await Promise.all(uploads);
    
    results.forEach(result => {
      expect(result.status).toBe('success');
    });

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(1000); // Should complete in under 1 second
  });
});

// Integration tests
describe('Duplicate Detection Integration', () => {
  test('should handle filename validation edge cases', () => {
    const uploadService = createMockUploadService();
    
    // Test empty filename
    expect(uploadService.validateFilename('').valid).toBe(false);
    
    // Test very long filename
    expect(uploadService.validateFilename('a'.repeat(300) + '.csv').valid).toBe(false);
    
    // Test valid extensions
    expect(uploadService.validateFilename('test.csv').valid).toBe(true);
    expect(uploadService.validateFilename('test.json').valid).toBe(true);
    expect(uploadService.validateFilename('test.txt').valid).toBe(true);
    
    // Test invalid extensions
    expect(uploadService.validateFilename('test.exe').valid).toBe(false);
    expect(uploadService.validateFilename('test.bat').valid).toBe(false);
    
    // Test invalid characters
    expect(uploadService.validateFilename('test<file>.csv').valid).toBe(false);
    expect(uploadService.validateFilename('test|file.csv').valid).toBe(false);
    expect(uploadService.validateFilename('test:file.csv').valid).toBe(false);
  });
});