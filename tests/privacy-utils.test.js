/**
 * Privacy Utilities Test Suite
 * 
 * Tests for data anonymization and PII stripping functions
 * 
 * @jest-environment node
 */

const { anonymizeSystemProfile, anonymizeFeedback } = require('../netlify/functions/utils/privacy-utils.cjs');

describe('Privacy Utils - anonymizeSystemProfile', () => {
  test('should return null for null input', () => {
    expect(anonymizeSystemProfile(null)).toBeNull();
  });

  test('should return null for undefined input', () => {
    expect(anonymizeSystemProfile(undefined)).toBeNull();
  });

  test('should hash system ID and not include originalId', () => {
    const profile = {
      id: 'system-12345',
      name: 'My Battery System',
      chemistry: 'LiFePO4',
      capacity: 280
    };

    const anonymized = anonymizeSystemProfile(profile);
    
    // ID should be hashed (SHA-256 truncated to 16 chars for better collision resistance)
    expect(anonymized.id).not.toBe('system-12345');
    expect(anonymized.id).toHaveLength(16);
    expect(anonymized.id).toMatch(/^[a-f0-9]{16}$/);
    
    // originalId should NOT be present
    expect(anonymized.originalId).toBeUndefined();
    
    // Other fields should remain
    expect(anonymized.chemistry).toBe('LiFePO4');
    expect(anonymized.capacity).toBe(280);
  });

  test('should generate consistent hash for same ID', () => {
    const profile1 = { id: 'system-12345' };
    const profile2 = { id: 'system-12345' };
    
    const anonymized1 = anonymizeSystemProfile(profile1);
    const anonymized2 = anonymizeSystemProfile(profile2);
    
    expect(anonymized1.id).toBe(anonymized2.id);
  });

  test('should generate different hashes for different IDs', () => {
    const profile1 = { id: 'system-12345' };
    const profile2 = { id: 'system-67890' };
    
    const anonymized1 = anonymizeSystemProfile(profile1);
    const anonymized2 = anonymizeSystemProfile(profile2);
    
    expect(anonymized1.id).not.toBe(anonymized2.id);
  });

  test('should replace name with generic identifier', () => {
    const profile = {
      id: 'system-12345',
      name: 'John Doe Battery System'
    };

    const anonymized = anonymizeSystemProfile(profile);
    
    expect(anonymized.name).not.toBe('John Doe Battery System');
    expect(anonymized.name).toMatch(/^System-[a-f0-9]{6}$/);
  });

  test('should round location coordinates to 2 decimal places', () => {
    const profile = {
      id: 'system-12345',
      location: {
        latitude: 37.7749295,
        longitude: -122.4194155
      }
    };

    const anonymized = anonymizeSystemProfile(profile);
    
    expect(anonymized.location.latitude).toBe(37.77);
    expect(anonymized.location.longitude).toBe(-122.42);
  });

  test('should handle location with only latitude', () => {
    const profile = {
      location: {
        latitude: 37.7749295
      }
    };

    const anonymized = anonymizeSystemProfile(profile);
    
    expect(anonymized.location.latitude).toBe(37.77);
    expect(anonymized.location.longitude).toBeUndefined();
  });

  test('should handle location with only longitude', () => {
    const profile = {
      location: {
        longitude: -122.4194155
      }
    };

    const anonymized = anonymizeSystemProfile(profile);
    
    expect(anonymized.location.latitude).toBeUndefined();
    expect(anonymized.location.longitude).toBe(-122.42);
  });

  test('should handle location with non-numeric values', () => {
    const profile = {
      location: {
        latitude: 'invalid',
        longitude: null
      }
    };

    const anonymized = anonymizeSystemProfile(profile);
    
    expect(anonymized.location.latitude).toBe('invalid');
    expect(anonymized.location.longitude).toBeNull();
  });

  test('should remove all PII fields', () => {
    const profile = {
      id: 'system-12345',
      userId: 'user-123',
      owner: 'John Doe',
      email: 'john@example.com',
      phone: '+1234567890',
      address: '123 Main St',
      wifiSsid: 'HomeNetwork',
      chemistry: 'LiFePO4'
    };

    const anonymized = anonymizeSystemProfile(profile);
    
    expect(anonymized.userId).toBeUndefined();
    expect(anonymized.owner).toBeUndefined();
    expect(anonymized.email).toBeUndefined();
    expect(anonymized.phone).toBeUndefined();
    expect(anonymized.address).toBeUndefined();
    expect(anonymized.wifiSsid).toBeUndefined();
    
    // Non-PII fields should remain
    expect(anonymized.chemistry).toBe('LiFePO4');
  });

  test('should not mutate original profile object', () => {
    const original = {
      id: 'system-12345',
      name: 'My System',
      userId: 'user-123',
      location: {
        latitude: 37.7749295,
        longitude: -122.4194155
      }
    };

    const originalCopy = JSON.parse(JSON.stringify(original));
    const anonymized = anonymizeSystemProfile(original);
    
    // Original should be unchanged
    expect(original).toEqual(originalCopy);
    
    // Anonymized should be different
    expect(anonymized.id).not.toBe(original.id);
    expect(anonymized.name).not.toBe(original.name);
    expect(anonymized.userId).toBeUndefined();
  });

  test('should handle deeply nested objects with PII', () => {
    const profile = {
      id: 'system-12345',
      metadata: {
        owner: 'John Doe',
        settings: {
          email: 'john@example.com'
        }
      }
    };

    const anonymized = anonymizeSystemProfile(profile);
    
    // Deep copy ensures nested PII removal won't affect original
    expect(anonymized.metadata).toBeDefined();
    expect(anonymized.metadata.owner).toBe('John Doe'); // Not in root-level PII fields
    expect(anonymized.metadata.settings.email).toBe('john@example.com'); // Not in root-level PII fields
  });

  test('should handle profile with missing optional fields', () => {
    const profile = {
      chemistry: 'LiFePO4',
      capacity: 280
    };

    const anonymized = anonymizeSystemProfile(profile);
    
    expect(anonymized.chemistry).toBe('LiFePO4');
    expect(anonymized.capacity).toBe(280);
    expect(anonymized.id).toBeUndefined();
    expect(anonymized.name).toBeUndefined();
  });
});

