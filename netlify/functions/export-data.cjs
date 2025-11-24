/**
 * Export Data Function
 * 
 * Handles exporting data from MongoDB collections in various formats:
 * - CSV for history and systems (human-readable)
 * - JSON for full backup (MongoDB re-importable format)
 * 
 * Endpoints:
 * - /export-data?type=history&format=csv - Export history as CSV
 * - /export-data?type=systems&format=csv - Export systems as CSV
 * - /export-data?type=full&format=json - Export full backup as JSON
 */

const { getCollection } = require('./utils/mongodb.cjs');
const { createLogger } = require('./utils/logger.cjs');

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}

/**
 * Convert array of objects to CSV string
 */
function arrayToCSV(data, headers) {
    if (!data || data.length === 0) {
        return headers.join(',') + '\n';
    }
    
    const rows = data.map(obj => {
        return headers.map(header => {
            let value = obj[header];
            
            // Handle nested objects and arrays
            if (value && typeof value === 'object') {
                value = JSON.stringify(value);
            }
            
            // Handle null/undefined
            if (value === null || value === undefined) {
                value = '';
            }
            
            // Escape quotes and wrap in quotes if needed
            value = String(value);
            if (/[,"\n\r]/.test(value)) {
                value = '"' + value.replace(/"/g, '""') + '"';
            }
            
            return value;
        }).join(',');
    });
    
    return [headers.join(','), ...rows].join('\n');
}

/**
 * Export history data as CSV
 */
async function exportHistoryCSV(log) {
    const collection = await getCollection('history');
    const records = await collection.find({}).sort({ timestamp: -1 }).toArray();
    
    log.info('Exporting history data', { count: records.length });
    
    const headers = [
        'id', 'timestamp', 'systemId', 'systemName', 'dlNumber', 'fileName',
        'stateOfCharge', 'overallVoltage', 'current', 'power', 'remainingCapacity', 
        'fullCapacity', 'cycleCount', 'temperature', 'mosTemperature',
        'chargeMosOn', 'dischargeMosOn', 'balanceOn',
        'highestCellVoltage', 'lowestCellVoltage', 'averageCellVoltage', 'cellVoltageDifference',
        'status', 'alerts', 'weather_temp', 'weather_clouds', 'weather_uvi'
    ];
    
    const flattenedRecords = records.map(record => ({
        id: record.id,
        timestamp: record.timestamp,
        systemId: record.systemId || '',
        systemName: record.systemName || '',
        dlNumber: record.analysis?.dlNumber || '',
        fileName: record.fileName || '',
        stateOfCharge: record.analysis?.stateOfCharge ?? '',
        overallVoltage: record.analysis?.overallVoltage ?? '',
        current: record.analysis?.current ?? '',
        power: record.analysis?.power ?? '',
        remainingCapacity: record.analysis?.remainingCapacity ?? '',
        fullCapacity: record.analysis?.fullCapacity ?? '',
        cycleCount: record.analysis?.cycleCount ?? '',
        temperature: record.analysis?.temperature ?? '',
        mosTemperature: record.analysis?.mosTemperature ?? '',
        chargeMosOn: record.analysis?.chargeMosOn ?? '',
        dischargeMosOn: record.analysis?.dischargeMosOn ?? '',
        balanceOn: record.analysis?.balanceOn ?? '',
        highestCellVoltage: record.analysis?.highestCellVoltage ?? '',
        lowestCellVoltage: record.analysis?.lowestCellVoltage ?? '',
        averageCellVoltage: record.analysis?.averageCellVoltage ?? '',
        cellVoltageDifference: record.analysis?.cellVoltageDifference ?? '',
        status: record.analysis?.status || '',
        alerts: record.analysis?.alerts ? record.analysis.alerts.join('; ') : '',
        weather_temp: record.weather?.temp ?? '',
        weather_clouds: record.weather?.clouds ?? '',
        weather_uvi: record.weather?.uvi ?? ''
    }));
    
    return arrayToCSV(flattenedRecords, headers);
}

/**
 * Export systems data as CSV
 */
async function exportSystemsCSV(log) {
    const collection = await getCollection('systems');
    const systems = await collection.find({}).sort({ name: 1 }).toArray();
    
    log.info('Exporting systems data', { count: systems.length });
    
    const headers = [
        'id', 'name', 'description', 'location', 'latitude', 'longitude',
        'capacity', 'voltage', 'associatedDLs', 'createdAt', 'updatedAt'
    ];
    
    const flattenedSystems = systems.map(system => ({
        id: system.id,
        name: system.name || '',
        description: system.description || '',
        location: system.location || '',
        latitude: system.latitude ?? '',
        longitude: system.longitude ?? '',
        capacity: system.capacity ?? '',
        voltage: system.voltage ?? '',
        associatedDLs: system.associatedDLs ? system.associatedDLs.join('; ') : '',
        createdAt: system.createdAt || '',
        updatedAt: system.updatedAt || ''
    }));
    
    return arrayToCSV(flattenedSystems, headers);
}

/**
 * Export full database backup as JSON
 */
async function exportFullBackup(log) {
    const collections = ['systems', 'history'];
    const backup = {
        exportDate: new Date().toISOString(),
        version: '1.0',
        collections: {}
    };
    
    for (const collectionName of collections) {
        const collection = await getCollection(collectionName);
        const data = await collection.find({}).toArray();
        backup.collections[collectionName] = data;
        log.info(`Backed up collection: ${collectionName}`, { count: data.length });
    }
    
    log.info('Full backup created', { 
        collectionsCount: Object.keys(backup.collections).length,
        totalRecords: Object.values(backup.collections).reduce((sum, arr) => sum + arr.length, 0)
    });
    
    return JSON.stringify(backup, null, 2);
}

/**
 * Main handler
 */
exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }
    
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
    
    const log = createLogger('export-data', context);
    const params = event.queryStringParameters || {};
    const type = params.type || 'history'; // history, systems, full
    const format = params.format || 'csv'; // csv, json
    
    log.info('Export data request', { type, format });
    
    try {
        let data = '';
        let contentType = '';
        let filename = '';
        
        if (type === 'history' && format === 'csv') {
            data = await exportHistoryCSV(log);
            contentType = 'text/csv';
            filename = `bms-history-${new Date().toISOString().split('T')[0]}.csv`;
        } else if (type === 'systems' && format === 'csv') {
            data = await exportSystemsCSV(log);
            contentType = 'text/csv';
            filename = `bms-systems-${new Date().toISOString().split('T')[0]}.csv`;
        } else if (type === 'full' && format === 'json') {
            data = await exportFullBackup(log);
            contentType = 'application/json';
            filename = `bms-full-backup-${new Date().toISOString().split('T')[0]}.json`;
        } else {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Invalid parameters',
                    validTypes: ['history', 'systems', 'full'],
                    validFormats: ['csv', 'json']
                })
            };
        }
        
        log.info('Export completed', { type, format, size: data.length });
        
        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${filename}"`
            },
            body: data
        };
        
    } catch (error) {
        log.error('Export failed', { error: error.message, stack: error.stack });
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Export failed', 
                message: error.message 
            })
        };
    }
};
