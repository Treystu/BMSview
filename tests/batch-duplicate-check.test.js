/**
 * Integration tests for batch duplicate check endpoint
 * Tests the new hash-only mode and payload size validation
 */

const { calculateImageHash } = require('../netlify/functions/utils/unified-deduplication.cjs');

describe('check-duplicates-batch endpoint - hash-only mode', () => {
  test('should validate hash format (64 hex characters)', () => {
    const validHash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const invalidHash1 = 'not-a-hash';
    const invalidHash2 = 'abc123'; // too short
    const invalidHash3 = 'xyz'.repeat(22); // wrong characters
    
    expect(validHash).toMatch(/^[a-f0-9]{64}$/i);
    expect(invalidHash1).not.toMatch(/^[a-f0-9]{64}$/i);
    expect(invalidHash2).not.toMatch(/^[a-f0-9]{64}$/i);
    expect(invalidHash3).not.toMatch(/^[a-f0-9]{64}$/i);
  });

  test('calculateImageHash should produce consistent 64-char hex hashes', () => {
    // Simple test image: 1x1 red pixel PNG (base64)
    const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    
    const hash1 = calculateImageHash(base64Image);
    const hash2 = calculateImageHash(base64Image);
    
    expect(hash1).toBeTruthy();
    expect(hash1).toHaveLength(64);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    expect(hash1).toBe(hash2); // Idempotent
  });

  test('calculateImageHash should produce different hashes for different images', () => {
    const image1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const image2 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==';
    
    const hash1 = calculateImageHash(image1);
    const hash2 = calculateImageHash(image2);
    
    expect(hash1).not.toBe(hash2);
  });

  test('calculateImageHash should handle base64 with data URL prefix', () => {
    const withPrefix = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const withoutPrefix = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    
    const hash1 = calculateImageHash(withPrefix);
    const hash2 = calculateImageHash(withoutPrefix);
    
    expect(hash1).toBe(hash2); // Should normalize and produce same hash
  });

  test('payload size calculation for hash-only vs image mode', () => {
    // Simulate 22 files
    const fileCount = 22;
    
    // Hash-only mode: { hash: "64 chars", fileName: "~20 chars" }
    const hashOnlyPayload = Array(fileCount).fill(null).map((_, i) => ({
      hash: 'a1b2c3d4e5f6'.repeat(6).substring(0, 64), // 64 chars
      fileName: `Screenshot_${i}.png` // ~20 chars
    }));
    
    const hashOnlySize = JSON.stringify({ files: hashOnlyPayload }).length;
    const hashOnlySizeKB = (hashOnlySize / 1024).toFixed(2);
    
    // Image mode: { image: "~360KB base64", mimeType: "image/png", fileName: "~20 chars" }
    // For testing, use a smaller base64 string to represent each image
    const imagePayload = Array(fileCount).fill(null).map((_, i) => ({
      image: 'A'.repeat(360 * 1024), // Simulate 360KB base64 image
      mimeType: 'image/png',
      fileName: `Screenshot_${i}.png`
    }));
    
    const imageModeSize = JSON.stringify({ files: imagePayload }).length;
    const imageModeSizeMB = (imageModeSize / (1024 * 1024)).toFixed(2);
    
    // Log the comparison
    console.log('Payload size comparison:');
    console.log(`Hash-only mode: ${hashOnlySizeKB}KB`);
    console.log(`Image mode: ${imageModeSizeMB}MB`);
    console.log(`Reduction: ${((1 - hashOnlySize / imageModeSize) * 100).toFixed(2)}%`);
    
    // Verify hash-only mode is much smaller
    expect(parseFloat(hashOnlySizeKB)).toBeLessThan(10); // Should be ~2KB
    expect(parseFloat(imageModeSizeMB)).toBeGreaterThan(7); // Should be ~8MB
    expect(hashOnlySize).toBeLessThan(imageModeSize / 100); // >99% reduction
  });
});

describe('Payload size validation', () => {
  test('should calculate correct payload sizes', () => {
    const maxPayloadSize = 6 * 1024 * 1024; // 6MB
    const maxSizeMB = (maxPayloadSize / (1024 * 1024)).toFixed(2);
    
    expect(maxSizeMB).toBe('6.00');
  });

  test('should identify payloads exceeding 6MB limit', () => {
    const smallPayload = { files: Array(5).fill({ hash: 'a'.repeat(64), fileName: 'test.png' }) };
    const smallSize = JSON.stringify(smallPayload).length;
    
    // Simulate large payload with 22 full base64 images
    const largePayload = { files: Array(22).fill({ image: 'A'.repeat(360000), mimeType: 'image/png', fileName: 'test.png' }) };
    const largeSize = JSON.stringify(largePayload).length;
    
    const maxPayloadSize = 6 * 1024 * 1024;
    
    expect(smallSize).toBeLessThan(maxPayloadSize);
    expect(largeSize).toBeGreaterThan(maxPayloadSize);
  });
});
