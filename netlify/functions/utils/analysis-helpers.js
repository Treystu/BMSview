const { Type } = require("@google/genai");
const { v4: uuidv4 } = require("uuid");

const getResponseSchema = () => ({
    type: Type.OBJECT,
    properties: {
        dlNumber: { "type": Type.STRING, "nullable": true, "description": "This is the DL Number." },
        timestampFromImage: { "type": Type.STRING, "nullable": true },
        stateOfCharge: { "type": Type.NUMBER, "nullable": true },
        overallVoltage: { "type": Type.NUMBER, "nullable": true },
        current: { "type": Type.NUMBER, "nullable": true },
        remainingCapacity: { "type": Type.NUMBER, "nullable": true },
        fullCapacity: { "type": Type.NUMBER, "nullable": true },
        power: { "type": Type.NUMBER, "nullable": true, "description": "Power in Watts. If in kW, convert to W." },
        chargeMosOn: { "type": Type.BOOLEAN, "nullable": true },
        dischargeMosOn: { "type": Type.BOOLEAN, "nullable": true },
        balanceOn: { "type": Type.BOOLEAN, "nullable": true },
        highestCellVoltage: { "type": Type.NUMBER, "nullable": true },
        lowestCellVoltage: { "type": Type.NUMBER, "nullable": true },
        cellVoltageDifference: { "type": Type.NUMBER, "nullable": true },
        averageCellVoltage: { "type": Type.NUMBER, "nullable": true },
        cellVoltages: { "type": Type.ARRAY, "items": { "type": Type.NUMBER } },
        cycleCount: { "type": Type.NUMBER, "nullable": true },
        temperatures: { "type": Type.ARRAY, "items": { "type": Type.NUMBER }, "description": "Array of temperatures from all sensors like T1, T2." },
        mosTemperature: { "type": Type.NUMBER, "nullable": true },
        serialNumber: { "type": Type.STRING, "nullable": true },
        softwareVersion: { "type": Type.STRING, "nullable": true },
        hardwareVersion: { "type": Type.STRING, "nullable": true },
        snCode: { "type": Type.STRING, "nullable": true },
    }
});

