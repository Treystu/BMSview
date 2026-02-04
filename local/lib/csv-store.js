/**
 * CSV Storage Module - Stores BMS data in a local CSV file
 * Supports hash-based deduplication and in-place updates
 */

const fs = require('fs');
const path = require('path');
const { getSettings } = require('./settings');
const { validateAndRepairAll, detectCorruption } = require('./data-validator');

// CSV column definitions - order matters for consistent output
const CSV_COLUMNS = [
  'id',
  'contentHash',
  'timestamp',
  'timestampFromFilename',  // Second-level accuracy from filename
  'fileName',
  'hardwareSystemId',
  'stateOfCharge',
  'overallVoltage',
  'current',
  'power',
  'remainingCapacity',
  'fullCapacity',
  'cycleCount',
  'chargeMosOn',
  'dischargeMosOn',
  'balanceOn',
  'highestCellVoltage',
  'lowestCellVoltage',
  'averageCellVoltage',
  'cellVoltageDifference',
  'temperature_1',
  'temperature_2',
  'temperature_3',
  'temperature_4',
  'mosTemperature',
  'cellVoltages',
  'status',
  'alerts',
  'timestampFromImage',
  'serialNumber',
  'softwareVersion',
  'hardwareVersion',
  'snCode',
  // Weather data
  'weather_temp',
  'weather_clouds',
  'weather_uvi',
  'weather_condition',
  // Solar irradiance data (W/m²)
  'solar_ghi',     // Global Horizontal Irradiance - total solar power on horizontal surface
  'solar_dni',     // Direct Normal Irradiance - direct beam on surface perpendicular to sun
  'solar_dhi',     // Diffuse Horizontal Irradiance - scattered sky radiation
  'solar_direct',  // Direct radiation on horizontal surface
  'model_used',
  'cost_usd',
  'needs_reanalysis',  // Flag for records needing re-extraction
  // Verification state system
  'verification_state',  // A=complete, B=partial_needs_verify, C=verified_incomplete, D=inconclusive
  'analysis_count'       // Number of times this record has been analyzed
];

// In-memory cache of records (keyed by contentHash for fast dedup)
let recordsCache = null;
let hashIndex = null;

/**
 * Get the CSV file path
 */
function getCsvPath() {
  const settings = getSettings();
  const outputDir = settings.outputDir || './output';

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  return path.join(outputDir, 'bms-data.csv');
}

/**
 * Escape a value for CSV (handle commas, quotes, newlines)
 */
function escapeCSV(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  // If contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }

  return str;
}

/**
 * Parse a CSV line (handles quoted values)
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }

  values.push(current);
  return values;
}

/**
 * Convert a record object to CSV row
 */
function recordToCSVRow(record) {
  return CSV_COLUMNS.map(col => {
    let value = record[col];

    // Handle temperature array -> individual columns
    if (col.startsWith('temperature_')) {
      const idx = parseInt(col.split('_')[1]) - 1;
      const temps = record.temperatures || [];
      value = temps[idx] !== undefined ? temps[idx] : null;
    }

    // Handle arrays (convert to JSON string)
    if (Array.isArray(value)) {
      value = JSON.stringify(value);
    }

    // Handle booleans
    if (typeof value === 'boolean') {
      value = value ? 'true' : 'false';
    }

    return escapeCSV(value);
  }).join(',');
}

/**
 * Convert CSV row to record object
 */
