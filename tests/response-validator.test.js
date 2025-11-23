/**
 * Tests for response-validator.cjs
 * Ensures format validation and correction prompts work correctly
 */

const { validateResponseFormat, buildCorrectionPrompt } = require('../netlify/functions/utils/response-validator.cjs');

describe('Response Validator', () => {
    describe('CSV Validation', () => {
        test('accepts valid CSV', () => {
            const validCSV = `Date,SOC,Voltage,Current
2025-11-23,85.2,52.4,12.5
2025-11-22,82.1,52.2,11.8
2025-11-21,79.3,52.0,10.2`;
            
            const result = validateResponseFormat(validCSV, 'Give me CSV data');
            expect(result.valid).toBe(true);
            expect(result.formatType).toBe('csv');
        });

        test('rejects CSV with inconsistent columns', () => {
            const invalidCSV = `Date,SOC,Voltage,Current
2025-11-23,85.2,52.4,12.5
2025-11-22,82.1`;
            
            const result = validateResponseFormat(invalidCSV, 'Give me CSV data');
            expect(result.valid).toBe(false);
            expect(result.formatType).toBe('csv');
            expect(result.error).toContain('columns');
        });

        test('rejects CSV with no data rows', () => {
            const invalidCSV = `Date,SOC,Voltage`;
            
            const result = validateResponseFormat(invalidCSV, 'Give me CSV data');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('at least');
        });
    });

    describe('Markdown Table Validation', () => {
        test('accepts valid markdown table', () => {
            const validTable = `| Date | SOC | Voltage |
|------|-----|---------|
| 2025-11-23 | 85.2% | 52.4V |
| 2025-11-22 | 82.1% | 52.2V |`;
            
            const result = validateResponseFormat(validTable, 'Give me a table');
            expect(result.valid).toBe(true);
            expect(result.formatType).toBe('table');
        });

        test('rejects table without separator row', () => {
            const invalidTable = `| Date | SOC | Voltage |
| 2025-11-23 | 85.2% | 52.4V |`;
            
            const result = validateResponseFormat(invalidTable, 'Give me a table');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('No markdown table found');
        });

        test('rejects table with mismatched columns', () => {
            const invalidTable = `| Date | SOC | Voltage | Current |
|------|-----|---------|
| 2025-11-23 | 85.2% | 52.4V |`;
            
            const result = validateResponseFormat(invalidTable, 'Give me a table');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('columns');
        });
    });

    describe('JSON Validation', () => {
        test('accepts valid JSON in code block', () => {
            const validJSON = `\`\`\`json
{
  "data": [
    {"date": "2025-11-23", "soc": 85.2},
    {"date": "2025-11-22", "soc": 82.1}
  ]
}
\`\`\``;
            
            const result = validateResponseFormat(validJSON, 'Give me JSON');
            expect(result.valid).toBe(true);
            expect(result.formatType).toBe('json');
        });

        test('accepts valid JSON without code block', () => {
            const validJSON = `{"data": [{"date": "2025-11-23", "soc": 85.2}]}`;
            
            const result = validateResponseFormat(validJSON, 'Give me JSON');
            expect(result.valid).toBe(true);
        });

        test('rejects invalid JSON', () => {
            const invalidJSON = `\`\`\`json
{
  "data": [
    {"date": "2025-11-23", "soc": 85.2},
    {"date": "2025-11-22" "soc": 82.1}
  ]
}
\`\`\``;
            
            const result = validateResponseFormat(invalidJSON, 'Give me JSON');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid JSON');
        });
    });

    describe('Markdown Validation', () => {
        test('accepts valid markdown with headers', () => {
            const validMarkdown = `## Key Findings

**Finding 1:** Battery is healthy

**Finding 2:** Solar is performing well

## Recommendations

1. Monitor SOC levels`;
            
            const result = validateResponseFormat(validMarkdown, 'Analyze my battery');
            expect(result.valid).toBe(true);
            expect(result.formatType).toBe('markdown');
        });

        test('accepts markdown with bullets', () => {
            const validMarkdown = `- Item 1
- Item 2
- Item 3 with **bold** text`;
            
            const result = validateResponseFormat(validMarkdown, 'Give me analysis');
            expect(result.valid).toBe(true);
        });

        test('rejects empty or very short responses', () => {
            const invalidMarkdown = `OK`;
            
            const result = validateResponseFormat(invalidMarkdown, 'Analyze');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('too short');
        });
    });

    describe('Correction Prompt Builder', () => {
        test('builds CSV correction prompt', () => {
            const prompt = buildCorrectionPrompt(
                'Date SOC\n2025-11-23 85.2',
                'Missing comma separators',
                'csv',
                'Give me CSV'
            );
            
            expect(prompt).toContain('formatting issue');
            expect(prompt).toContain('CSV');
            expect(prompt).toContain('Column headers separated by commas');
            expect(prompt).toContain('Example:');
        });

        test('builds table correction prompt', () => {
            const prompt = buildCorrectionPrompt(
                'Date | SOC\n2025-11-23 | 85.2',
                'Missing separator row',
                'table',
                'Give me a table'
            );
            
            expect(prompt).toContain('Markdown Table');
            expect(prompt).toContain('Separator row with dashes');
            expect(prompt).toContain('|------|');
        });

        test('builds JSON correction prompt', () => {
            const prompt = buildCorrectionPrompt(
                '{"data": broken}',
                'Invalid JSON syntax',
                'json',
                'Give me JSON'
            );
            
            expect(prompt).toContain('Valid JSON');
            expect(prompt).toContain('```json');
            expect(prompt).toContain('double quotes');
        });

        test('includes original response snippet', () => {
            const longResponse = 'A'.repeat(1000);
            const prompt = buildCorrectionPrompt(
                longResponse,
                'Format error',
                'markdown',
                'Analyze'
            );
            
            expect(prompt).toContain('YOUR PREVIOUS RESPONSE');
            expect(prompt).toContain('...');  // Truncated
        });
    });

    describe('Format Detection', () => {
        test('detects CSV request keywords', () => {
            expect(validateResponseFormat('test', 'give me csv').formatType).toBe('csv');
            expect(validateResponseFormat('test', 'comma-separated values').formatType).toBe('csv');
            expect(validateResponseFormat('test', 'export to spreadsheet').formatType).toBe('csv');
        });

        test('detects table request keywords', () => {
            expect(validateResponseFormat('test', 'show me a table').formatType).toBe('table');
            expect(validateResponseFormat('test', 'tabular format').formatType).toBe('table');
        });

        test('detects JSON request keywords', () => {
            expect(validateResponseFormat('test', 'give me json').formatType).toBe('json');
            expect(validateResponseFormat('test', 'javascript object').formatType).toBe('json');
        });

        test('defaults to markdown for regular requests', () => {
            expect(validateResponseFormat('## Test', 'analyze my battery').formatType).toBe('markdown');
        });
    });
});