const getImageExtractionPrompt = () => `You are a meticulous data extraction AI. Analyze the provided BMS screenshot and extract its data into a JSON object, strictly following these rules:
1.  **JSON Object Output**: Your entire response MUST be a single, valid JSON object.
2.  **Strict Schema Adherence**: Use the provided schema. If a value isn't visible, use \`null\` for single fields or \`[]\` for arrays.
3.  **Data Extraction**:
    -   \`dlNumber\`: Find 'DL Number',
    -   \`stateOfCharge\`: Extract 'SOC' percentage.
    -   \`overallVoltage\`: Extract 'voltage'.
    -   \`current\`: Extract 'current', preserving negative sign.
    -   \`remainingCapacity\`: Extract 'Remaining Cap'.
    -   \`fullCapacity\`: Extract 'Full Cap'.
    -   \`power\`: Extract Power. If in 'kW', multiply by 1000 for Watts. **IMPORTANT: If the 'current' value is negative, the 'power' value must also be negative.**
    -   \`chargeMosOn\`, \`dischargeMosOn\`, \`balanceOn\`: For each, determine if the corresponding indicator ('Chg MOS', 'Dischg MOS', 'Balance') is on (green, lit) which is \`true\`, or off (grey, unlit) which is \`false\`.
    -   \`temperatures\`: Extract all 'Temp', 'T1', 'T2' values into this array.
    -   \`mosTemperature\`: Extract 'MOS Temp'.
    -   \`cellVoltages\`: ONLY if a numbered list of individual cell voltages exists, populate this array. Otherwise, it MUST be \`[]\`.
4.  **Timestamp Logic (CRITICAL)**:
    -   Find a timestamp within the image itself.
    -   If a full date and time are visible (e.g., "2023-01-01 12:04:00"), extract as "YYYY-MM-DDTHH:MM:SS".
    -   If only time is visible (e.g., "12:04:00"), extract only the time string "12:04:00". Do NOT add a date.
    -   If no timestamp is visible, \`timestampFromImage\` MUST be \`null\`.
5.  **Final Review**: Your entire output must be ONLY the raw JSON object, without any surrounding text, explanations, or markdown formatting like \`\`\`json.`;

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
    const analysis = {
        ...extracted,
        temperature: extracted.temperatures?.[0] || null,
        numTempSensors: extracted.temperatures?.length || 0,
        alerts: [],
        summary: "No summary provided by this model.",
        status: null,
    };
    
    if (analysis.current != null && analysis.power != null && analysis.current < 0 && analysis.power > 0) {
        log('warn', 'Correcting positive power sign for negative current.', { originalPower: analysis.power, current: analysis.current });
        analysis.power = -Math.abs(analysis.power);
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
        const maxVoltage = Math.max(...analysis.cellVoltages);
        const minVoltage = Math.min(...analysis.cellVoltages);
        const difference = maxVoltage - minVoltage;
        
        analysis.highestCellVoltage = maxVoltage;
        analysis.lowestCellVoltage = minVoltage;
        analysis.cellVoltageDifference = difference;
        analysis.averageCellVoltage = analysis.cellVoltages.reduce((a, b) => a + b, 0) / analysis.cellVoltages.length;
        
        if (difference > 0.1) {
            alerts.push(`High cell voltage imbalance: ${difference.toFixed(3)}V`);
            status = 'Warning';
        }
        
        log('debug', 'Cell voltage analysis complete.', { 
            maxVoltage, 
            minVoltage, 
            difference, 
            avgVoltage: analysis.averageCellVoltage 
        });
    }
    
    // Temperature analysis
    if (analysis.temperatures && analysis.temperatures.length > 0) {
        const maxTemp = Math.max(...analysis.temperatures);
        if (maxTemp > 45) {
            alerts.push(`High temperature detected: ${maxTemp}°C`);
            status = 'Warning';
        }
        if (maxTemp > 55) {
            alerts.push(`Critical temperature: ${maxTemp}°C`);
            status = 'Critical';
        }
        
        log('debug', 'Temperature analysis complete.', { maxTemp, alertCount: alerts.length });
    }
    
    // SOC analysis
    if (analysis.stateOfCharge != null) {
        if (analysis.stateOfCharge < 20) {
            alerts.push(`Low battery: ${analysis.stateOfCharge}%`);
            if (status === 'Normal') status = 'Warning';
        }
        if (analysis.stateOfCharge < 10) {
            alerts.push(`Critical battery level: ${analysis.stateOfCharge}%`);
            status = 'Critical';
        }
    }
    
    analysis.alerts = alerts;
    analysis.status = status;
    
    log('info', 'Post-analysis complete.', { status, alertCount: alerts.length });
    return analysis;
};

const parseTimestamp = (timestampFromImage, fileName, log) => {
    log('debug', 'Parsing timestamp.', { timestampFromImage, fileName });
    if (timestampFromImage && /\d{4}[-/]\d{2}[-/]\d{2}/.test(timestampFromImage)) {
        log('debug', 'Using full timestamp from image.', { timestampFromImage });
        return new Date(timestampFromImage);
    }
    const fromFilename = (fileName || '').match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[T _-]?(\d{2})[:.-]?(\d{2})[:.-]?(\d{2})/);
    if (fromFilename) {
        const [, y, m, d, h, min, s] = fromFilename;
        const date = new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`);
        if (!isNaN(date.getTime())) {
            log('debug', 'Parsed date from filename.', { dateFromFilename: date.toISOString() });
            if (timestampFromImage && /^\d{1,2}:\d{2}(:\d{2})?$/.test(timestampFromImage.trim())) {
                log('debug', 'Applying time from image to filename date.', { timeFromImage: timestampFromImage });
                const [timeH, timeM, timeS] = timestampFromImage.split(':').map(Number);
                date.setUTCHours(timeH || 0, timeM || 0, timeS || 0, 0);
            }
            return date;
        }
    }
    log('info', 'No valid timestamp found in image or filename, using current time.');
    return new Date();
};

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

module.exports = {
    getResponseSchema,
    getImageExtractionPrompt,
    cleanAndParseJson,
    mapExtractedToAnalysisData,
    performPostAnalysis,
    parseTimestamp,
    generateAnalysisKey,
};