function csvRowToRecord(values, headers) {
  const record = {};

  headers.forEach((header, idx) => {
    let value = values[idx] || '';

    // Parse JSON arrays
    if (header === 'cellVoltages' || header === 'alerts') {
      try {
        value = value ? JSON.parse(value) : [];
      } catch (e) {
        value = [];
      }
    }
    // Parse numbers
    else if (['stateOfCharge', 'overallVoltage', 'current', 'power', 'remainingCapacity',
      'fullCapacity', 'cycleCount', 'highestCellVoltage', 'lowestCellVoltage',
      'averageCellVoltage', 'cellVoltageDifference', 'mosTemperature',
      'weather_temp', 'weather_clouds', 'weather_uvi',
      'solar_ghi', 'solar_dni', 'solar_dhi', 'solar_direct',
      'temperature_1', 'temperature_2', 'temperature_3', 'temperature_4',
      'analysis_count'].includes(header)) {
      value = value === '' ? null : parseFloat(value);
    }
    // Parse booleans
    else if (['chargeMosOn', 'dischargeMosOn', 'balanceOn', 'needs_reanalysis'].includes(header)) {
      value = value === 'true';
    }

    record[header] = value;
  });

  // Reconstruct temperatures array from individual columns
  record.temperatures = [];
  for (let i = 1; i <= 4; i++) {
    const temp = record[`temperature_${i}`];
    if (temp !== null && temp !== undefined) {
      record.temperatures.push(temp);
    }
  }

  return record;
}

/**
 * Detect if a record has shifted/corrupted columns
 * @param {object} record - The record to check
 * @returns {boolean} True if record appears corrupted
 */
function isRecordCorrupted(record) {
  // If hardwareSystemId looks like a filename, it's corrupted
  if (record.hardwareSystemId && (
    record.hardwareSystemId.includes('.png') ||
    record.hardwareSystemId.includes('.jpg') ||
    record.hardwareSystemId.includes('Screenshot')
  )) {
    return true;
  }

  // If model_used contains weather data, it's corrupted
  if (record.model_used && (
    record.model_used.includes('Clouds') ||
    record.model_used.includes('Clear') ||
    record.model_used.includes('Rain')
  )) {
    return true;
  }

  return false;
}

/**
 * Attempt to repair a corrupted record by detecting column shift
 * The corruption pattern: old data missing timestampFromFilename column,
 * causing all fields from fileName onward to shift left by one position
 * @param {object} record - The corrupted record
 * @returns {object} Repaired record
 */
function repairCorruptedRecord(record) {
  // Check if this record has the shift pattern:
  // - hardwareSystemId contains filename (should be in fileName)
  // - fileName looks like a timestamp (should be timestampFromFilename)

  if (!isRecordCorrupted(record)) {
    return record; // Not corrupted, return as-is
  }

  const repaired = { ...record };

  // The shift pattern: data was inserted without timestampFromFilename column
  // So fileName moved to timestampFromFilename, hardwareSystemId moved to fileName, etc.

  // Current corrupted state:
  // timestampFromFilename: has what should be fileName
  // fileName: has what should be hardwareSystemId (which is the filename!)
  // hardwareSystemId: filename (this IS the filename, confirms corruption)

  // But wait - looking at the actual data:
  // Column 4 (timestampFromFilename): empty or has extracted timestamp
  // Column 5 (fileName): has the timestamp that should be timestampFromFilename
  // Column 6 (hardwareSystemId): has the filename

  // So the fix is:
  // 1. The hardwareSystemId field contains the actual filename
  // 2. We need to extract proper system ID from the data

  // Actually, looking more carefully at the corrupted record:
  // - timestampFromFilename has the extracted timestamp (correct)
  // - fileName has the FILENAME (but shifted from hardwareSystemId position)
  // - hardwareSystemId has the FILENAME

  // The issue is simpler: when these records were created, the analysis
  // didn't extract hardwareSystemId properly, so it defaulted to filename

  // Check if we have the filename in hardwareSystemId
  if (record.hardwareSystemId && record.hardwareSystemId.includes('.png')) {
    // This is a filename, not a system ID
    // The actual filename should be in the fileName field
    // Try to find the real system ID - it might be lost, set to null
    repaired.hardwareSystemId = null;

    // If fileName is empty and hardwareSystemId has the filename, move it
    if (!record.fileName || record.fileName === '') {
      repaired.fileName = record.hardwareSystemId;
    }
  }

  // Fix model_used if it contains weather condition
  if (record.model_used && (
    record.model_used.includes('Clouds') ||
    record.model_used.includes('Clear') ||
    record.model_used.includes('Rain')
  )) {
    // This is weather_condition, not model
    // Try to recover - the model should be gemini-something
    repaired.weather_condition = record.model_used;
    repaired.model_used = null;
  }

  // Mark as repaired
  repaired._repaired = true;

  return repaired;
}

