const { getCollection } = require('./utils/mongodb.cjs');
const { createLogger, createTimer } = require('./utils/logger.cjs');
const multiparty = require('multiparty');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');

exports.handler = async (event, context) => {
  const log = createLogger('upload', context);
  const timer = createTimer(log, 'upload-handler');
  log.entry({ method: event.httpMethod, path: event.path });
  
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  const clientIp = event.headers['x-nf-client-connection-ip'];
  const logContext = { clientIp, httpMethod: event.httpMethod };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    log.debug('OPTIONS preflight request', logContext);
    const durationMs = timer.end();
    log.exit(200);
    return {
      statusCode: 200,
      headers
    };
  }

  if (event.httpMethod !== 'POST') {
    log.warn('Method not allowed', { ...logContext, allowedMethods: ['POST'] });
    const durationMs = timer.end();
    log.exit(405);
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    log.debug('Parsing multipart form data', logContext);
    // Parse multipart form data
    const formData = await parseMultipartData(event, log);
    const { file, userId } = formData;
    
    const requestContext = { ...logContext, fileName: file?.name, userId, fileSize: file?.size };
    
    if (!file || !userId) {
      log.warn('Missing required fields', requestContext);
      const durationMs = timer.end();
      log.exit(400);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing file or userId' })
      };
    }

    log.debug('Checking for duplicate file', requestContext);
    // Check for duplicate file
    const uploadsCollection = await getCollection('uploads');
    const existing = await uploadsCollection.findOne({
      filename: file.name,
      userId,
      status: { $in: ['completed', 'processing'] }
    });

    if (existing) {
      log.info('Duplicate file detected', { ...requestContext, existingId: existing._id });
      const durationMs = timer.end();
      log.exit(409);
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          error: 'Duplicate file',
          message: `File ${file.name} has already been uploaded`,
          existingId: existing._id
        })
      };
    }

    log.info('Creating upload record', requestContext);
    // Insert upload record in processing state
    const uploadRecord = await uploadsCollection.insertOne({
      filename: file.name,
      userId,
      status: 'processing',
      createdAt: new Date(),
      fileSize: file.size,
      contentType: file.type
    });

    log.info('Processing file', { ...requestContext, uploadId: uploadRecord.insertedId });
    // Process the file
    const processingResult = await processFile(file, uploadRecord.insertedId, log);

    log.debug('Updating upload record with processing results', { ...requestContext, uploadId: uploadRecord.insertedId, success: processingResult.success });
    // Update record with processing results
    await uploadsCollection.updateOne(
      { _id: uploadRecord.insertedId },
      { 
        $set: { 
          status: processingResult.success ? 'completed' : 'failed',
          completedAt: new Date(),
          processingResult: processingResult,
          error: processingResult.success ? null : processingResult.error
        }
      }
    );

    if (processingResult.success) {
      log.info('File processed successfully', { ...requestContext, uploadId: uploadRecord.insertedId, recordsProcessed: processingResult.recordsProcessed });
      const durationMs = timer.end({ success: true });
      log.exit(200, { uploadId: uploadRecord.insertedId });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          fileId: uploadRecord.insertedId,
          filename: file.name,
          message: 'File uploaded and processed successfully',
          processingResult
        })
      };
    } else {
      log.error('File processing failed', { ...requestContext, uploadId: uploadRecord.insertedId, error: processingResult.error });
      const durationMs = timer.end({ success: false });
      log.exit(500, { uploadId: uploadRecord.insertedId });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'File processing failed',
          details: processingResult.error,
          fileId: uploadRecord.insertedId
        })
      };
    }

  } catch (error) {
    log.error('Upload handler error', { ...logContext, error: error.message, stack: error.stack });
    const durationMs = timer.end({ success: false });
    log.exit(500);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Upload failed',
        details: error.message
      })
    };
  }
};

