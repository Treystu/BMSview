/**
 * Provides the prompt and schema for the Gemini API call.
 */
const { Type } = require("@google/genai");

// This is the JSON schema Gemini will be forced to output.
// MANDATORY FIELDS are marked as required (not nullable) to ensure they're always extracted
const getResponseSchema = () => ({
    type: Type.OBJECT,
    properties: {
        // MANDATORY FIELDS - These must always be extracted
        dlNumber: { "type": Type.STRING, "nullable": false, "description": "MANDATORY: The DL Number. If not visible, use 'UNKNOWN'." },
        stateOfCharge: { "type": Type.NUMBER, "nullable": false, "description": "MANDATORY: SOC percentage. Extract from 'SOC' field." },
        overallVoltage: { "type": Type.NUMBER, "nullable": false, "description": "MANDATORY: Overall battery voltage." },
        current: { "type": Type.NUMBER, "nullable": false, "description": "MANDATORY: Current in Amps. CRITICAL: Preserve negative sign if discharging." },
        remainingCapacity: { "type": Type.NUMBER, "nullable": false, "description": "MANDATORY: Remaining capacity in Ah from 'Remaining Cap' field." },
        chargeMosOn: { "type": Type.BOOLEAN, "nullable": false, "description": "MANDATORY: Charge MOS status (true=on/green, false=off/grey)." },
        dischargeMosOn: { "type": Type.BOOLEAN, "nullable": false, "description": "MANDATORY: Discharge MOS status (true=on/green, false=off/grey)." },
        balanceOn: { "type": Type.BOOLEAN, "nullable": false, "description": "MANDATORY: Balance status (true=on/green, false=off/grey)." },
        highestCellVoltage: { "type": Type.NUMBER, "nullable": false, "description": "MANDATORY: Maximum cell voltage. Calculate from cellVoltages if needed." },
        lowestCellVoltage: { "type": Type.NUMBER, "nullable": false, "description": "MANDATORY: Minimum cell voltage. Calculate from cellVoltages if needed." },
        averageCellVoltage: { "type": Type.NUMBER, "nullable": false, "description": "MANDATORY: Average cell voltage. Calculate from cellVoltages if needed." },
        cellVoltageDifference: { "type": Type.NUMBER, "nullable": false, "description": "MANDATORY: Voltage difference in V. If in mV, convert to V by dividing by 1000." },
        cycleCount: { "type": Type.NUMBER, "nullable": false, "description": "MANDATORY: Cycle count. If not visible, use 0." },
        power: { "type": Type.NUMBER, "nullable": false, "description": "MANDATORY: Power in Watts. If in kW, convert to W. If current is negative, power MUST be negative." },
        
        // OPTIONAL FIELDS
        timestampFromImage: { "type": Type.STRING, "nullable": true },
        fullCapacity: { "type": Type.NUMBER, "nullable": true, "description": "The 'Full Cap' or 'Design Cap' value." },
        cellVoltages: { "type": Type.ARRAY, "items": { "type": Type.NUMBER }, "description": "ONLY if a numbered list of individual cells exists. Otherwise, must be []." },
        temperatures: { "type": Type.ARRAY, "items": { "type": Type.NUMBER }, "description": "Array of temperatures from all sensors like T1, T2. If only 'Temp' exists, use that." },
        mosTemperature: { "type": Type.NUMBER, "nullable": true, "description": "The 'MOS Temperature'." },
        serialNumber: { "type": Type.STRING, "nullable": true },
        softwareVersion: { "type": Type.STRING, "nullable": true },
        hardwareVersion: { "type": Type.STRING, "nullable": true },
        snCode: { "type": Type.STRING, "nullable": true },
    },
    required: ["dlNumber", "stateOfCharge", "overallVoltage", "current", "remainingCapacity", 
               "chargeMosOn", "dischargeMosOn", "balanceOn", "highestCellVoltage", 
               "lowestCellVoltage", "averageCellVoltage", "cellVoltageDifference", "cycleCount", "power"]
});