/**
 * Check if CSV needs migration (without performing it)
 * @returns {object} Migration status info
 */
function checkMigrationNeeded() {
  const csvPath = getCsvPath();

  if (!fs.existsSync(csvPath)) {
    return { needed: false, reason: 'no_file' };
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    return { needed: false, reason: 'empty_file' };
  }

  const existingHeaders = parseCSVLine(lines[0]);
  const expectedHeaders = CSV_COLUMNS;

  const headersMatch = existingHeaders.length === expectedHeaders.length &&
    existingHeaders.every((h, i) => h === expectedHeaders[i]);

  // Also check for data corruption even if headers match
  let corruptedCount = 0;
  if (headersMatch && lines.length > 1) {
    // Sample first 100 records to check for corruption
    const sampleSize = Math.min(100, lines.length - 1);
    for (let i = 1; i <= sampleSize; i++) {
      const values = parseCSVLine(lines[i]);
      const record = csvRowToRecord(values, existingHeaders);
      if (isRecordCorrupted(record)) {
        corruptedCount++;
      }
    }
  }

  if (headersMatch && corruptedCount === 0) {
    return { needed: false, reason: 'headers_match' };
  }

  if (headersMatch && corruptedCount > 0) {
    // Estimate total corrupted
    const estimatedCorrupted = Math.round((corruptedCount / 100) * (lines.length - 1));
    return {
      needed: true,
      reason: 'data_corruption',
      existingColumns: existingHeaders.length,
      expectedColumns: expectedHeaders.length,
      recordCount: lines.length - 1,
      corruptedCount: estimatedCorrupted
    };
  }

  return {
    needed: true,
    reason: 'schema_mismatch',
    existingColumns: existingHeaders.length,
    expectedColumns: expectedHeaders.length,
    recordCount: lines.length - 1
  };
}

/**
 * Perform CSV migration with progress callback
 * @param {function} onProgress - Callback for progress updates (phase, current, total, message)
 * @returns {object} Migration result
 */
function performMigration(onProgress = null) {
  const csvPath = getCsvPath();

  if (!fs.existsSync(csvPath)) {
    return { success: true, migrated: false, reason: 'no_file' };
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    return { success: true, migrated: false, reason: 'empty_file' };
  }

  const existingHeaders = parseCSVLine(lines[0]);
  const expectedHeaders = CSV_COLUMNS;

  const headersMatch = existingHeaders.length === expectedHeaders.length &&
    existingHeaders.every((h, i) => h === expectedHeaders[i]);

  if (onProgress) onProgress('migration', 0, lines.length - 1, 'Starting migration...');

  // Parse existing records using existing headers
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length > 0) {
      const record = csvRowToRecord(values, existingHeaders);
      records.push(record);
    }
    if (onProgress && i % 50 === 0) {
      onProgress('migration', i, lines.length - 1, `Parsing record ${i}/${lines.length - 1}`);
    }
  }

  // Validate and repair all records
  if (onProgress) onProgress('migration', records.length, records.length, 'Validating and repairing data...');
  const validationResult = validateAndRepairAll(records, onProgress);
  const repairedRecords = validationResult.records;

  // Only proceed if there were actual changes needed
  const needsMigration = !headersMatch || validationResult.stats.repaired > 0;

  if (!needsMigration) {
    return { success: true, migrated: false, reason: 'no_changes_needed' };
  }

  // Backup old file
  const backupPath = csvPath + '.backup.' + Date.now();
  fs.copyFileSync(csvPath, backupPath);

  if (onProgress) onProgress('migration', records.length, records.length, 'Writing repaired data...');

  // Rewrite with new schema and repaired data
  let newContent = expectedHeaders.join(',') + '\n';
  for (const record of repairedRecords) {
    newContent += recordToCSVRow(record) + '\n';
  }

  fs.writeFileSync(csvPath, newContent, 'utf-8');

  // Clear cache to force reload
  recordsCache = null;
  hashIndex = null;

  return {
    success: true,
    migrated: true,
    recordCount: repairedRecords.length,
    backupPath,
    fromColumns: existingHeaders.length,
    toColumns: expectedHeaders.length,
    repaired: validationResult.stats.repaired,
    valid: validationResult.stats.valid,
    changes: validationResult.stats.changes
  };
}