async function parseMultipartData(event, log) {
  return new Promise((resolve, reject) => {
    const form = new multiparty.Form();

    form.on('error', (err) => {
      log.error('Multiparty form error', { error: err.message, stack: err.stack });
      reject(new Error('Failed to parse multipart form'));
    });

    form.on('part', (part) => {
      // For now, we are assuming the file is the only part
      let data = [];
      part.on('data', (chunk) => {
        data.push(chunk);
      });
      part.on('end', () => {
        const buffer = Buffer.concat(data);
        resolve({
          file: {
            name: part.filename,
            size: buffer.length,
            type: part.headers['content-type'],
            data: buffer,
          },
          userId: 'user-id-from-form-or-header' // Replace with actual user ID extraction
        });
      });
      part.on('error', (err) => {
        log.error('Multiparty part error', { error: err.message, stack: err.stack });
        reject(new Error('Error processing file part'));
      });
    });

    // multiparty expects a request object with headers and a body
    const req = {
      headers: event.headers,
      body: event.body,
    };
    if (event.isBase64Encoded) {
      req.body = Buffer.from(event.body, 'base64');
    }
    
    form.parse(req);
  });
}

async function processFile(file, uploadId, log) {
  const fileContext = { fileName: file.name, fileSize: file.size, contentType: file.type, uploadId };
  log.debug('Starting file processing', fileContext);
  
  try {
    // Validate file
    log.debug('Validating file', fileContext);
    const validation = validateFile(file, log);
    if (!validation.valid) {
      log.warn('File validation failed', { ...fileContext, error: validation.error });
      return {
        success: false,
        error: validation.error
      };
    }

    // Parse file content based on type
    let parsedData;
    try {
      log.debug('Parsing file content', { ...fileContext, format: file.name.split('.').pop() });
      parsedData = await parseFileContent(file, log);
      log.debug('File parsed successfully', { ...fileContext, measurementsCount: parsedData.measurements?.length });
    } catch (parseError) {
      log.error('File parsing failed', { ...fileContext, error: parseError.message, stack: parseError.stack });
      return {
        success: false,
        error: `File parsing failed: ${parseError.message}`
      };
    }

    // Extract battery metrics
    log.debug('Extracting battery metrics', fileContext);
    const metrics = await extractBatteryMetrics(parsedData, log);
    log.debug('Metrics extracted', { ...fileContext, recordCount: metrics.recordCount, batteryType: metrics.batteryType });
    
    // Store measurements in database
    log.debug('Storing measurements', { ...fileContext, measurementCount: metrics.measurements.length });
    await storeMeasurements(uploadId, metrics.measurements, log);
    
    // Store file metadata
    log.debug('Storing file metadata', fileContext);
    const filesCollection = await getCollection('files');
    await filesCollection.insertOne({
      uploadId,
      filename: file.name,
      fileSize: file.size,
      contentType: file.type,
      parsedData,
      metrics: {
        totalRecords: metrics.measurements.length,
        dateRange: metrics.dateRange,
        batteryType: metrics.batteryType
      },
      uploadedAt: new Date()
    });

    log.info('File processing completed successfully', { ...fileContext, recordsProcessed: metrics.measurements.length });
    return {
      success: true,
      metrics,
      recordsProcessed: metrics.measurements.length
    };

  } catch (error) {
    log.error('File processing error', { ...fileContext, error: error.message, stack: error.stack });
    return {
      success: false,
      error: error.message
    };
  }
}

function validateFile(file, log) {
  log.debug('Validating file constraints', { fileName: file.name, fileSize: file.size });
  
  // Check file size (max 50MB)
  if (file.size > 50 * 1024 * 1024) {
    log.debug('File size validation failed', { fileName: file.name, fileSize: file.size, maxSize: 50 * 1024 * 1024 });
    return {
      valid: false,
      error: 'File size exceeds 50MB limit'
    };
  }

  // Check file extension
  const allowedExtensions = ['.csv', '.json', '.txt', '.log', '.xml'];
  const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  
  if (!allowedExtensions.includes(fileExtension)) {
    log.debug('File extension validation failed', { fileName: file.name, extension: fileExtension, allowed: allowedExtensions });
    return {
      valid: false,
      error: `File type ${fileExtension} is not supported`
    };
  }

  // Check filename length
  if (file.name.length > 255) {
    log.debug('Filename length validation failed', { fileName: file.name, length: file.name.length, maxLength: 255 });
    return {
      valid: false,
      error: 'Filename is too long (max 255 characters)'
    };
  }

  log.debug('File validation passed', { fileName: file.name, extension: fileExtension });
  return { valid: true };
}

