/**
 * Response Validator and Auto-Correction
 * 
 * Validates Gemini responses for proper formatting and automatically
 * requests corrections when needed, preventing user-facing errors.
 */

// Validation constants
const CSV_COLUMN_TOLERANCE = 1; // Allow ±1 column variance to handle quoted commas
const MIN_MARKDOWN_LENGTH = 10; // Minimum characters for valid markdown response
const MIN_CONTENT_LENGTH = 50; // Minimum length for substantial content
const MAX_RESPONSE_SNIPPET_LENGTH = 500; // Max chars to include in correction prompts

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
    const csvRequested = /\b(csv|comma[\s\-.]?separated|spreadsheet)\b/i.test(userPrompt);
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

    // Validate data rows have consistent column counts (allow tolerance for quoted commas)
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue; // Skip empty lines
        
        const cols = lines[i].split(',').length;
        if (Math.abs(cols - headerCols) > CSV_COLUMN_TOLERANCE) {
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
    if (response.trim().length < MIN_MARKDOWN_LENGTH) {
        return {
            valid: false,
            error: `Response is too short (less than ${MIN_MARKDOWN_LENGTH} characters)`,
            formatType: 'markdown'
        };
    }

    // Check for common markdown elements (at least some structure)
    const hasHeaders = /^#{1,6}\s+.+$/m.test(response);
    const hasBullets = /^[\*\-]\s+.+$/m.test(response);
    const hasBold = /\*\*.+\*\*/.test(response);
    const hasContent = response.length > MIN_CONTENT_LENGTH;

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
    prompt += `**YOUR PREVIOUS RESPONSE:**\n${originalResponse.substring(0, MAX_RESPONSE_SNIPPET_LENGTH)}${originalResponse.length > MAX_RESPONSE_SNIPPET_LENGTH ? '...' : ''}\n\n`;
    
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

/**
 * Check if a response contains tool suggestions meant for users
 * (which is prohibited - AI must execute tools itself, not suggest them)
 * @param {string} response - The response text from Gemini
 * @returns {{ containsToolSuggestions: boolean, suggestions: string[] }}
 */
function detectToolSuggestions(response) {
    if (!response || typeof response !== 'string') {
        return { containsToolSuggestions: false, suggestions: [] };
    }

    const suggestions = [];

    // Tool names that should NEVER be suggested to users
    // Using lowercase for case-insensitive matching
    const toolNames = [
        'calculate_energy_budget',
        'predict_battery_trends',
        'request_bms_data',
        'analyze_usage_patterns',
        'getweatherdata',
        'getsolarestimate',
        'getsystemanalytics',
        'get_hourly_soc_predictions'
    ];

    // Build dynamic regex pattern from tool names to avoid duplication
    const toolNamesPattern = toolNames.join('|');

    // Patterns indicating tool suggestions to users (bad!)
    // All patterns use the toolNamesPattern to ensure consistency
    const suggestionPatterns = [
        // Direct suggestions to use tools
        new RegExp(`\\b(use|run|execute|try|utilize)\\s+(the\\s+)?['"\`]?(${toolNamesPattern})`, 'gi'),
        // Recommendation to run tools (specific to known tools)
        new RegExp(`\\b(recommend|suggest|advise)\\s+(using|running|calling|executing)\\s+(the\\s+)?['"\`]?(${toolNamesPattern})`, 'gi'),
        // "you can use" or "you could use" (specific to known tools)
        new RegExp(`\\byou\\s+(can|could|should|might)\\s+use\\s+(the\\s+)?['"\`]?(${toolNamesPattern})`, 'gi'),
        // "using the X tool" (specific to known tools)
        new RegExp(`\\busing\\s+the\\s+['"\`]?(${toolNamesPattern})['"\`]?\\s+(tool|function)`, 'gi'),
        // Backtick tool mentions with "use" nearby (specific to known tools)
        new RegExp(`\\buse\\s+\`(${toolNamesPattern})\``, 'gi'),
        // "I recommend X tool" (specific to known tools)
        new RegExp(`\\bi\\s+recommend\\s+(the\\s+)?['"\`]?(${toolNamesPattern})`, 'gi')
    ];

    // Check for each pattern
    for (const pattern of suggestionPatterns) {
        const matches = response.matchAll(pattern);
        for (const match of matches) {
            const suggestion = match[0];
            // Avoid duplicates
            if (!suggestions.some(s => s.toLowerCase() === suggestion.toLowerCase())) {
                suggestions.push(suggestion);
            }
        }
    }

    // Also check for explicit tool name mentions in recommendation context
    for (const tool of toolNames) {
        // Match patterns like "tool_name with scenario='X'" which indicate suggestions
        const toolInContextPattern = new RegExp(`\\b${tool}\\s+(with|using|to get|to calculate|to predict)`, 'gi');
        const matches = response.matchAll(toolInContextPattern);
        for (const match of matches) {
            const suggestion = match[0];
            if (!suggestions.some(s => s.toLowerCase() === suggestion.toLowerCase())) {
                suggestions.push(suggestion);
            }
        }
    }

    return {
        containsToolSuggestions: suggestions.length > 0,
        suggestions
    };
}

/**
 * Build a correction prompt when AI suggests tools to users
 * @param {string} originalResponse - The response with tool suggestions
 * @param {string[]} detectedSuggestions - List of detected tool suggestions
 * @returns {string} - Correction prompt
 */
function buildToolSuggestionCorrectionPrompt(originalResponse, detectedSuggestions) {
    let prompt = `🚨 CRITICAL ERROR: Your response suggests tools for users to run, but users CANNOT execute tools.\n\n`;
    prompt += `**DETECTED VIOLATIONS:**\n`;
    for (const suggestion of detectedSuggestions.slice(0, 5)) {
        prompt += `- "${suggestion}"\n`;
    }
    prompt += `\n`;
    prompt += `**THE RULE:** You are the ONLY entity that can use tools. Users CANNOT run calculate_energy_budget, predict_battery_trends, etc.\n\n`;
    prompt += `**WHAT TO DO:**\n`;
    prompt += `1. If you need data from a tool, CALL THE TOOL NOW using function calling\n`;
    prompt += `2. Present the RESULTS to the user, not the tool name\n`;
    prompt += `3. NEVER say "use the X tool" or "run Y with parameters" - users literally cannot do this\n\n`;
    prompt += `**YOUR PREVIOUS RESPONSE (excerpt):**\n${originalResponse.substring(0, 400)}...\n\n`;
    prompt += `**INSTRUCTIONS:** Rewrite your response. Either:\n`;
    prompt += `- CALL the necessary tools NOW and include their results, OR\n`;
    prompt += `- Provide analysis based on the data you already have\n`;
    prompt += `- Remove ALL tool suggestions and replace with actual findings or calculations\n`;
    
    return prompt;
}

module.exports = {
    validateResponseFormat,
    buildCorrectionPrompt,
    detectToolSuggestions,
    buildToolSuggestionCorrectionPrompt
};