/**
 * Repair all data in the CSV with validation
 * @param {function} onProgress - Progress callback
 * @returns {object} Repair result
 */
function repairAllData(onProgress = null) {
  const csvPath = getCsvPath();

  if (!fs.existsSync(csvPath)) {
    return { success: false, error: 'No CSV file exists', total: 0, repaired: 0, valid: 0, invalid: 0, changes: [] };
  }

  // Read directly from file to avoid cache issues
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  if (lines.length <= 1) {
    return { success: true, total: 0, repaired: 0, valid: 0, invalid: 0, changes: [], message: 'No records to repair' };
  }

  const headers = parseCSVLine(lines[0]);
  const records = [];

  // Parse all records
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length > 0) {
      records.push(csvRowToRecord(values, headers));
    }
  }

  if (records.length === 0) {
    return { success: true, total: 0, repaired: 0, valid: 0, invalid: 0, changes: [], message: 'No records to repair' };
  }

  // Validate and repair
  if (onProgress) onProgress('repair', 0, records.length, 'Starting data repair...');

  const result = validateAndRepairAll(records, onProgress);

  if (result.stats.repaired > 0) {
    // Backup before writing
    const backupPath = csvPath + '.backup.' + Date.now();
    fs.copyFileSync(csvPath, backupPath);

    // Write repaired data
    let newContent = CSV_COLUMNS.join(',') + '\n';
    for (const record of result.records) {
      newContent += recordToCSVRow(record) + '\n';
    }
    fs.writeFileSync(csvPath, newContent, 'utf-8');

    // Clear cache so next load picks up repaired data
    recordsCache = null;
    hashIndex = null;

    if (onProgress) onProgress('repair', records.length, records.length, `Repaired ${result.stats.repaired} records`);
  }

  return {
    success: true,
    total: result.stats.total,
    repaired: result.stats.repaired,
    valid: result.stats.valid,
    invalid: result.stats.invalid,
    changes: result.stats.changes
  };
}

/**
 * Check if CSV headers match expected columns and migrate if needed (legacy auto-migrate)
 */
function migrateCSVIfNeeded(csvPath) {
  const status = checkMigrationNeeded();
  if (!status.needed) {
    return false;
  }

  console.log('CSV schema mismatch detected - migrating data...');
  console.log(`  Existing columns: ${status.existingColumns}`);
  console.log(`  Expected columns: ${status.expectedColumns}`);

  const result = performMigration();
  if (result.migrated) {
    console.log(`  Backed up to: ${result.backupPath}`);
    console.log(`  Migrated ${result.recordCount} records to new schema`);
  }

  return result.migrated;
}

/**
 * Load all data from CSV into memory
 */
function loadData() {
  if (recordsCache !== null) {
    return recordsCache;
  }

  const csvPath = getCsvPath();
  recordsCache = [];
  hashIndex = new Map();

  if (!fs.existsSync(csvPath)) {
    return recordsCache;
  }

  // Check and migrate if schema changed
  migrateCSVIfNeeded(csvPath);

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    return recordsCache;
  }

  // First line is headers
  const headers = parseCSVLine(lines[0]);

  // Parse each data row
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length > 0) {
      const record = csvRowToRecord(values, headers);
      recordsCache.push(record);

      // Build hash index for fast dedup
      if (record.contentHash) {
        hashIndex.set(record.contentHash, record);
      }
    }
  }

  console.log(`Loaded ${recordsCache.length} records from CSV`);
  return recordsCache;
}

/**
 * Save a new record to CSV
 */
