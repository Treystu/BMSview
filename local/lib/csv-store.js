/**
 * CSV Storage Module - Stores BMS data in a local CSV file
 * Supports hash-based deduplication and in-place updates
 */

const fs = require('fs');
const path = require('path');
const { getSettings } = require('./settings');

// CSV column definitions - order matters for consistent output
const CSV_COLUMNS = [
  'id',
  'contentHash',
  'timestamp',
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
  'weather_temp',
  'weather_clouds',
  'weather_uvi',
  'weather_condition',
  'model_used',
  'cost_usd'
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
      'temperature_1', 'temperature_2', 'temperature_3', 'temperature_4'].includes(header)) {
      value = value === '' ? null : parseFloat(value);
    }
    // Parse booleans
    else if (['chargeMosOn', 'dischargeMosOn', 'balanceOn'].includes(header)) {
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

module.exports = {
  loadData,
  saveRecord,
  getAllRecords,
  isDuplicate,
  getRecordByHash,
  reloadData,
  getStats,
  getCsvPath,
  CSV_COLUMNS
};
