/**
 * Targeted tests for the batch duplicate check endpoint and hashing
 */

jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
  getCollection: jest.fn(),
}));

jest.mock('../netlify/functions/utils/unified-deduplication.cjs', () => {
  const actual = jest.requireActual('../netlify/functions/utils/unified-deduplication.cjs');
  return {
    ...actual,
    calculateImageHash: jest.fn(),
    checkNeedsUpgrade: jest.fn().mockReturnValue({ needsUpgrade: false }),
  };
});

const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
const {
  calculateImageHash,
  checkNeedsUpgrade,
} = require('../netlify/functions/utils/unified-deduplication.cjs');

describe('check-duplicates-batch handler', () => {
  let handler;
  let infoSpy;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    handler = require('../netlify/functions/check-duplicates-batch.cjs').handler;
    jest.clearAllMocks();
    infoSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns duplicates and logs hash failures', async () => {
    calculateImageHash.mockImplementation((image) => {
      if (image === 'bad-image') {
        throw new Error('bad base64');
      }
      return `hash-${image}`;
    });
    checkNeedsUpgrade.mockReturnValue({ needsUpgrade: false });

    getCollection.mockResolvedValue({
      find: jest.fn(() => ({
        toArray: jest.fn().mockResolvedValue([
          {
            contentHash: 'hash-good-image',
            _id: 'rec-1',
            timestamp: '2024-01-01T00:00:00Z',
            validationScore: 90,
            extractionAttempts: 1,
          },
        ]),
      })),
    });

    const event = {
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        files: [
          { image: 'good-image', fileName: 'good.png', mimeType: 'image/png' },
          { image: 'bad-image', fileName: 'bad.png', mimeType: 'image/png' },
        ],
      }),
    };

    const response = await handler(event, {});
    expect(response.statusCode).toBe(200);

    const payload = JSON.parse(response.body);
    expect(payload.results).toHaveLength(2);

    const good = payload.results.find((r) => r.fileName === 'good.png');
    expect(good?.isDuplicate).toBe(true);
    expect(good?.recordId).toBe('rec-1');

    const bad = payload.results.find((r) => r.fileName === 'bad.png');
    expect(bad?.error).toBeTruthy();

    // Ensure hash failure was logged
    const warnOutput = warnSpy.mock.calls.map((call) => call.join(' ')).join(' ');
    expect(warnOutput).toContain('HASH_FAILED');
  });
});

describe('calculateImageHash normalization', () => {
  const actualDedup = jest.requireActual('../netlify/functions/utils/unified-deduplication.cjs');

  it('strips data URL prefixes and logs errors', () => {
    const log = { debug: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const base64 = Buffer.from('hello-world').toString('base64');
    const hash = actualDedup.calculateImageHash(`data:image/png;base64,${base64}`, log);
    expect(hash).toHaveLength(64);
    expect(log.debug).toHaveBeenCalled();

    const badHash = actualDedup.calculateImageHash('@@invalid@@', log);
    expect(badHash).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });
});