function saveRecord(record) {
  // Ensure data is loaded
  loadData();

  const csvPath = getCsvPath();
  const isNewFile = !fs.existsSync(csvPath) || fs.statSync(csvPath).size === 0;

  // Add to cache
  recordsCache.push(record);
  if (record.contentHash) {
    hashIndex.set(record.contentHash, record);
  }

  // Append to file
  let line = '';
  if (isNewFile) {
    // Write headers first
    line = CSV_COLUMNS.join(',') + '\n';
  }

  line += recordToCSVRow(record) + '\n';

  fs.appendFileSync(csvPath, line, 'utf-8');
}

/**
 * Get all records
 */
function getAllRecords() {
  loadData();
  // Return sorted by timestamp (newest first)
  return [...recordsCache].sort((a, b) => {
    return new Date(b.timestamp) - new Date(a.timestamp);
  });
}

/**
 * Check if a content hash already exists
 */
function isDuplicate(contentHash) {
  loadData();
  return hashIndex.has(contentHash);
}

/**
 * Get a record by its content hash
 */
function getRecordByHash(contentHash) {
  loadData();
  return hashIndex.get(contentHash) || null;
}

/**
 * Batch lookup records by content hashes (optimized for large uploads)
 * @param {string[]} hashes - Array of content hashes
 * @returns {Map<string, object|null>} Map of hash -> record (or null if not found)
 */
function getRecordsByHashes(hashes) {
  loadData();
  const results = new Map();
  for (const hash of hashes) {
    results.set(hash, hashIndex.get(hash) || null);
  }
  return results;
}

/**
 * Get all complete records (verification state A) by hash for quick skip check
 * @returns {Set<string>} Set of content hashes for complete records
 */
function getCompleteRecordHashes() {
  loadData();
  const completeHashes = new Set();
  for (const record of recordsCache) {
    if (record.verification_state === 'A' && record.contentHash) {
      completeHashes.add(record.contentHash);
    }
  }
  return completeHashes;
}

/**
 * Force reload from disk (useful if file was modified externally)
 */
function reloadData() {
  recordsCache = null;
  hashIndex = null;
  return loadData();
}

/**
 * Get statistics about the data
 */
function getStats() {
  loadData();
  return {
    totalRecords: recordsCache.length,
    uniqueSystems: new Set(recordsCache.map(r => r.hardwareSystemId).filter(Boolean)).size,
    dateRange: recordsCache.length > 0 ? {
      oldest: recordsCache.reduce((min, r) => r.timestamp < min ? r.timestamp : min, recordsCache[0].timestamp),
      newest: recordsCache.reduce((max, r) => r.timestamp > max ? r.timestamp : max, recordsCache[0].timestamp)
    } : null
  };
}

/**
 * Update an existing record by ID
 * @param {string} id - Record ID
 * @param {object} updates - Fields to update
 * @returns {object|null} Updated record or null if not found
 */
function updateRecord(id, updates) {
  loadData();

  const index = recordsCache.findIndex(r => r.id === id);
  if (index === -1) {
    return null;
  }

  // Update the record in cache
  const record = recordsCache[index];
  Object.assign(record, updates);

  // Update hash index if needed
  if (record.contentHash) {
    hashIndex.set(record.contentHash, record);
  }

  // Rewrite entire CSV file
  rewriteCSV();

  return record;
}

/**
 * Update multiple records at once (more efficient than individual updates)
 * @param {Array<{id: string, updates: object}>} updates - Array of updates
 * @returns {number} Number of records updated
 */
function updateRecords(updates) {
  loadData();

  let updatedCount = 0;

  for (const { id, updates: fieldUpdates } of updates) {
    const index = recordsCache.findIndex(r => r.id === id);
    if (index !== -1) {
      Object.assign(recordsCache[index], fieldUpdates);
      if (recordsCache[index].contentHash) {
        hashIndex.set(recordsCache[index].contentHash, recordsCache[index]);
      }
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    rewriteCSV();
  }

  return updatedCount;
}

/**
 * Rewrite the entire CSV file from cache
 */
function rewriteCSV() {
  const csvPath = getCsvPath();

  // Build CSV content
  let content = CSV_COLUMNS.join(',') + '\n';
  for (const record of recordsCache) {
    content += recordToCSVRow(record) + '\n';
  }

  // Write atomically (write to temp, then rename)
  const tempPath = csvPath + '.tmp';
  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, csvPath);
}