// This is the system prompt sent to Gemini with the image.
// If previousFeedback is provided, it's a retry attempt with validation feedback
const getImageExtractionPrompt = (previousFeedback = null) => {
    let basePrompt = `You are a meticulous data extraction AI. Analyze the provided BMS screenshot and extract its data into a JSON object, strictly following these rules:`;
    
    // If this is a retry, inject feedback at the top
    if (previousFeedback) {
        basePrompt = `${previousFeedback}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${basePrompt}`;
    }
    
    return basePrompt + `

**CRITICAL: MANDATORY FIELDS**
The following fields are MANDATORY and MUST ALWAYS be extracted. If a field is not clearly visible, use these defaults:
- dlNumber: If not visible, use "UNKNOWN"
- stateOfCharge: If not visible, use 0
- overallVoltage: If not visible, use 0
- current: If not visible, use 0
- remainingCapacity: If not visible, use 0
- chargeMosOn: If not visible, use false
- dischargeMosOn: If not visible, use false
- balanceOn: If not visible, use false
- highestCellVoltage: Calculate from cellVoltages array if available, otherwise use 0
- lowestCellVoltage: Calculate from cellVoltages array if available, otherwise use 0
- averageCellVoltage: Calculate from cellVoltages array if available, otherwise use 0
- cellVoltageDifference: Calculate as (highestCellVoltage - lowestCellVoltage), or extract from 'voltage difference' field
- cycleCount: If not visible, use 0
- power: If not visible, calculate as (current × overallVoltage), otherwise use 0

1.  **JSON Object Output**: Your entire response MUST be a single, valid JSON object.
2.  **Strict Schema Adherence**: MANDATORY fields must NEVER be null. Optional fields can be null or [] for arrays.
3.  **Data Extraction Rules**:
    -   \`dlNumber\`: Find 'DL Number' or similar identifier at the top. NEVER leave this null.
    -   \`stateOfCharge\`: Extract 'SOC' percentage. MANDATORY.
    -   \`overallVoltage\`: Extract 'voltage' or 'Total Voltage'. MANDATORY.
    -   \`current\`: Extract 'current'. **CRITICAL: Preserve the negative sign if it exists.** A negative sign indicates discharge. MANDATORY.
    -   \`remainingCapacity\`: Extract 'Remaining Cap' or 'remaining capacity'. MANDATORY.
    -   \`fullCapacity\`: Extract 'Full Cap' or 'full capacity'. Optional.
    -   \`power\`: Extract 'Power'. If in 'kW', multiply by 1000 for Watts. **IMPORTANT: If the 'current' value is negative, the 'power' value MUST also be negative.** MANDATORY.
    -   \`chargeMosOn\`, \`dischargeMosOn\`, \`balanceOn\`: For each, determine if the indicator ('Chg MOS', 'Dischg MOS', 'Balance') is on (green, lit) which is \`true\`, or off (grey, unlit) which is \`false\`. MANDATORY.
    -   \`highestCellVoltage\`, \`lowestCellVoltage\`, \`averageCellVoltage\`: Extract these from the display OR calculate from cellVoltages array. MANDATORY.
    -   \`cellVoltageDifference\`: Extract 'voltage difference'. **If the unit is 'mV', divide by 1000 to convert to 'V'.** The schema requires Volts. MANDATORY.
    -   \`cycleCount\`: Extract 'Cycle' or 'Cycles'. MANDATORY.
    -   \`temperatures\`: Extract all 'Temp', 'T1', 'T2' values into this array. Optional.
    -   \`mosTemperature\`: Extract 'MOS Temperature' or 'MOS'. Optional.
    -   \`cellVoltages\`: ONLY if a numbered list of individual cell voltages exists, populate this array. Otherwise, it MUST be \`[]\`.
4.  **Cell Voltage Calculations**: If cellVoltages array has values, you MUST calculate highestCellVoltage, lowestCellVoltage, averageCellVoltage, and cellVoltageDifference from it.
5.  **Timestamp Logic (CRITICAL)**:
    -   Find a timestamp within the image itself.
    -   If a full date and time are visible (e.g., "2023-01-01 12:04:00"), extract as "YYYY-MM-DDTHH:MM:SS".
    -   If only time is visible (e.g., "12:04:00"), extract only the time string "12:04:00". Do NOT add a date.
    -   If no timestamp is visible, \`timestampFromImage\` MUST be \`null\`.
6.  **Final Review**: Your entire output must be ONLY the raw JSON object, without any surrounding text, explanations, or markdown formatting like \`\`\`json. ALL MANDATORY FIELDS MUST HAVE VALUES.`;
};

