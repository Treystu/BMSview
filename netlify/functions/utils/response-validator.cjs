/**
 * Response Validator and Auto-Correction
 * 
 * Validates Gemini responses for proper formatting and automatically
 * requests corrections when needed, preventing user-facing errors.
 */

/**
 * Validate response format based on detected intent
 * @param {string} response - The response text from Gemini
 * @param {string} userPrompt - Original user prompt to detect format intent
 * @returns {{ valid: boolean, error?: string, formatType?: string }}
 */
function validateResponseFormat(response, userPrompt = '') {
    if (!response || typeof response !== 'string') {
        return { valid: false, error: 'Response is empty or not a string' };
    }

    // Detect requested format from user prompt
    const csvRequested = /\b(csv|comma.separated|spreadsheet)\b/i.test(userPrompt);
    const tableRequested = /\b(table|tabular)\b/i.test(userPrompt);
    const jsonRequested = /\b(json|javascript object)\b/i.test(userPrompt);

    // Validate based on detected format
    if (csvRequested) {
        return validateCSV(response);
    } else if (tableRequested) {
        return validateMarkdownTable(response);
    } else if (jsonRequested) {
        return validateJSON(response);
    } else {
        // Default markdown validation (lenient - just check it's not completely broken)
        return validateMarkdown(response);
    }
}

/**
 * Validate CSV format
 */
function validateCSV(response) {
    const lines = response.trim().split('\n');
    
    if (lines.length < 2) {
        return { 
            valid: false, 
            error: 'CSV must have at least a header row and one data row',
            formatType: 'csv'
        };
    }

    // Check header row exists
    const headerCols = lines[0].split(',').length;
    if (headerCols === 0) {
        return {
            valid: false,
            error: 'CSV header row is empty or malformed',
            formatType: 'csv'
        };
    }

    // Validate data rows have consistent column counts (allow ±1 for quoted commas)
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue; // Skip empty lines
        
        const cols = lines[i].split(',').length;
        if (Math.abs(cols - headerCols) > 1) {
            return {
                valid: false,
                error: `CSV row ${i + 1} has ${cols} columns, expected ${headerCols}`,
                formatType: 'csv'
            };
        }
    }

    return { valid: true, formatType: 'csv' };
}

/**
 * Validate Markdown table format
 */
function validateMarkdownTable(response) {
    const lines = response.trim().split('\n');
    
    // Look for table pattern: header | separator | data
    let foundTable = false;
    let headerRow = null;
    let separatorRow = null;
    
    for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i].includes('|') && lines[i + 1].includes('---')) {
            foundTable = true;
            headerRow = lines[i];
            separatorRow = lines[i + 1];
            break;
        }
    }

    if (!foundTable) {
        return {
            valid: false,
            error: 'No markdown table found (expected format: | Header | ... | with separator row)',
            formatType: 'table'
        };
    }

    // Count columns in header and separator
    const headerCols = headerRow.split('|').filter(s => s.trim()).length;
    const separatorCols = separatorRow.split('|').filter(s => s.trim()).length;

    if (headerCols !== separatorCols) {
        return {
            valid: false,
            error: `Table header has ${headerCols} columns but separator has ${separatorCols}`,
            formatType: 'table'
        };
    }

    return { valid: true, formatType: 'table' };
}

/**
 * Validate JSON format
 */
function validateJSON(response) {
    // Extract JSON from code blocks if present
    let jsonText = response;
    const codeBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
        jsonText = codeBlockMatch[1];
    }

    try {
        JSON.parse(jsonText);
        return { valid: true, formatType: 'json' };
    } catch (e) {
        return {
            valid: false,
            error: `Invalid JSON: ${e.message}`,
            formatType: 'json'
        };
    }
}

/**
 * Validate Markdown format (lenient)
 */
function validateMarkdown(response) {
    // Very lenient - just check it's not completely empty or broken
    if (response.trim().length < 10) {
        return {
            valid: false,
            error: 'Response is too short (less than 10 characters)',
            formatType: 'markdown'
        };
    }

    // Check for common markdown elements (at least some structure)
    const hasHeaders = /^#{1,6}\s+.+$/m.test(response);
    const hasBullets = /^[\*\-]\s+.+$/m.test(response);
    const hasBold = /\*\*.+\*\*/.test(response);
    const hasContent = response.length > 50;

    if (!hasHeaders && !hasBullets && !hasBold && !hasContent) {
        return {
            valid: false,
            error: 'Response lacks markdown structure (no headers, bullets, or bold text)',
            formatType: 'markdown'
        };
    }

    return { valid: true, formatType: 'markdown' };
}

/**
 * Build a correction prompt for malformed responses
 */
function buildCorrectionPrompt(originalResponse, validationError, formatType, userPrompt) {
    let prompt = `Your previous response had a formatting issue that will cause errors when displayed to the user.\n\n`;
    prompt += `**FORMAT ERROR:** ${validationError}\n\n`;
    prompt += `**YOUR PREVIOUS RESPONSE:**\n${originalResponse.substring(0, 500)}${originalResponse.length > 500 ? '...' : ''}\n\n`;
    
    switch (formatType) {
        case 'csv':
            prompt += `**REQUIRED FORMAT:** CSV (Comma-Separated Values)\n`;
            prompt += `- First line: Column headers separated by commas\n`;
            prompt += `- Data rows: Values separated by commas, one row per line\n`;
            prompt += `- Quote values that contain commas\n`;
            prompt += `- No markdown formatting, no extra text\n`;
            prompt += `- Example:\nDate,SOC,Voltage,Current\n2025-11-23,85.2,52.4,12.5\n2025-11-22,82.1,52.2,11.8\n\n`;
            break;
            
        case 'table':
            prompt += `**REQUIRED FORMAT:** Markdown Table\n`;
            prompt += `- Header row with column names separated by pipes (|)\n`;
            prompt += `- Separator row with dashes (---) between pipes\n`;
            prompt += `- Data rows with values separated by pipes\n`;
            prompt += `- Example:\n| Date | SOC | Voltage |\n|------|-----|--------|\n| 2025-11-23 | 85.2% | 52.4V |\n\n`;
            break;
            
        case 'json':
            prompt += `**REQUIRED FORMAT:** Valid JSON\n`;
            prompt += `- Wrap in \`\`\`json code block\n`;
            prompt += `- Valid JSON syntax (test with JSON.parse)\n`;
            prompt += `- Use double quotes for strings\n`;
            prompt += `- Example:\n\`\`\`json\n{\n  "data": [\n    {"date": "2025-11-23", "soc": 85.2}\n  ]\n}\n\`\`\`\n\n`;
            break;
            
        default: // markdown
            prompt += `**REQUIRED FORMAT:** Well-structured Markdown\n`;
            prompt += `- Use headers (## Section Name)\n`;
            prompt += `- Use bullet points for lists\n`;
            prompt += `- Use **bold** for emphasis\n`;
            prompt += `- Include blank lines between sections\n\n`;
            break;
    }
    
    prompt += `**INSTRUCTIONS:**\n`;
    prompt += `Please rewrite your response using the EXACT format specified above.\n`;
    prompt += `Keep all the same data and insights, just fix the formatting.\n`;
    prompt += `Do not add explanations - just provide the corrected output in the proper format.\n`;
    
    return prompt;
}

module.exports = {
    validateResponseFormat,
    buildCorrectionPrompt
};