/**
 * Get records that are missing weather/solar data
 * @returns {Array} Records with missing data
 */
/**
 * Get records that are missing weather or solar data
 * Returns records where solar_ghi is null/undefined/empty (never fetched)
 * NOTE: solar_ghi = 0 is VALID for nighttime readings - don't treat as missing!
 * @returns {Array} Records with missing data
 */
function getRecordsMissingWeather() {
  loadData();
  return recordsCache.filter(r => {
    // Check if solar data was never fetched (null/undefined/empty string)
    // Note: 0 is a valid value (nighttime, no sun) - don't treat as missing
    const missingSolar = r.solar_ghi === null || r.solar_ghi === undefined || r.solar_ghi === '';
    return missingSolar;
  });
}

/**
 * Get records that need re-analysis (missing temperature or other extraction data)
 * @returns {Array} Records flagged for re-analysis
 */
function getRecordsNeedingReanalysis() {
  loadData();
  return recordsCache.filter(r => {
    // If explicitly flagged
    if (r.needs_reanalysis === true || r.needs_reanalysis === 'true') {
      return true;
    }
    // Or if missing critical extraction data (temperatures)
    const missingTemps = r.temperature_1 === null || r.temperature_1 === undefined || r.temperature_1 === '';
    return missingTemps;
  });
}

/**
 * Flag records that are missing extraction data for re-analysis
 * @param {function} onProgress - Progress callback
 * @returns {object} Result with count of flagged records
 */
function flagRecordsForReanalysis(onProgress = null) {
  loadData();

  let flagged = 0;
  const flaggedIds = [];

  for (let i = 0; i < recordsCache.length; i++) {
    const record = recordsCache[i];

    // Check if missing critical extraction data
    const missingTemps = record.temperature_1 === null || record.temperature_1 === undefined || record.temperature_1 === '';
    const missingMosTemp = record.mosTemperature === null || record.mosTemperature === undefined || record.mosTemperature === '';

    if (missingTemps || missingMosTemp) {
      if (record.needs_reanalysis !== true && record.needs_reanalysis !== 'true') {
        record.needs_reanalysis = true;
        flaggedIds.push(record.id);
        flagged++;
      }
    }

    if (onProgress && i % 100 === 0) {
      onProgress('flagging', i + 1, recordsCache.length, `Checking record ${i + 1}/${recordsCache.length}`);
    }
  }

  if (flagged > 0) {
    rewriteCSV();
  }

  return {
    total: recordsCache.length,
    flagged,
    flaggedIds
  };
}

/**
 * Clear re-analysis flag for a record
 * @param {string} id - Record ID
 */
function clearReanalysisFlag(id) {
  loadData();
  const record = recordsCache.find(r => r.id === id);
  if (record) {
    record.needs_reanalysis = false;
    rewriteCSV();
    return true;
  }
  return false;
}

/**
 * Fix cycle count issues - convert 0 to null
 * This repairs data where the AI incorrectly defaulted to 0 when cycles weren't visible
 * @returns {object} Stats about fixes made
 */