describe('Privacy Utils - anonymizeFeedback', () => {
  test('should return null for null input', () => {
    expect(anonymizeFeedback(null)).toBeNull();
  });

  test('should return null for undefined input', () => {
    expect(anonymizeFeedback(undefined)).toBeNull();
  });

  test('should remove userId from feedback', () => {
    const feedback = {
      userId: 'user-123',
      rating: 5,
      comment: 'Great analysis!'
    };

    const anonymized = anonymizeFeedback(feedback);
    
    expect(anonymized.userId).toBeUndefined();
    expect(anonymized.rating).toBe(5);
    expect(anonymized.comment).toBe('Great analysis!');
  });

  test('should remove userEmail from feedback', () => {
    const feedback = {
      userEmail: 'user@example.com',
      rating: 5,
      comment: 'Great analysis!'
    };

    const anonymized = anonymizeFeedback(feedback);
    
    expect(anonymized.userEmail).toBeUndefined();
    expect(anonymized.rating).toBe(5);
    expect(anonymized.comment).toBe('Great analysis!');
  });

  test('should remove both userId and userEmail', () => {
    const feedback = {
      userId: 'user-123',
      userEmail: 'user@example.com',
      rating: 5,
      comment: 'Great analysis!'
    };

    const anonymized = anonymizeFeedback(feedback);
    
    expect(anonymized.userId).toBeUndefined();
    expect(anonymized.userEmail).toBeUndefined();
    expect(anonymized.rating).toBe(5);
    expect(anonymized.comment).toBe('Great analysis!');
  });

  test('should not mutate original feedback object (deep copy)', () => {
    const original = {
      userId: 'user-123',
      rating: 5,
      metadata: {
        timestamp: '2024-01-01',
        source: 'web'
      }
    };

    const originalCopy = JSON.parse(JSON.stringify(original));
    const anonymized = anonymizeFeedback(original);
    
    // Original should be unchanged
    expect(original).toEqual(originalCopy);
    
    // Anonymized should be different
    expect(anonymized.userId).toBeUndefined();
    
    // Nested objects should be independent
    anonymized.metadata.source = 'mobile';
    expect(original.metadata.source).toBe('web');
  });

  test('should handle nested objects in feedback', () => {
    const feedback = {
      userId: 'user-123',
      details: {
        insightId: 'insight-456',
        nested: {
          userEmail: 'nested@example.com'
        }
      }
    };

    const anonymized = anonymizeFeedback(feedback);
    
    expect(anonymized.userId).toBeUndefined();
    expect(anonymized.details.insightId).toBe('insight-456');
    // Deep nested userEmail is removed (top-level check)
    // But nested one remains since it's not at root level
    expect(anonymized.details.nested.userEmail).toBe('nested@example.com');
  });

  test('should handle feedback with no PII fields', () => {
    const feedback = {
      rating: 5,
      comment: 'Great analysis!',
      timestamp: '2024-01-01'
    };

    const anonymized = anonymizeFeedback(feedback);
    
    expect(anonymized.rating).toBe(5);
    expect(anonymized.comment).toBe('Great analysis!');
    expect(anonymized.timestamp).toBe('2024-01-01');
  });

  test('should ensure deep copy prevents mutation of nested objects', () => {
    const feedback = {
      userId: 'user-123',
      nested: {
        data: {
          value: 'original'
        }
      }
    };

    const anonymized = anonymizeFeedback(feedback);
    
    // Mutate nested object in anonymized version
    anonymized.nested.data.value = 'modified';
    
    // Original should be unchanged (proves deep copy)
    expect(feedback.nested.data.value).toBe('original');
  });
});

describe('Privacy Utils - Edge Cases', () => {
  test('should handle empty objects', () => {
    const profile = {};
    const anonymized = anonymizeSystemProfile(profile);
    
    expect(anonymized).toEqual({});
  });

  test('should handle feedback with empty objects', () => {
    const feedback = {};
    const anonymized = anonymizeFeedback(feedback);
    
    expect(anonymized).toEqual({});
  });

  test('should handle profile with null values', () => {
    const profile = {
      id: null,
      name: null,
      location: null,
      userId: null
    };

    const anonymized = anonymizeSystemProfile(profile);
    
    expect(anonymized.id).toBeNull();
    expect(anonymized.name).toBeNull();
    expect(anonymized.location).toBeNull();
    // When the field exists with null value, delete makes it undefined or stays null
    expect([undefined, null]).toContain(anonymized.userId);
  });

  test('should verify anonymization is irreversible', () => {
    const profile = {
      id: 'system-secret-12345',
      name: 'John Doe Confidential System'
    };

    const anonymized = anonymizeSystemProfile(profile);
    
    // Verify we can't reverse engineer the original ID
    expect(anonymized.id).not.toContain('secret');
    expect(anonymized.id).not.toContain('12345');
    expect(anonymized.name).not.toContain('John');
    expect(anonymized.name).not.toContain('Doe');
    expect(anonymized.name).not.toContain('Confidential');
  });
});
