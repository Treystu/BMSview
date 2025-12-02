/**
 * Tests for GitHub API utility module
 * Tests path validation, security, and API integration
 */

const {
  validatePath,
  ALLOWED_PATHS,
  BLOCKED_PATHS,
  MAX_FILE_SIZE
} = require('../netlify/functions/utils/github-api.cjs');

// Mock logger for tests
const mockLog = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

describe('GitHub API Utility Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Path Validation', () => {
    describe('Valid Paths', () => {
      test('should allow paths in allowlist', () => {
        const validPaths = [
          'netlify/functions/analyze.cjs',
          'components/UploadSection.tsx',
          'services/geminiService.ts',
          'state/appState.tsx',
          'hooks/useJobPolling.ts',
          'utils/solarCorrelation.ts',
          'types.ts',
          'App.tsx',
          'admin.tsx',
          'index.tsx',
          'vite.config.ts',
          'tsconfig.json',
          'package.json',
          'README.md',
          'ARCHITECTURE.md',
          'docs/FULL_CONTEXT_MODE.md'
        ];

        validPaths.forEach(path => {
          expect(() => validatePath(path, mockLog)).not.toThrow();
          const result = validatePath(path, mockLog);
          expect(typeof result).toBe('string');
        });
      });

      test('should normalize paths (remove leading/trailing slashes)', () => {
        const result = validatePath('/netlify/functions/analyze.cjs/', mockLog);
        expect(result).toBe('netlify/functions/analyze.cjs');
      });

      test('should normalize multiple slashes', () => {
        const result = validatePath('netlify//functions///analyze.cjs', mockLog);
        expect(result).toBe('netlify/functions/analyze.cjs');
      });
    });

    describe('Security - Directory Traversal', () => {
      test('should block ".." directory traversal', () => {
        expect(() => validatePath('netlify/../.env', mockLog)).toThrow('Directory traversal is not allowed');
        expect(mockLog.warn).toHaveBeenCalledWith(
          'Directory traversal attempt blocked',
          expect.any(Object)
        );
      });

      test('should block "./" attempts', () => {
        expect(() => validatePath('./netlify/functions', mockLog)).toThrow('Directory traversal is not allowed');
      });

      test('should block complex traversal attempts', () => {
        expect(() => validatePath('netlify/functions/../../.env', mockLog)).toThrow('Directory traversal is not allowed');
      });
    });

    describe('Security - Blocked Paths', () => {
      test('should block node_modules access', () => {
        expect(() => validatePath('node_modules/package/index.js', mockLog)).toThrow("Access to 'node_modules' is not allowed");
      });

      test('should block .git access', () => {
        expect(() => validatePath('.git/config', mockLog)).toThrow("Access to '.git' is not allowed");
      });

      test('should block .env files', () => {
        expect(() => validatePath('.env', mockLog)).toThrow("Access to '.env' is not allowed");
        expect(() => validatePath('.env.local', mockLog)).toThrow("Access to '.env.local' is not allowed");
        expect(() => validatePath('.env.production', mockLog)).toThrow("Access to '.env.production' is not allowed");
      });

      test('should block coverage directory', () => {
        expect(() => validatePath('coverage/index.html', mockLog)).toThrow("Access to 'coverage' is not allowed");
      });

      test('should block dist directory', () => {
        expect(() => validatePath('dist/bundle.js', mockLog)).toThrow("Access to 'dist' is not allowed");
      });

      test('should block .netlify directory', () => {
        expect(() => validatePath('.netlify/state.json', mockLog)).toThrow("Access to '.netlify' is not allowed");
      });
    });

    describe('Security - Allowlist Enforcement', () => {
      test('should block paths not in allowlist', () => {
        const blockedPaths = [
          'random/file.txt',
          'src/secret.js',
          'private/data.json',
          'test-data/sample.csv'
        ];

        blockedPaths.forEach(path => {
          expect(() => validatePath(path, mockLog)).toThrow('is not allowed');
        });
      });
    });

    describe('Invalid Input', () => {
      test('should reject null path', () => {
        expect(() => validatePath(null, mockLog)).toThrow('Path must be a non-empty string');
      });

      test('should reject undefined path', () => {
        expect(() => validatePath(undefined, mockLog)).toThrow('Path must be a non-empty string');
      });

      test('should reject empty string', () => {
        expect(() => validatePath('', mockLog)).toThrow('Path must be a non-empty string');
      });

      test('should reject non-string input', () => {
        expect(() => validatePath(123, mockLog)).toThrow('Path must be a non-empty string');
        expect(() => validatePath({}, mockLog)).toThrow('Path must be a non-empty string');
        expect(() => validatePath([], mockLog)).toThrow('Path must be a non-empty string');
      });
    });
  });

  describe('Constants', () => {
    test('ALLOWED_PATHS should include critical directories', () => {
      expect(ALLOWED_PATHS).toContain('netlify/functions');
      expect(ALLOWED_PATHS).toContain('components');
      expect(ALLOWED_PATHS).toContain('services');
      expect(ALLOWED_PATHS).toContain('state');
      expect(ALLOWED_PATHS).toContain('hooks');
      expect(ALLOWED_PATHS).toContain('utils');
      expect(ALLOWED_PATHS).toContain('docs');
      expect(ALLOWED_PATHS).toContain('types.ts');
      expect(ALLOWED_PATHS).toContain('ARCHITECTURE.md');
    });

    test('BLOCKED_PATHS should include sensitive directories', () => {
      expect(BLOCKED_PATHS).toContain('node_modules');
      expect(BLOCKED_PATHS).toContain('.git');
      expect(BLOCKED_PATHS).toContain('.env');
      expect(BLOCKED_PATHS).toContain('.env.local');
      expect(BLOCKED_PATHS).toContain('.env.production');
      expect(BLOCKED_PATHS).toContain('coverage');
      expect(BLOCKED_PATHS).toContain('dist');
      expect(BLOCKED_PATHS).toContain('.netlify');
    });

    test('MAX_FILE_SIZE should be reasonable (15KB)', () => {
      expect(MAX_FILE_SIZE).toBe(15 * 1024);
      expect(MAX_FILE_SIZE).toBe(15360);
    });
  });

  describe('Logging', () => {
    test('should log successful validation', () => {
      validatePath('netlify/functions/analyze.cjs', mockLog);
      expect(mockLog.debug).toHaveBeenCalledWith(
        'Path validated successfully',
        expect.objectContaining({
          path: 'netlify/functions/analyze.cjs'
        })
      );
    });

    test('should log directory traversal attempts', () => {
      try {
        validatePath('netlify/../.env', mockLog);
      } catch (e) {
        // Expected
      }
      expect(mockLog.warn).toHaveBeenCalledWith(
        'Directory traversal attempt blocked',
        expect.any(Object)
      );
    });

    test('should log blocked path attempts', () => {
      try {
        validatePath('node_modules/test.js', mockLog);
      } catch (e) {
        // Expected
      }
      expect(mockLog.warn).toHaveBeenCalledWith(
        'Blocked path access attempt',
        expect.any(Object)
      );
    });

    test('should log allowlist violations', () => {
      try {
        validatePath('random/file.txt', mockLog);
      } catch (e) {
        // Expected
      }
      expect(mockLog.warn).toHaveBeenCalledWith(
        'Path not in allowlist',
        expect.any(Object)
      );
    });
  });
});