function repairCycleCountData() {
  loadData();

  let fixed = 0;
  let alreadyNull = 0;
  let hasValidCycles = 0;

  // Debug: Check types of cycleCount values
  const typeStats = {};
  for (const record of recordsCache) {
    const val = record.cycleCount;
    const typeKey = `${typeof val}:${val}`;
    typeStats[typeKey] = (typeStats[typeKey] || 0) + 1;
  }
  console.log(`[CSV-Store] CycleCount type distribution:`, JSON.stringify(typeStats));

  for (const record of recordsCache) {
    // Check for 0 as number OR string, also check for falsy 0
    const cycleVal = record.cycleCount;
    const isZero = cycleVal === 0 || cycleVal === '0' || (typeof cycleVal === 'number' && cycleVal === 0);

    if (isZero) {
      console.log(`[CSV-Store] Fixing cycleCount=0 for ${record.fileName} (type: ${typeof cycleVal}, value: ${cycleVal})`);
      record.cycleCount = null;
      // Also mark for re-analysis to get correct value
      record.verification_state = 'B';
      record.needs_reanalysis = true;
      fixed++;
    } else if (cycleVal === null || cycleVal === '' || cycleVal === undefined) {
      alreadyNull++;
    } else {
      hasValidCycles++;
    }
  }

  if (fixed > 0) {
    rewriteCSV();
    console.log(`[CSV-Store] Repaired cycle count: ${fixed} records (0 → null)`);
  } else {
    console.log(`[CSV-Store] No cycle count repairs needed (${alreadyNull} null, ${hasValidCycles} valid)`);
  }

  return {
    fixed,
    alreadyNull,
    hasValidCycles,
    total: recordsCache.length
  };
}

/**
 * Fix physics violations - null out impossible V/I/P combinations
 * This repairs data where voltage=0 or current=0 but power > 0 (physically impossible)
 * Also fixes SOC=0% with high cell voltage
 * @returns {object} Stats about fixes made
 */
function repairPhysicsViolations() {
  loadData();

  let voltageFixed = 0;
  let currentFixed = 0;
  let socFixed = 0;
  let alreadyValid = 0;

  for (const record of recordsCache) {
    const power = record.power !== null ? Math.abs(record.power) : 0;
    let needsRewrite = false;

    // Fix voltage=0 with power>0
    if (power > 5 && record.overallVoltage === 0) {
      console.log(`[CSV-Store] Physics fix: ${record.fileName} - V=0 but P=${power}W → V=null`);
      record.overallVoltage = null;
      record.verification_state = 'B';
      record.needs_reanalysis = true;
      voltageFixed++;
      needsRewrite = true;
    }

    // Fix current=0 with power>0
    if (power > 5 && record.current === 0) {
      console.log(`[CSV-Store] Physics fix: ${record.fileName} - I=0 but P=${power}W → I=null`);
      record.current = null;
      record.verification_state = 'B';
      record.needs_reanalysis = true;
      currentFixed++;
      needsRewrite = true;
    }

    // Fix SOC=0% with high cell voltage (should be <2.8V for LiFePO4 at 0%)
    if (record.stateOfCharge === 0 && record.averageCellVoltage !== null && record.averageCellVoltage > 3.0) {
      console.log(`[CSV-Store] Physics fix: ${record.fileName} - SOC=0% but cell=${record.averageCellVoltage}V → SOC=null`);
      record.stateOfCharge = null;
      record.verification_state = 'B';
      record.needs_reanalysis = true;
      socFixed++;
      needsRewrite = true;
    }

    if (!needsRewrite) {
      alreadyValid++;
    }
  }

  const totalFixed = voltageFixed + currentFixed + socFixed;
  if (totalFixed > 0) {
    rewriteCSV();
    console.log(`[CSV-Store] Repaired physics violations: ${voltageFixed} voltage, ${currentFixed} current, ${socFixed} SOC`);
  }

  return {
    voltageFixed,
    currentFixed,
    socFixed,
    totalFixed,
    alreadyValid,
    total: recordsCache.length
  };
}

module.exports = {
  loadData,
  saveRecord,
  updateRecord,
  updateRecords,
  getAllRecords,
  isDuplicate,
  getRecordByHash,
  getRecordsByHashes,
  getCompleteRecordHashes,
  reloadData,
  getStats,
  getCsvPath,
  getRecordsMissingWeather,
  getRecordsNeedingReanalysis,
  flagRecordsForReanalysis,
  clearReanalysisFlag,
  checkMigrationNeeded,
  performMigration,
  repairAllData,
  repairCycleCountData,
  repairPhysicsViolations,
  CSV_COLUMNS
};