async function parseFileContent(file, log) {
  const content = file.data.toString('utf8');
  const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  
  log.debug('Parsing file content', { fileName: file.name, extension: fileExtension, contentLength: content.length });
  
  switch (fileExtension) {
    case '.csv':
      log.debug('Using CSV parser', { fileName: file.name });
      return parseCSV(content, log);
    case '.json':
      log.debug('Using JSON parser', { fileName: file.name });
      return parseJSON(content, log);
    case '.txt':
    case '.log':
      log.debug('Using text/log parser', { fileName: file.name });
      return parseTextLog(content, log);
    case '.xml':
      log.debug('Using XML parser', { fileName: file.name });
      return parseXML(content, log);
    default:
      log.error('Unsupported file format', { fileName: file.name, extension: fileExtension });
      throw new Error('Unsupported file format');
  }
}

function parseCSV(content, log) {
  log.debug('Parsing CSV content', { contentLength: content.length, lineCount: content.split('\n').length });
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const measurements = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const measurement = {};
    
    headers.forEach((header, index) => {
      const value = values[index];
      
      // Try to parse as number, otherwise keep as string
      if (!isNaN(value) && value !== '') {
        measurement[header] = parseFloat(value);
      } else {
        measurement[header] = value;
      }
    });
    
    // Add timestamp if not present
    if (!measurement.timestamp) {
      measurement.timestamp = new Date(Date.now() - (lines.length - i) * 60000).toISOString();
    }
    
    measurements.push(measurement);
  }
  
  return { format: 'csv', measurements };
}

function parseJSON(content, log) {
  try {
    log.debug('Parsing JSON content', { contentLength: content.length });
    const data = JSON.parse(content);
    
    // Handle different JSON structures
    if (Array.isArray(data)) {
      log.debug('JSON array detected', { measurementCount: data.length });
      return { format: 'json', measurements: data };
    } else if (data.measurements && Array.isArray(data.measurements)) {
      log.debug('JSON with measurements array detected', { measurementCount: data.measurements.length, hasMetadata: !!data.metadata });
      return { format: 'json', measurements: data.measurements, metadata: data.metadata };
    } else if (data.data && Array.isArray(data.data)) {
      log.debug('JSON with data array detected', { measurementCount: data.data.length });
      return { format: 'json', measurements: data.data };
    } else {
      // Single measurement
      log.debug('Single JSON measurement detected');
      return { format: 'json', measurements: [data] };
    }
  } catch (error) {
    log.error('JSON parsing failed', { error: error.message, contentPreview: content.substring(0, 200) });
    throw new Error('Invalid JSON format');
  }
}

function parseTextLog(content, log) {
  log.debug('Parsing text/log content', { contentLength: content.length, lineCount: content.split('\n').length });
  const lines = content.trim().split('\n');
  const measurements = [];
  
  // Try to parse structured log format
  for (const line of lines) {
    if (line.trim() === '') continue;
    
    // Simple key-value parsing
    const measurement = {
      timestamp: new Date().toISOString(),
      rawLog: line
    };
    
    // Extract numeric values from log line
    const numbers = line.match(/[-+]?\d*\.?\d+/g);
    if (numbers && numbers.length >= 3) {
      measurement.voltage = parseFloat(numbers[0]);
      measurement.current = parseFloat(numbers[1]);
      measurement.capacity = parseFloat(numbers[2]);
      measurement.temperature = numbers[3] ? parseFloat(numbers[3]) : 25.0;
    }
    
    measurements.push(measurement);
  }
  
  return { format: 'text', measurements };
}

