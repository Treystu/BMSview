
const { extractHardwareSystemId } = require('../netlify/functions/extract-hardware-id.cjs');
// Mocking database and context would be complex for integration test of pipeline.
// We will focus on unit testing the extraction and the matching logic if possible.

describe('System ID Association Logic', () => {

    describe('extractHardwareSystemId', () => {
        test('extracts standard System ID', () => {
            const text = "System ID: BMS-12345";
            const ids = extractHardwareSystemId(text);
            expect(ids).toContain('BMS-12345');
        });

        test('extracts DL Number as fallback', () => {
            // Logic was updated to better ignore "Number" text
            const text = "DL Number: 9876543210";
            const ids = extractHardwareSystemId(text);
            expect(ids).toContain('9876543210');
        });

        test('ignores noise', () => {
            const text = "Some random text with voltage 12.5V";
            const ids = extractHardwareSystemId(text);
            expect(ids).toHaveLength(0);
        });

        // Add more cases based on regex patterns in the file
    });

    // Note: Testing ensureSystemAssociation requires mocking MongoDB.
    // We can write a test that acts as a manual verification script if run with DB connection,
    // or mocks the DB calls. 
    // For now, we'll verify the extraction logic which is the entry point.
});
