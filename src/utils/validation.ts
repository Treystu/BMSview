import type { AnalysisData, BmsSystem, WeatherData, SolarCorrelationData } from '@/types';
import { ErrorFactory } from './asyncErrorHandler';

/**
 * Comprehensive validation and sanitization utilities
 * Provides input validation, data sanitization, and XSS protection
 */

export interface ValidationRule<T = unknown> {
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  custom?: (value: T) => boolean | string;
  sanitize?: (value: T) => T;
}

export interface ValidationSchema {
  [key: string]: ValidationRule | ValidationSchema;
}

export interface ValidationResult {
  isValid: boolean;
  errors: Array<{
    field: string;
    message: string;
    value?: unknown;
  }>;
  warnings: Array<{
    field: string;
    message: string;
    value?: unknown;
  }>;
  sanitizedData?: Record<string, unknown>;
}

export class Validator {
  private static readonly XSS_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /onload\s*=/gi,
    /onclick\s*=/gi,
    /onerror\s*=/gi,
    /onmouseover\s*=/gi,
    /<embed\b[^>]*>/gi,
    /<object\b[^>]*>/gi,
    /<applet\b[^>]*>/gi,
    /<meta\b[^>]*>/gi,
    /<form\b[^>]*>/gi,
  ];

  private static readonly SQL_INJECTION_PATTERNS = [
    /('|(\\'))|(;)|(\|)|(\*)|(%)/gi,
    /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/gi,
    /((\%27)|(\'))union/gi,
    /((\%27)|(\'))select/gi,
    /((\%27)|(\'))insert/gi,
    /((\%27)|(\'))delete/gi,
    /((\%27)|(\'))update/gi,
    /((\%27)|(\'))drop/gi,
    /((\%27)|(\'))create/gi,
    /((\%27)|(\'))alter/gi,
    /((\%27)|(\'))exec/gi,
    /exec(\s|\+)+(s|x)p\w+/gi,
  ];

  static sanitizeString(input: string): string {
    if (typeof input !== 'string') {
      return String(input || '');
    }

    // Remove null bytes
    let sanitized = input.replace(/\0/g, '');

    // HTML entity encoding for basic XSS prevention
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');

    // Remove dangerous patterns
    for (const pattern of this.XSS_PATTERNS) {
      sanitized = sanitized.replace(pattern, '');
    }

    // Trim whitespace
    sanitized = sanitized.trim();

    return sanitized;
  }

  static sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
    const sanitized = {} as T;

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        sanitized[key as keyof T] = this.sanitizeString(value) as T[keyof T];
      } else if (Array.isArray(value)) {
        sanitized[key as keyof T] = value.map(item =>
          typeof item === 'string' ? this.sanitizeString(item) : item
        ) as T[keyof T];
      } else if (value && typeof value === 'object') {
        sanitized[key as keyof T] = this.sanitizeObject(value as Record<string, unknown>) as T[keyof T];
      } else {
        sanitized[key as keyof T] = value as T[keyof T];
      }
    }

    return sanitized;
  }

  static checkForMaliciousContent(input: string): { isMalicious: boolean; threats: string[] } {
    const threats: string[] = [];

    // Check for XSS patterns
    for (const pattern of this.XSS_PATTERNS) {
      if (pattern.test(input)) {
        threats.push('XSS attempt detected');
        break;
      }
    }

    // Check for SQL injection patterns
    for (const pattern of this.SQL_INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        threats.push('SQL injection attempt detected');
        break;
      }
    }

    // Check for suspicious file paths
    if (/(\.\.(\/|\\))/g.test(input)) {
      threats.push('Path traversal attempt detected');
    }

    // Check for suspicious commands
    if (/(\b(eval|exec|system|shell_exec|passthru|file_get_contents)\b)/gi.test(input)) {
      threats.push('Command injection attempt detected');
    }

    return {
      isMalicious: threats.length > 0,
      threats,
    };
  }

  static validateField(value: unknown, rule: ValidationRule, fieldName: string): {
    isValid: boolean;
    error?: string;
    warning?: string;
    sanitized?: unknown;
  } {
    // Handle required fields
    if (rule.required && (value === null || value === undefined || value === '')) {
      return { isValid: false, error: `${fieldName} is required` };
    }

    // Skip validation for non-required empty values
    if (!rule.required && (value === null || value === undefined || value === '')) {
      return { isValid: true, sanitized: value };
    }

    // Type validation
    if (rule.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== rule.type) {
        return { isValid: false, error: `${fieldName} must be of type ${rule.type}` };
      }
    }

    let sanitized = value;

    // String-specific validation
    if (typeof value === 'string') {
      // Check for malicious content
      const maliciousCheck = this.checkForMaliciousContent(value);
      if (maliciousCheck.isMalicious) {
        return { isValid: false, error: `${fieldName} contains malicious content: ${maliciousCheck.threats.join(', ')}` };
      }

      // Sanitize string if sanitization is enabled
      if (rule.sanitize !== false) {
        sanitized = this.sanitizeString(value);
      }

      // Length validation
      if (rule.minLength && value.length < rule.minLength) {
        return { isValid: false, error: `${fieldName} must be at least ${rule.minLength} characters long` };
      }
      if (rule.maxLength && value.length > rule.maxLength) {
        return { isValid: false, error: `${fieldName} must be no more than ${rule.maxLength} characters long` };
      }

      // Pattern validation
      if (rule.pattern && !rule.pattern.test(value)) {
        return { isValid: false, error: `${fieldName} format is invalid` };
      }
    }

    // Number-specific validation
    if (typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        return { isValid: false, error: `${fieldName} must be at least ${rule.min}` };
      }
      if (rule.max !== undefined && value > rule.max) {
        return { isValid: false, error: `${fieldName} must be no more than ${rule.max}` };
      }

      // Check for special values
      if (!Number.isFinite(value)) {
        return { isValid: false, error: `${fieldName} must be a finite number` };
      }
    }

    // Array-specific validation
    if (Array.isArray(value)) {
      if (rule.minLength && value.length < rule.minLength) {
        return { isValid: false, error: `${fieldName} must have at least ${rule.minLength} items` };
      }
      if (rule.maxLength && value.length > rule.maxLength) {
        return { isValid: false, error: `${fieldName} must have no more than ${rule.maxLength} items` };
      }

      // Sanitize array elements if they are strings
      if (rule.sanitize !== false) {
        sanitized = value.map(item =>
          typeof item === 'string' ? this.sanitizeString(item) : item
        );
      }
    }

    // Custom validation
    if (rule.custom) {
      const result = rule.custom(value);
      if (result !== true) {
        return { isValid: false, error: typeof result === 'string' ? result : `${fieldName} is invalid` };
      }
    }

    return { isValid: true, sanitized };
  }

  static validate(data: Record<string, unknown>, schema: ValidationSchema): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    const warnings: ValidationResult['warnings'] = [];
    const sanitizedData: Record<string, unknown> = {};

    function validateRecursive(obj: Record<string, unknown>, sch: ValidationSchema, prefix = ''): void {
      for (const [key, rule] of Object.entries(sch)) {
        const fieldName = prefix ? `${prefix}.${key}` : key;
        const value = obj[key];

        if (typeof rule === 'object' && !rule.type && !rule.required) {
          // Nested schema
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            validateRecursive(value as Record<string, unknown>, rule as ValidationSchema, fieldName);
          } else if (rule.required) {
            errors.push({ field: fieldName, message: `${fieldName} is required` });
          }
        } else {
          // Validation rule
          const result = this.validateField(value, rule as ValidationRule, fieldName);
          if (!result.isValid) {
            errors.push({ field: fieldName, message: result.error!, value });
          } else {
            if (result.warning) {
              warnings.push({ field: fieldName, message: result.warning, value });
            }
            sanitizedData[key] = result.sanitized;
          }
        }
      }
    }

    validateRecursive(data, schema);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedData,
    };
  }
}

// Predefined validation schemas for common types
export const ValidationSchemas = {
  analysisData: {
    systemId: { type: 'string', maxLength: 100 },
    hardwareSystemId: { type: 'string', maxLength: 100 },
    timestampFromImage: { type: 'string', maxLength: 50 },
    status: { type: 'string', maxLength: 100 },
    overallVoltage: { type: 'number', min: 0, max: 1000 },
    power: { type: 'number', min: -50000, max: 50000 },
    current: { type: 'number', min: -1000, max: 1000 },
    stateOfCharge: { type: 'number', min: 0, max: 100 },
    remainingCapacity: { type: 'number', min: 0, max: 10000 },
    fullCapacity: { type: 'number', min: 0, max: 10000 },
    cycleCount: { type: 'number', min: 0, max: 100000 },
    temperature: { type: 'number', min: -100, max: 100 },
    temperatures: { type: 'array', maxLength: 10 },
    mosTemperature: { type: 'number', min: -100, max: 200 },
    chargeMosOn: { type: 'boolean' },
    dischargeMosOn: { type: 'boolean' },
    balanceOn: { type: 'boolean' },
    serialNumber: { type: 'string', maxLength: 50 },
    softwareVersion: { type: 'string', maxLength: 20 },
    hardwareVersion: { type: 'string', maxLength: 20 },
    snCode: { type: 'string', maxLength: 50 },
    numTempSensors: { type: 'number', min: 0, max: 20 },
    cellVoltages: { type: 'array', maxLength: 100 },
    highestCellVoltage: { type: 'number', min: 0, max: 10 },
    lowestCellVoltage: { type: 'number', min: 0, max: 10 },
    cellVoltageDifference: { type: 'number', min: 0, max: 5 },
    averageCellVoltage: { type: 'number', min: 0, max: 10 },
    alerts: { type: 'array', maxLength: 50 },
    summary: { type: 'string', maxLength: 2000, required: true },
  } as ValidationSchema,

  bmsSystem: {
    id: { type: 'string', required: true, maxLength: 100 },
    name: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    chemistry: { type: 'string', maxLength: 50 },
    voltage: { type: 'number', min: 0, max: 1000 },
    capacity: { type: 'number', min: 0, max: 10000 },
    latitude: { type: 'number', min: -90, max: 90 },
    longitude: { type: 'number', min: -180, max: 180 },
    associatedHardwareIds: { type: 'array', maxLength: 100 },
    maxAmpsSolarCharging: { type: 'number', min: 0, max: 1000 },
    maxAmpsGeneratorCharging: { type: 'number', min: 0, max: 1000 },
  } as ValidationSchema,

  weatherData: {
    temp: { type: 'number', required: true, min: -100, max: 100 },
    clouds: { type: 'number', required: true, min: 0, max: 100 },
    uvi: { type: 'number', required: true, min: 0, max: 20 },
    weather_main: { type: 'string', required: true, maxLength: 50 },
    weather_icon: { type: 'string', required: true, maxLength: 10 },
    estimated_irradiance_w_m2: { type: 'number', min: 0, max: 2000 },
  } as ValidationSchema,

  fileUpload: {
    fileName: {
      type: 'string',
      required: true,
      maxLength: 255,
      pattern: /^[a-zA-Z0-9._-]+\.(jpg|jpeg|png|bmp|gif|webp)$/i,
    },
    fileSize: { type: 'number', required: true, min: 1, max: 10 * 1024 * 1024 }, // 10MB max
    mimeType: {
      type: 'string',
      required: true,
      custom: (value: unknown) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/bmp', 'image/gif', 'image/webp'];
        return allowedTypes.includes(value as string) || 'Invalid file type';
      },
    },
  } as ValidationSchema,
};

// Utility functions for common validation tasks
export const ValidationUtils = {
  isValidEmail: (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  isValidUrl: (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },

  isValidLatitude: (lat: number): boolean => {
    return lat >= -90 && lat <= 90;
  },

  isValidLongitude: (lng: number): boolean => {
    return lng >= -180 && lng <= 180;
  },

  isValidFileExtension: (fileName: string, allowedExtensions: string[]): boolean => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    return extension ? allowedExtensions.includes(extension) : false;
  },

  sanitizeFileName: (fileName: string): string => {
    // Remove dangerous characters and normalize
    return fileName
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .replace(/[^\w.-]/g, '')
      .substring(0, 255);
  },

  validateBatteryData: (data: Partial<AnalysisData>): ValidationResult => {
    return Validator.validate(data, ValidationSchemas.analysisData);
  },

  validateSystemData: (data: Partial<BmsSystem>): ValidationResult => {
    return Validator.validate(data, ValidationSchemas.bmsSystem);
  },

  validateWeatherData: (data: Partial<WeatherData>): ValidationResult => {
    return Validator.validate(data, ValidationSchemas.weatherData);
  },

  validateFileUpload: (file: File): ValidationResult => {
    return Validator.validate({
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    }, ValidationSchemas.fileUpload);
  },
};

export default {
  Validator,
  ValidationSchemas,
  ValidationUtils,
};