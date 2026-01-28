import { Validator, ValidationUtils, ValidationSchemas } from '../../utils/validation';
import { createMockAnalysisData, createMockBmsSystem } from './testUtils';

describe('Validation Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Validator', () => {
    describe('sanitizeString', () => {
      it('should sanitize XSS attempts', () => {
        const maliciousInput = '<script>alert("xss")</script>Test String';
        const result = Validator.sanitizeString(maliciousInput);
        expect(result).not.toContain('<script>');
        expect(result).not.toContain('alert');
        expect(result).toContain('Test String');
      });

      it('should encode HTML entities', () => {
        const input = 'Test & <test> "quote" \'single\' /slash';
        const result = Validator.sanitizeString(input);
        expect(result).toBe('Test &amp; &lt;test&gt; &quot;quote&quot; &#x27;single&#x27; &#x2F;slash');
      });

      it('should handle empty and null values', () => {
        expect(Validator.sanitizeString('')).toBe('');
        expect(Validator.sanitizeString(null as any)).toBe('');
        expect(Validator.sanitizeString(undefined as any)).toBe('');
      });

      it('should remove null bytes', () => {
        const input = 'Test\0String';
        const result = Validator.sanitizeString(input);
        expect(result).toBe('TestString');
      });
    });

    describe('sanitizeObject', () => {
      it('should sanitize all string properties recursively', () => {
        const input = {
          name: '<script>alert("test")</script>John',
          nested: {
            description: 'Safe & <secure>',
            tags: ['<tag1>', 'tag2']
          },
          number: 123,
          boolean: true
        };

        const result = Validator.sanitizeObject(input);

        expect(result.name).not.toContain('<script>');
        expect(result.nested.description).toBe('Safe &amp; &lt;secure&gt;');
        expect(result.nested.tags[0]).toBe('&lt;tag1&gt;');
        expect(result.number).toBe(123);
        expect(result.boolean).toBe(true);
      });
    });

    describe('checkForMaliciousContent', () => {
      it('should detect XSS patterns', () => {
        const maliciousInputs = [
          '<script>alert("xss")</script>',
          'javascript:alert("xss")',
          'onclick="malicious()"',
          '<iframe src="evil.com"></iframe>'
        ];

        maliciousInputs.forEach(input => {
          const result = Validator.checkForMaliciousContent(input);
          expect(result.isMalicious).toBe(true);
          expect(result.threats).toContain('XSS attempt detected');
        });
      });

      it('should detect SQL injection patterns', () => {
        const maliciousInputs = [
          "'; DROP TABLE users; --",
          "' OR '1'='1",
          'UNION SELECT * FROM passwords',
          '1; INSERT INTO'
        ];

        maliciousInputs.forEach(input => {
          const result = Validator.checkForMaliciousContent(input);
          expect(result.isMalicious).toBe(true);
          expect(result.threats).toContain('SQL injection attempt detected');
        });
      });

      it('should detect path traversal attempts', () => {
        const maliciousInputs = [
          '../../../etc/passwd',
          '..\\windows\\system32',
          './../../secret.txt'
        ];

        maliciousInputs.forEach(input => {
          const result = Validator.checkForMaliciousContent(input);
          expect(result.isMalicious).toBe(true);
          expect(result.threats).toContain('Path traversal attempt detected');
        });
      });

      it('should allow safe content', () => {
        const safeInputs = [
          'Normal text content',
          'Email: user@example.com',
          'Numbers: 123.45',
          'Special chars: !@#$%^&*()'
        ];

        safeInputs.forEach(input => {
          const result = Validator.checkForMaliciousContent(input);
          expect(result.isMalicious).toBe(false);
          expect(result.threats).toHaveLength(0);
        });
      });
    });

    describe('validateField', () => {
      it('should validate required fields', () => {
        const rule = { required: true, type: 'string' as const };

        const validResult = Validator.validateField('test', rule, 'testField');
        expect(validResult.isValid).toBe(true);

        const invalidResult = Validator.validateField('', rule, 'testField');
        expect(invalidResult.isValid).toBe(false);
        expect(invalidResult.error).toContain('required');
      });

      it('should validate field types', () => {
        const stringRule = { type: 'string' as const };
        const numberRule = { type: 'number' as const };
        const arrayRule = { type: 'array' as const };

        expect(Validator.validateField('test', stringRule, 'field').isValid).toBe(true);
        expect(Validator.validateField(123, stringRule, 'field').isValid).toBe(false);

        expect(Validator.validateField(123, numberRule, 'field').isValid).toBe(true);
        expect(Validator.validateField('test', numberRule, 'field').isValid).toBe(false);

        expect(Validator.validateField([1, 2, 3], arrayRule, 'field').isValid).toBe(true);
        expect(Validator.validateField('test', arrayRule, 'field').isValid).toBe(false);
      });

      it('should validate string length constraints', () => {
        const rule = { type: 'string' as const, minLength: 3, maxLength: 10 };

        expect(Validator.validateField('12', rule, 'field').isValid).toBe(false);
        expect(Validator.validateField('123', rule, 'field').isValid).toBe(true);
        expect(Validator.validateField('1234567890', rule, 'field').isValid).toBe(true);
        expect(Validator.validateField('12345678901', rule, 'field').isValid).toBe(false);
      });

      it('should validate number ranges', () => {
        const rule = { type: 'number' as const, min: 0, max: 100 };

        expect(Validator.validateField(-1, rule, 'field').isValid).toBe(false);
        expect(Validator.validateField(0, rule, 'field').isValid).toBe(true);
        expect(Validator.validateField(50, rule, 'field').isValid).toBe(true);
        expect(Validator.validateField(100, rule, 'field').isValid).toBe(true);
        expect(Validator.validateField(101, rule, 'field').isValid).toBe(false);
      });

      it('should validate regex patterns', () => {
        const emailRule = {
          type: 'string' as const,
          pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        };

        expect(Validator.validateField('valid@email.com', emailRule, 'email').isValid).toBe(true);
        expect(Validator.validateField('invalid-email', emailRule, 'email').isValid).toBe(false);
      });

      it('should validate custom functions', () => {
        const rule = {
          custom: (value: unknown) => {
            if (typeof value === 'string' && value.includes('forbidden')) {
              return 'Contains forbidden content';
            }
            return true;
          }
        };

        expect(Validator.validateField('safe content', rule, 'field').isValid).toBe(true);
        expect(Validator.validateField('forbidden content', rule, 'field').isValid).toBe(false);
      });
    });

    describe('validate', () => {
      it('should validate complex objects', () => {
        const schema = {
          name: { type: 'string' as const, required: true, minLength: 2 },
          age: { type: 'number' as const, min: 0, max: 150 },
          email: { type: 'string' as const, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }
        };

        const validData = {
          name: 'John Doe',
          age: 30,
          email: 'john@example.com'
        };

        const result = Validator.validate(validData, schema);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should collect multiple validation errors', () => {
        const schema = {
          name: { type: 'string' as const, required: true, minLength: 2 },
          age: { type: 'number' as const, min: 0, max: 150 },
          email: { type: 'string' as const, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }
        };

        const invalidData = {
          name: 'A', // Too short
          age: 200, // Too high
          email: 'invalid-email' // Invalid format
        };

        const result = Validator.validate(invalidData, schema);
        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(3);
        expect(result.errors.some(e => e.field === 'name')).toBe(true);
        expect(result.errors.some(e => e.field === 'age')).toBe(true);
        expect(result.errors.some(e => e.field === 'email')).toBe(true);
      });
    });
  });

  describe('ValidationSchemas', () => {
    describe('analysisData', () => {
      it('should validate correct analysis data', () => {
        const data = createMockAnalysisData();
        const result = Validator.validate(data, ValidationSchemas.analysisData);
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid analysis data', () => {
        const data = createMockAnalysisData({
          overallVoltage: -5, // Invalid negative voltage
          stateOfCharge: 150, // Invalid SOC > 100
          summary: '', // Required field empty
        });

        const result = Validator.validate(data, ValidationSchemas.analysisData);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'overallVoltage')).toBe(true);
        expect(result.errors.some(e => e.field === 'stateOfCharge')).toBe(true);
        expect(result.errors.some(e => e.field === 'summary')).toBe(true);
      });
    });

    describe('bmsSystem', () => {
      it('should validate correct BMS system data', () => {
        const data = createMockBmsSystem();
        const result = Validator.validate(data, ValidationSchemas.bmsSystem);
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid BMS system data', () => {
        const data = createMockBmsSystem({
          id: '', // Required field empty
          name: '', // Required field empty
          latitude: 95, // Invalid latitude > 90
          longitude: 185, // Invalid longitude > 180
        });

        const result = Validator.validate(data, ValidationSchemas.bmsSystem);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe('fileUpload', () => {
      it('should validate correct file upload data', () => {
        const data = {
          fileName: 'test-image.jpg',
          fileSize: 1024 * 1024, // 1MB
          mimeType: 'image/jpeg'
        };

        const result = Validator.validate(data, ValidationSchemas.fileUpload);
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid file upload data', () => {
        const data = {
          fileName: 'invalid-file.txt', // Invalid extension
          fileSize: 50 * 1024 * 1024, // 50MB - too large
          mimeType: 'text/plain' // Invalid MIME type
        };

        const result = Validator.validate(data, ValidationSchemas.fileUpload);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });
  });

  describe('ValidationUtils', () => {
    describe('isValidEmail', () => {
      it('should validate correct email addresses', () => {
        const validEmails = [
          'test@example.com',
          'user.name@domain.co.uk',
          'user+tag@example.org'
        ];

        validEmails.forEach(email => {
          expect(ValidationUtils.isValidEmail(email)).toBe(true);
        });
      });

      it('should reject invalid email addresses', () => {
        const invalidEmails = [
          'invalid-email',
          '@domain.com',
          'user@',
          'user space@domain.com'
        ];

        invalidEmails.forEach(email => {
          expect(ValidationUtils.isValidEmail(email)).toBe(false);
        });
      });
    });

    describe('isValidUrl', () => {
      it('should validate correct URLs', () => {
        const validUrls = [
          'https://example.com',
          'http://localhost:3000',
          'ftp://files.example.com'
        ];

        validUrls.forEach(url => {
          expect(ValidationUtils.isValidUrl(url)).toBe(true);
        });
      });

      it('should reject invalid URLs', () => {
        const invalidUrls = [
          'not-a-url',
          'http://',
          'invalid:///',
          ''
        ];

        invalidUrls.forEach(url => {
          expect(ValidationUtils.isValidUrl(url)).toBe(false);
        });
      });
    });

    describe('isValidLatitude', () => {
      it('should validate correct latitudes', () => {
        expect(ValidationUtils.isValidLatitude(0)).toBe(true);
        expect(ValidationUtils.isValidLatitude(37.7749)).toBe(true);
        expect(ValidationUtils.isValidLatitude(-90)).toBe(true);
        expect(ValidationUtils.isValidLatitude(90)).toBe(true);
      });

      it('should reject invalid latitudes', () => {
        expect(ValidationUtils.isValidLatitude(-90.1)).toBe(false);
        expect(ValidationUtils.isValidLatitude(90.1)).toBe(false);
        expect(ValidationUtils.isValidLatitude(180)).toBe(false);
      });
    });

    describe('isValidLongitude', () => {
      it('should validate correct longitudes', () => {
        expect(ValidationUtils.isValidLongitude(0)).toBe(true);
        expect(ValidationUtils.isValidLongitude(-122.4194)).toBe(true);
        expect(ValidationUtils.isValidLongitude(-180)).toBe(true);
        expect(ValidationUtils.isValidLongitude(180)).toBe(true);
      });

      it('should reject invalid longitudes', () => {
        expect(ValidationUtils.isValidLongitude(-180.1)).toBe(false);
        expect(ValidationUtils.isValidLongitude(180.1)).toBe(false);
        expect(ValidationUtils.isValidLongitude(200)).toBe(false);
      });
    });

    describe('sanitizeFileName', () => {
      it('should remove dangerous characters', () => {
        const dangerous = 'file<>:"/\\|?*.txt';
        const result = ValidationUtils.sanitizeFileName(dangerous);
        expect(result).not.toContain('<');
        expect(result).not.toContain('>');
        expect(result).not.toContain('|');
        expect(result).not.toContain('?');
        expect(result).not.toContain('*');
      });

      it('should replace spaces with underscores', () => {
        const fileName = 'my file name.txt';
        const result = ValidationUtils.sanitizeFileName(fileName);
        expect(result).toBe('my_file_name.txt');
      });

      it('should limit length to 255 characters', () => {
        const longName = 'a'.repeat(300) + '.txt';
        const result = ValidationUtils.sanitizeFileName(longName);
        expect(result.length).toBeLessThanOrEqual(255);
      });
    });

    describe('validateFileUpload', () => {
      it('should validate File objects', () => {
        const mockFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
        const result = ValidationUtils.validateFileUpload(mockFile);
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid file types', () => {
        const mockFile = new File(['test'], 'test.exe', { type: 'application/executable' });
        const result = ValidationUtils.validateFileUpload(mockFile);
        expect(result.isValid).toBe(false);
      });
    });

    describe('validateBatteryData', () => {
      it('should validate complete battery data', () => {
        const data = createMockAnalysisData();
        const result = ValidationUtils.validateBatteryData(data);
        expect(result.isValid).toBe(true);
      });
    });

    describe('validateSystemData', () => {
      it('should validate complete system data', () => {
        const data = createMockBmsSystem();
        const result = ValidationUtils.validateSystemData(data);
        expect(result.isValid).toBe(true);
      });
    });
  });
});