// --- Utility Functions (Copied from original) ---

const cleanAndParseJson = (text, log) => {
    if (!text) {
        log('error', 'The AI model returned an empty response.');
        throw new Error("The AI model returned an empty response.");
    }

    log('debug', 'Raw AI response received.', { length: text.length, preview: text.substring(0, 200) });

    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');

    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
        log('error', 'AI response did not contain a valid JSON object.', { responseText: text });
        throw new Error(`AI response did not contain a valid JSON object. Response: ${text}`);
    }

    const jsonString = text.substring(jsonStart, jsonEnd + 1);

    try {
        const parsed = JSON.parse(jsonString);
        log('debug', 'Successfully parsed JSON from AI response.', { parsedKeys: Object.keys(parsed) });
        return parsed;
    } catch (e) {
        log('error', 'Failed to parse cleaned JSON string.', { error: e.message, cleanedJsonString: jsonString });
        throw new Error(`Failed to parse JSON from AI response. See logs for details.`);
    }
};

const mapExtractedToAnalysisData = (extracted, log) => {
    if (!extracted || typeof extracted !== 'object') {
        log('error', 'Extracted data is invalid, cannot map to AnalysisData.', { extractedData: extracted });
        return null;
    }
    log('debug', 'Mapping extracted data to analysis schema.', { extractedKeys: Object.keys(extracted) });
    
    // Ensure all mandatory fields have values (apply defaults if missing)
    const analysis = {
        // Mandatory fields with defaults - use ?? to only default on null/undefined
        dlNumber: extracted.dlNumber || 'UNKNOWN', // string, so || is fine
        stateOfCharge: extracted.stateOfCharge ?? 0,
        overallVoltage: extracted.overallVoltage ?? 0,
        current: extracted.current ?? 0,
        remainingCapacity: extracted.remainingCapacity ?? 0,
        chargeMosOn: extracted.chargeMosOn ?? false,
        dischargeMosOn: extracted.dischargeMosOn ?? false,
        balanceOn: extracted.balanceOn ?? false,
        highestCellVoltage: extracted.highestCellVoltage ?? 0,
        lowestCellVoltage: extracted.lowestCellVoltage ?? 0,
        averageCellVoltage: extracted.averageCellVoltage ?? 0,
        cellVoltageDifference: extracted.cellVoltageDifference ?? 0,
        cycleCount: extracted.cycleCount ?? 0,
        power: extracted.power ?? 0,
        
        // Optional fields
        timestampFromImage: extracted.timestampFromImage || null,
        fullCapacity: extracted.fullCapacity || null,
        cellVoltages: extracted.cellVoltages || [],
        temperatures: extracted.temperatures || [],
        mosTemperature: extracted.mosTemperature || null,
        serialNumber: extracted.serialNumber || null,
        softwareVersion: extracted.softwareVersion || null,
        hardwareVersion: extracted.hardwareVersion || null,
        snCode: extracted.snCode || null,
        
        // Derived fields
        temperature: extracted.temperatures?.[0] || null,
        numTempSensors: extracted.temperatures?.length || 0,
        alerts: [], // Alerts are generated in the next step
        summary: "No summary provided by this model.", // Summary is generated on-demand by client
        status: null, // Status is generated in the next step
    };

    // Auto-correct power sign if Gemini misses it
    if (analysis.current != null && analysis.power != null && analysis.current < 0 && analysis.power > 0) {
        log('warn', 'Correcting positive power sign for negative current.', { originalPower: analysis.power, current: analysis.current });
        analysis.power = -Math.abs(analysis.power);
    }
    
    // Calculate power if it's zero but we have current and voltage
    if (analysis.power === 0 && analysis.current !== 0 && analysis.overallVoltage !== 0) {
        analysis.power = analysis.current * analysis.overallVoltage;
        log('info', 'Calculated power from current and voltage.', { power: analysis.power });
    }

    // Auto-correct cell difference if Gemini returns mV
    if (analysis.cellVoltageDifference != null && analysis.cellVoltageDifference > 1) {
        log('warn', 'Correcting large cell voltage difference (likely mV). Converting to V.', { originalDiff: analysis.cellVoltageDifference });
        analysis.cellVoltageDifference = analysis.cellVoltageDifference / 1000.0;
    }
    
    // Calculate cell voltage statistics if we have cell voltages but missing stats
    if (analysis.cellVoltages && analysis.cellVoltages.length > 0) {
        if (analysis.highestCellVoltage === 0) {
            analysis.highestCellVoltage = Math.max(...analysis.cellVoltages);
            log('info', 'Calculated highestCellVoltage from cellVoltages array.', { value: analysis.highestCellVoltage });
        }
        if (analysis.lowestCellVoltage === 0) {
            analysis.lowestCellVoltage = Math.min(...analysis.cellVoltages);
            log('info', 'Calculated lowestCellVoltage from cellVoltages array.', { value: analysis.lowestCellVoltage });
        }
        if (analysis.averageCellVoltage === 0) {
            analysis.averageCellVoltage = analysis.cellVoltages.reduce((a, b) => a + b, 0) / analysis.cellVoltages.length;
            log('info', 'Calculated averageCellVoltage from cellVoltages array.', { value: analysis.averageCellVoltage });
        }
        if (analysis.cellVoltageDifference === 0) {
            analysis.cellVoltageDifference = analysis.highestCellVoltage - analysis.lowestCellVoltage;
            log('info', 'Calculated cellVoltageDifference from min/max values.', { value: analysis.cellVoltageDifference });
        }
    }

    log('debug', 'Mapped analysis data.', { analysisKeys: Object.keys(analysis) });
    return analysis;
};

