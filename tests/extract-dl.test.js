/**
 * Tests for extract-hardware-id utility
 */

const { extractHardwareSystemId } = require('../netlify/functions/extract-hardware-id.cjs');

describe('extractHardwareSystemId (STRICT MODE)', () => {
  const log = { info: jest.fn(), debug: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 1. Strict DL Format Compliance
  test('extracts standard DL-prefixed IDs (DL-XXXXX)', () => {
    const text = 'Battery system DL-12345 is operational. Also found DL123456.';
    const ids = extractHardwareSystemId(text, log);

    expect(ids).toContain('DL-12345');
    expect(ids).toContain('DL-123456'); // Normalized with dash added
    expect(ids.length).toBe(2);
  });

  // 2. Labeled IDs
  test('extracts IDs with "System ID" or "DL Number" labels', () => {
    const text = 'System ID: 987654. DL Number 555666.';
    const ids = extractHardwareSystemId(text, log);
    expect(ids).toContain('987654');
    expect(ids).toContain('555666');
  });

  test('extracts S/N labeled IDs', () => {
    const text = "S/N: ABCDE12345";
    const ids = extractHardwareSystemId(text, log);
    expect(ids).toContain('ABCDE12345');
  });

  // 3. Strict Rejection of False Positives
  test('ignores plain numbers without context', () => {
    const text = 'Voltage is 54123 and current is 12345.';
    const ids = extractHardwareSystemId(text, log);
    expect(ids).toEqual([]); // Should NOT capture 54123 or 12345
  });

  test('ignores short IDs (under 5 chars)', () => {
    const text = 'DL-123 and System ID: 999';
    const ids = extractHardwareSystemId(text, log);
    expect(ids).toEqual([]); // Too short, likely noise
  });

  test('ignores unlabeled generic strings', () => {
    const text = "Just some text AB-12345 without a label.";
    const ids = extractHardwareSystemId(text, log);
    expect(ids).toEqual([]);
  });

  // 4. Edge Cases
  test('handles messy OCR spacing for labeled IDs', () => {
    const text = 'System   ID :  12345-ABCDE';
    const ids = extractHardwareSystemId(text, log);
    expect(ids).toContain('12345-ABCDE');
  });

  test('handles complex multi-match', () => {
    const text = "ID: DL-10101 and S/N 20202. Ignored 30303.";
    const ids = extractHardwareSystemId(text, log);
    expect(ids).toContain('DL-10101');
    expect(ids).toContain('20202');
    expect(ids).not.toContain('30303');
  });
});
