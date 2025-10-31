const { MongoClient } = require('mongodb');

// MongoDB connection
const client = new MongoClient(process.env.MONGODB_URI);
const database = client.db('battery-analysis');

exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    await client.connect();
    
    // Parse multipart form data
    const formData = await parseMultipartData(event.body, event.headers['content-type']);
    const { file, userId } = formData;
    
    if (!file || !userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing file or userId' })
      };
    }

    // Check for duplicate file
    const existing = await database.collection('uploads').findOne({
      filename: file.name,
      userId,
      status: { $in: ['completed', 'processing'] }
    });

    if (existing) {
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

    // Insert upload record in processing state
    const uploadRecord = await database.collection('uploads').insertOne({
      filename: file.name,
      userId,
      status: 'processing',
      createdAt: new Date(),
      fileSize: file.size,
      contentType: file.type
    });

    // Process the file
    const processingResult = await processFile(file, uploadRecord.insertedId);

    // Update record with processing results
    await database.collection('uploads').updateOne(
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
    console.error('Upload error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Upload failed',
        details: error.message
      })
    };
  } finally {
    await client.close();
  }
};

// Mock multipart parser - in production, use a proper library
async function parseMultipartData(body, contentType) {
  // This is a simplified mock - in production, use a library like 'multiparty'
  // For now, we'll assume JSON payload with base64 file data
  
  try {
    const data = JSON.parse(body);
    
    // If file is sent as base64, decode it
    if (data.fileBase64) {
      const buffer = Buffer.from(data.fileBase64, 'base64');
      return {
        file: {
          name: data.filename,
          size: buffer.length,
          type: data.contentType || 'application/octet-stream',
          data: buffer
        },
        userId: data.userId
      };
    }
    
    // Handle other formats as needed
    return data;
  } catch (error) {
    throw new Error('Failed to parse multipart data');
  }
}

async function processFile(file, uploadId) {
  try {
    console.log(`Processing file: ${file.name}, size: ${file.size} bytes`);
    
    // Validate file
    const validation = validateFile(file);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }

    // Parse file content based on type
    let parsedData;
    try {
      parsedData = await parseFileContent(file);
    } catch (parseError) {
      return {
        success: false,
        error: `File parsing failed: ${parseError.message}`
      };
    }

    // Extract battery metrics
    const metrics = await extractBatteryMetrics(parsedData);
    
    // Store measurements in database
    await storeMeasurements(uploadId, metrics.measurements);
    
    // Store file metadata
    await database.collection('files').insertOne({
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

    return {
      success: true,
      metrics,
      recordsProcessed: metrics.measurements.length
    };

  } catch (error) {
    console.error('File processing error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

function validateFile(file) {
  // Check file size (max 50MB)
  if (file.size > 50 * 1024 * 1024) {
    return {
      valid: false,
      error: 'File size exceeds 50MB limit'
    };
  }

  // Check file extension
  const allowedExtensions = ['.csv', '.json', '.txt', '.log', '.xml'];
  const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  
  if (!allowedExtensions.includes(fileExtension)) {
    return {
      valid: false,
      error: `File type ${fileExtension} is not supported`
    };
  }

  // Check filename length
  if (file.name.length > 255) {
    return {
      valid: false,
      error: 'Filename is too long (max 255 characters)'
    };
  }

  return { valid: true };
}

async function parseFileContent(file) {
  const content = file.data.toString('utf8');
  const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  
  switch (fileExtension) {
    case '.csv':
      return parseCSV(content);
    case '.json':
      return parseJSON(content);
    case '.txt':
    case '.log':
      return parseTextLog(content);
    case '.xml':
      return parseXML(content);
    default:
      throw new Error('Unsupported file format');
  }
}

function parseCSV(content) {
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

function parseJSON(content) {
  try {
    const data = JSON.parse(content);
    
    // Handle different JSON structures
    if (Array.isArray(data)) {
      return { format: 'json', measurements: data };
    } else if (data.measurements && Array.isArray(data.measurements)) {
      return { format: 'json', measurements: data.measurements, metadata: data.metadata };
    } else if (data.data && Array.isArray(data.data)) {
      return { format: 'json', measurements: data.data };
    } else {
      // Single measurement
      return { format: 'json', measurements: [data] };
    }
  } catch (error) {
    throw new Error('Invalid JSON format');
  }
}

function parseTextLog(content) {
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

function parseXML(content) {
  // Mock XML parsing - in production, use a proper XML parser
  const measurements = [];
  
  // Simple XML tag extraction
  const measurementTags = content.match(/<measurement[^>]*>[\s\S]*?<\/measurement>/g) || [];
  
  for (const tag of measurementTags) {
    const measurement = {};
    
    // Extract values from tags
    const voltageMatch = tag.match(/<voltage>(.*?)<\/voltage>/);
    const currentMatch = tag.match(/<current>(.*?)<\/current>/);
    const capacityMatch = tag.match(/<capacity>(.*?)<\/capacity>/);
    const temperatureMatch = tag.match(/<temperature>(.*?)<\/temperature>/);
    const timestampMatch = tag.match(/<timestamp>(.*?)<\/timestamp>/);
    
    if (voltageMatch) measurement.voltage = parseFloat(voltageMatch[1]);
    if (currentMatch) measurement.current = parseFloat(currentMatch[1]);
    if (capacityMatch) measurement.capacity = parseFloat(capacityMatch[1]);
    if (temperatureMatch) measurement.temperature = parseFloat(temperatureMatch[1]);
    if (timestampMatch) measurement.timestamp = timestampMatch[1];
    else measurement.timestamp = new Date().toISOString();
    
    measurements.push(measurement);
  }
  
  return { format: 'xml', measurements };
}

async function extractBatteryMetrics(parsedData) {
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

async function storeMeasurements(uploadId, measurements) {
  if (measurements.length === 0) return;
  
  // Add uploadId to each measurement
  const measurementsWithId = measurements.map(m => ({
    ...m,
    uploadId,
    processedAt: new Date()
  }));
  
  // Insert in batches for better performance
  const batchSize = 1000;
  for (let i = 0; i < measurementsWithId.length; i += batchSize) {
    const batch = measurementsWithId.slice(i, i + batchSize);
    await database.collection('measurements').insertMany(batch);
  }
}