const performPostAnalysis = (analysis, system, log) => {
    log('debug', 'Performing post-analysis calculations.', { hasSystem: !!system });

    if (!analysis) return null;

    const alerts = [];
    let status = 'Normal';

    // Cell voltage analysis
    if (analysis.cellVoltages && analysis.cellVoltages.length > 0) {
        // If helper fields are null, calculate them from the array
        if (analysis.highestCellVoltage == null) {
            analysis.highestCellVoltage = Math.max(...analysis.cellVoltages);
        }
        if (analysis.lowestCellVoltage == null) {
            analysis.lowestCellVoltage = Math.min(...analysis.cellVoltages);
        }
        if (analysis.averageCellVoltage == null) {
            analysis.averageCellVoltage = analysis.cellVoltages.reduce((a, b) => a + b, 0) / analysis.cellVoltages.length;
        }
        if (analysis.cellVoltageDifference == null) {
            analysis.cellVoltageDifference = analysis.highestCellVoltage - analysis.lowestCellVoltage;
        }
    }

    if (analysis.cellVoltageDifference != null) {
        if (analysis.cellVoltageDifference > 0.1) { // 100mV
            alerts.push(`CRITICAL: High cell voltage imbalance: ${(analysis.cellVoltageDifference * 1000).toFixed(1)}mV`);
            status = 'Critical';
        } else if (analysis.cellVoltageDifference > 0.05) { // 50mV
            alerts.push(`WARNING: Cell voltage imbalance detected: ${(analysis.cellVoltageDifference * 1000).toFixed(1)}mV`);
            if (status === 'Normal') status = 'Warning';
        }
    }

    // Temperature analysis
    if (analysis.temperatures && analysis.temperatures.length > 0) {
        const maxTemp = Math.max(...analysis.temperatures, (analysis.mosTemperature || -Infinity));
        if (maxTemp > 55) {
            alerts.push(`CRITICAL: High temperature detected: ${maxTemp}°C`);
            status = 'Critical';
        } else if (maxTemp > 45) {
            alerts.push(`WARNING: High temperature detected: ${maxTemp}°C`);
            if (status === 'Normal') status = 'Warning';
        }
        if (analysis.mosTemperature && analysis.mosTemperature > 80) {
            alerts.push(`CRITICAL: MOS temperature is very high: ${analysis.mosTemperature}°C`);
            status = 'Critical';
        }
    }

    // SOC analysis
    if (analysis.stateOfCharge != null) {
        if (analysis.stateOfCharge < 10) {
            alerts.push(`CRITICAL: Battery level is critical: ${analysis.stateOfCharge}%`);
            status = 'Critical';
        } else if (analysis.stateOfCharge < 20) {
            alerts.push(`WARNING: Low battery: ${analysis.stateOfCharge}%`);
            if (status === 'Normal') status = 'Warning';
        }
    }

    analysis.alerts = alerts;
    analysis.status = status;

    log('info', 'Post-analysis complete.', { status, alertCount: alerts.length });
    return analysis;
};

