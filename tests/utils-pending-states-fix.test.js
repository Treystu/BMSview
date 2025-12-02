/**
 * Test to verify the getIsActualError fix
 * Tests actual behavior instead of implementation details
 */

import { getIsActualError } from '../utils';

describe('Utils getIsActualError Fix', () => {
  test('should treat "Checking for duplicates..." as pending state', () => {
    const result = {
      fileName: 'test.jpg',
      data: null,
      error: 'Checking for duplicates...',
      submittedAt: Date.now()
    };
    expect(getIsActualError(result)).toBe(false);
  });

  test('should treat "Queued for analysis..." as pending state', () => {
    const result = {
      fileName: 'test.jpg',
      data: null,
      error: 'Queued for analysis...',
      submittedAt: Date.now()
    };
    expect(getIsActualError(result)).toBe(false);
  });

  test('should treat "Processing..." as pending state', () => {
    const result = {
      fileName: 'test.jpg',
      data: null,
      error: 'Processing...',
      submittedAt: Date.now()
    };
    expect(getIsActualError(result)).toBe(false);
  });

  test('should treat actual errors as errors', () => {
    const result = {
      fileName: 'test.jpg',
      data: null,
      error: 'Network error',
      submittedAt: Date.now()
    };
    expect(getIsActualError(result)).toBe(true);
  });

  test('should treat null error as not an error', () => {
    const result = {
      fileName: 'test.jpg',
      data: null,
      error: null,
      submittedAt: Date.now()
    };
    expect(getIsActualError(result)).toBe(false);
  });
});