function parseXML(content, log) {
  log.debug('Parsing XML content', { contentLength: content.length });
  const parser = new XMLParser();
  const jsonObj = parser.parse(content);
  
  let measurements = [];
  
  if (jsonObj.measurements && jsonObj.measurements.measurement) {
    measurements = Array.isArray(jsonObj.measurements.measurement) 
      ? jsonObj.measurements.measurement 
      : [jsonObj.measurements.measurement];
  } else {
    log.warn('No measurements found in XML', { xmlContent: content.substring(0, 500) });
  }

  log.debug('XML parsing completed', { measurementCount: measurements.length });
  return { format: 'xml', measurements };
}

async function extractBatteryMetrics(parsedData, log) {
  log.debug('Extracting battery metrics', { format: parsedData.format, measurementCount: parsedData.measurements?.length });
  const measurements = parsedData.measurements || [];
  
  // Calculate derived metrics
  for (let i = 0; i < measurements.length; i++) {
    const measurement = measurements[i];
    
    // Calculate state of charge if not present
    if (!measurement.soc && measurement.capacity) {
      measurement.soc = Math.min(100, (measurement.capacity / 100) * 100);
    }
    
    // Determine charging state
    if (!measurement.state && measurement.current) {
      measurement.state = measurement.current > 0 ? 'charging' : 
                        measurement.current < 0 ? 'discharging' : 'idle';
    }
    
    // Calculate power
    if (measurement.voltage && measurement.current) {
      measurement.power = measurement.voltage * measurement.current;
    }
    
    // Add record index
    measurement.recordIndex = i;
  }
  
  // Calculate date range
  const timestamps = measurements
    .map(m => new Date(m.timestamp))
    .filter(t => !isNaN(t.getTime()));
  
  const dateRange = timestamps.length > 0 ? {
    start: new Date(Math.min(...timestamps.map(t => t.getTime()))),
    end: new Date(Math.max(...timestamps.map(t => t.getTime())))
  } : null;
  
  return {
    measurements,
    dateRange,
    batteryType: inferBatteryType(measurements),
    recordCount: measurements.length
  };
}

function inferBatteryType(measurements) {
  if (measurements.length === 0) return 'unknown';
  
  const avgVoltage = measurements.reduce((sum, m) => sum + (m.voltage || 0), 0) / measurements.length;
  
  if (avgVoltage >= 3.6 && avgVoltage <= 3.8) return 'lithium-ion';
  if (avgVoltage >= 2.0 && avgVoltage <= 2.2) return 'lead-acid';
  if (avgVoltage >= 1.2 && avgVoltage <= 1.4) return 'nimh';
  
  return 'unknown';
}

async function storeMeasurements(uploadId, measurements, log) {
  if (measurements.length === 0) {
    log.debug('No measurements to store', { uploadId });
    return;
  }
  
  log.debug('Preparing measurements for storage', { uploadId, measurementCount: measurements.length });
  // Add uploadId to each measurement
  const measurementsWithId = measurements.map(m => ({
    ...m,
    uploadId,
    processedAt: new Date()
  }));
  
  // Insert in batches for better performance
  const batchSize = 1000;
  const batches = Math.ceil(measurementsWithId.length / batchSize);
  log.debug('Storing measurements in batches', { uploadId, total: measurementsWithId.length, batchSize, batches });
  
  const measurementsCollection = await getCollection('measurements');
  for (let i = 0; i < measurementsWithId.length; i += batchSize) {
    const batch = measurementsWithId.slice(i, i + batchSize);
    await measurementsCollection.insertMany(batch);
    log.debug('Inserted measurement batch', { uploadId, batchNumber: Math.floor(i / batchSize) + 1, batchSize: batch.length });
  }
  
  log.info('All measurements stored successfully', { uploadId, total: measurementsWithId.length });
}