const parseTimestamp = (timestampFromImage, fileName, log) => {
    log('debug', 'Parsing timestamp.', { timestampFromImage, fileName });
    try {
        // 1. Try to use timestamp from image if it's a full ISO-like string
        if (timestampFromImage && /\d{4}[-/]\d{2}[-/]\d{2}T\d{2}:\d{2}:\d{2}/.test(timestampFromImage)) {
            const date = new Date(timestampFromImage);
            if (!isNaN(date.getTime())) {
                log('debug', 'Using full timestamp from image.', { timestampFromImage });
                return date;
            }
        }

        // 2. Try to parse from filename (e.g., Screenshot_20251020-093318.png)
        const fromFilename = (fileName || '').match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[T _-]?(\d{2})[:.-]?(\d{2})[:.-]?(\d{2})/);
        if (fromFilename) {
            const [, y, m, d, h, min, s] = fromFilename;
            const date = new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`); // Assume UTC from filename
            if (!isNaN(date.getTime())) {
                log('debug', 'Parsed date from filename.', { dateFromFilename: date.toISOString() });

                // 3. If filename gave date, check if image gave a valid *time* to override
                if (timestampFromImage && /^\d{1,2}:\d{2}(:\d{2})?$/.test(timestampFromImage.trim())) {
                    log('debug', 'Applying time from image to filename date.', { timeFromImage: timestampFromImage });
                    const [timeH, timeM, timeS] = timestampFromImage.split(':').map(Number);
                    date.setUTCHours(timeH || 0, timeM || 0, timeS || 0, 0);
                }
                return date;
            }
        }
    } catch (e) {
        log('warn', 'Error during timestamp parsing.', { error: e.message });
    }

    log('info', 'No valid timestamp found in image or filename, using current time.');
    return new Date(); // Fallback to current time
};

// This is still useful for *detecting* duplicates, even if we don't save it.
const generateAnalysisKey = (analysis) => {
    if (!analysis) return null;
    try {
        const keyParts = [
            analysis.dlNumber || 'nodl',
            (analysis.overallVoltage != null ? analysis.overallVoltage.toFixed(2) : 'nov'),
            (analysis.current != null ? analysis.current.toFixed(2) : 'noc'),
            (analysis.stateOfCharge != null ? analysis.stateOfCharge.toFixed(1) : 'nosoc'),
            (analysis.cellVoltages && analysis.cellVoltages.length > 0 ? [...analysis.cellVoltages].sort().map(v => v.toFixed(3)).join(',') : 'nocells'),
            (analysis.temperatures && analysis.temperatures.length > 0 ? [...analysis.temperatures].sort().map(t => t.toFixed(1)).join(',') : 'notemps'),
            (analysis.cycleCount != null ? analysis.cycleCount : 'nocycle'),
            (analysis.remainingCapacity != null ? analysis.remainingCapacity.toFixed(2) : 'norc')
        ];
        return keyParts.join('|');
    } catch (e) {
        console.error("Error generating analysis key", e, { analysisData: analysis });
        return `error_${uuidv4()}`;
    }
};

/**
 * Intelligently merge two analysis objects
 * Prefers non-null, non-empty values from newAnalysis
 * Falls back to oldAnalysis values if new ones are missing
 * @param {Object} oldAnalysis - Existing analysis data
 * @param {Object} newAnalysis - New analysis data from re-analysis
 * @param {Function} log - Logger function
 * @returns {Object} Merged analysis object
 */
const mergeAnalysisData = (oldAnalysis, newAnalysis, log) => {
    if (!oldAnalysis) return newAnalysis;
    if (!newAnalysis) return oldAnalysis;

    const merged = { ...oldAnalysis };
    let changesCount = 0;

    // Helper to check if a value is "better" (non-null, non-empty)
    const isBetterValue = (newVal, oldVal) => {
        if (newVal === null || newVal === undefined) return false;
        if (typeof newVal === 'string' && newVal.trim() === '') return false;
        if (Array.isArray(newVal) && newVal.length === 0) return false;
        return true;
    };

    // Merge each field
    for (const key in newAnalysis) {
        if (newAnalysis.hasOwnProperty(key)) {
            const newVal = newAnalysis[key];
            const oldVal = oldAnalysis[key];

            // Special handling for arrays (like cellVoltages, temperatures, alerts)
            if (Array.isArray(newVal) && Array.isArray(oldVal)) {
                // Prefer the array with more data
                if (newVal.length > oldVal.length) {
                    merged[key] = newVal;
                    changesCount++;
                } else if (newVal.length === oldVal.length) {
                    // If same length, prefer new values if they're different
                    const isDifferent = JSON.stringify(newVal) !== JSON.stringify(oldVal);
                    if (isDifferent) {
                        merged[key] = newVal;
                        changesCount++;
                    }
                }
                // Otherwise keep old value (it has more data)
            }
            // For other values, prefer new if it's "better"
            else if (isBetterValue(newVal, oldVal)) {
                if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
                    merged[key] = newVal;
                    changesCount++;
                }
            }
            // If new value is not better, keep old value (already in merged)
        }
    }

    log('info', 'Merged analysis data.', { changesCount, totalFields: Object.keys(newAnalysis).length });

    return merged;
};

/**
 * Validate extraction quality and completeness
 * Returns quality metrics and warnings about potentially missing or defaulted data
 * @param {Object} extractedData - Raw data extracted from Gemini
 * @param {Object} analysisData - Mapped analysis data
 * @param {Object} log - Logger instance
 * @returns {Object} Validation result with quality score and warnings
 */
const validateExtractionQuality = (extractedData, analysisData, log) => {
    const warnings = [];
    let qualityScore = 100; // Start at 100 and deduct points for issues
    const criticalFields = ['dlNumber', 'stateOfCharge', 'overallVoltage', 'current', 'remainingCapacity'];
    const importantFields = ['power', 'cycleCount', 'cellVoltageDifference'];
    
    // Check if critical fields have meaningful values (not defaults)
    if (analysisData.dlNumber === 'UNKNOWN') {
        warnings.push('DL Number not detected - defaulted to UNKNOWN');
        qualityScore -= 15;
    }
    
    if (analysisData.stateOfCharge === 0 && analysisData.overallVoltage > 0) {
        warnings.push('State of Charge is 0% but voltage is present - possible extraction error');
        qualityScore -= 20;
    }
    
    if (analysisData.overallVoltage === 0) {
        warnings.push('Overall voltage is 0V - likely extraction failure');
        qualityScore -= 25;
    }
    
    if (analysisData.remainingCapacity === 0 && analysisData.overallVoltage > 0) {
        warnings.push('Remaining capacity is 0Ah - possible extraction error');
        qualityScore -= 15;
    }
    
    // Check for inconsistent data
    if (analysisData.current !== 0 && analysisData.power === 0) {
        warnings.push('Current present but power is 0W - possible calculation issue');
        qualityScore -= 10;
    }
    
    // Check if important fields are defaulted
    if (analysisData.cycleCount === 0) {
        warnings.push('Cycle count is 0 - may not have been detected');
        qualityScore -= 5;
    }
    
    // Check for cell voltage data quality
    if (analysisData.cellVoltages && analysisData.cellVoltages.length > 0) {
        const allSame = analysisData.cellVoltages.every(v => v === analysisData.cellVoltages[0]);
        if (allSame) {
            warnings.push('All cell voltages are identical - possible extraction error');
            qualityScore -= 15;
        }
    } else if (analysisData.overallVoltage > 0) {
        warnings.push('Individual cell voltages not detected - only aggregate data available');
        qualityScore -= 5;
    }
    
    // Temperature data quality
    if (analysisData.temperatures && analysisData.temperatures.length === 0) {
        warnings.push('No temperature sensors detected');
        qualityScore -= 5;
    }
    
    const result = {
        qualityScore: Math.max(0, qualityScore), // Never go below 0
        warnings,
        isComplete: qualityScore >= 70, // Consider complete if score >= 70
        hasCriticalIssues: qualityScore < 50,
        fieldsCaptured: {
            total: Object.keys(analysisData).length,
            withValues: Object.keys(analysisData).filter(k => {
                const val = analysisData[k];
                return val !== null && val !== undefined && val !== 0 && val !== '' && val !== 'UNKNOWN';
            }).length
        }
    };
    
    log('info', 'Data extraction quality validation complete.', {
        qualityScore: result.qualityScore,
        warningCount: warnings.length,
        isComplete: result.isComplete,
        fieldsCaptured: result.fieldsCaptured
    });
    
    if (warnings.length > 0) {
        log('warn', 'Data extraction quality warnings detected.', { warnings });
    }
    
    return result;
};

const getStoryModePrompt = (timeline, title, summary) => {
    return `
You are an expert in battery analysis. You will be given a timeline of BMS data, a title, and a summary.
Your task is to analyze the timeline and provide a detailed, insightful narrative that explains the events that occurred.
Focus on causal relationships and temporal patterns.

**Title:** ${title}
**Summary:** ${summary}

**Timeline:**
${timeline.map((record, index) => `
**Event ${index + 1}:**
- **Timestamp:** ${record.timestamp}
- **SOC:** ${record.analysis.stateOfCharge}%
- **Voltage:** ${record.analysis.overallVoltage}V
- **Current:** ${record.analysis.current}A
- **Power:** ${record.analysis.power}W
`).join('')}

**Analysis:**
`;
};

module.exports = {
    getResponseSchema,
    getImageExtractionPrompt,
    getStoryModePrompt,
    cleanAndParseJson,
    mapExtractedToAnalysisData,
    performPostAnalysis,
    parseTimestamp,
    generateAnalysisKey,
    mergeAnalysisData,
    validateExtractionQuality
};

