const { MongoClient } = require('mongodb');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

// Validate environment variables
function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  const log = createLoggerFromEvent('admin-systems', event, context);
  const timer = createTimer(log, 'admin-systems');
  const sanitizedHeaders = event.headers ? {
    ...event.headers,
    authorization: event.headers.authorization ? '[REDACTED]' : undefined,
    cookie: event.headers.cookie ? '[REDACTED]' : undefined,
    'x-api-key': event.headers['x-api-key'] ? '[REDACTED]' : undefined
  } : {};
  log.entry({ method: event.httpMethod, path: event.path, query: event.queryStringParameters, headers: sanitizedHeaders, bodyLength: event.body ? event.body.length : 0 });
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    timer.end({ outcome: 'preflight' });
    log.exit(200, { outcome: 'preflight' });
    return { statusCode: 200, headers };
  }
  
  if (!validateEnvironment(log)) {
    timer.end({ outcome: 'configuration_error' });
    log.exit(500, { outcome: 'configuration_error' });
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  const database = client.db('battery-analysis');

  try {
    log.debug('Connecting to MongoDB');
    await client.connect();
    
    const queryStringParameters = event.queryStringParameters || {};
    const { filter = 'unadopted' } = queryStringParameters;

    if (event.httpMethod === 'GET') {
      log.debug('Fetching systems', { filter });
      let systems;
      
      switch (filter) {
        case 'unadopted':
          systems = await getUnadoptedSystems(database, log);
          break;
        case 'adopted':
          systems = await getAdoptedSystems(database, log);
          break;
        case 'all':
          systems = await getAllSystems(database, log);
          break;
        default:
          systems = await getUnadoptedSystems(database, log);
      }

      timer.end({ filter, systemCount: systems.length });
      log.info('Systems fetched', { filter, count: systems.length });
      log.exit(200);
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(systems)
      };
    }

    if (event.httpMethod === 'POST') {
      const { systemId } = JSON.parse(event.body);
      
      if (!systemId) {
        log.warn('Missing systemId');
        timer.end({ error: 'missing_params' });
        log.exit(400);
        return {
          statusCode: 400,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Missing systemId' })
        };
      }

      log.info('Adopting system', { systemId });
      const result = await adoptSystem(database, systemId, log);
      
      if (result.success) {
        timer.end({ adopted: true });
        log.info('System adopted successfully', { systemId });
        log.exit(200);
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            message: 'System adopted successfully'
          })
        };
      } else {
        timer.end({ adopted: false });
        log.warn('Failed to adopt system', { systemId, error: result.error });
        log.exit(400);
        return {
          statusCode: 400,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: result.error || 'Failed to adopt system'
          })
        };
      }
    }

    log.warn('Method not allowed', { method: event.httpMethod });
    timer.end({ error: 'method_not_allowed' });
    log.exit(405);
    return {
      statusCode: 405,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    timer.end({ error: true });
    log.error('Admin systems error', { error: error.message, stack: error.stack });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal server error',
        details: error.message
      })
    };
  } finally {
    await client.close();
  }
};

async function getUnadoptedSystems(database, log) {
  log.debug('Querying unadopted systems');
  const systems = await database.collection('systems').aggregate([
    { $match: { adopted: false } },
    { $lookup: {
        from: 'records',
        localField: '_id',
        foreignField: 'systemId',
        as: 'records'
      }},
    { $addFields: { 
        recordCount: { $size: '$records' },
        id: { $toString: '$_id' }
      }},
    { $project: {
        _id: 0,
        records: 0
    }}
  ]).toArray();

  return systems.map(system => ({
    ...system,
    status: system.recordCount > 0 ? 'active' : 'inactive',
    createdAt: system.createdAt || new Date().toISOString(),
    lastActive: system.lastActive || null
  }));
}

async function getAdoptedSystems(database, log) {
  log.debug('Querying adopted systems');
  const systems = await database.collection('systems').aggregate([
    { $match: { 
        adopted: true
      }},
    { $lookup: {
        from: 'records',
        localField: '_id',
        foreignField: 'systemId',
        as: 'records'
      }},
    { $addFields: { 
        recordCount: { $size: '$records' },
        id: { $toString: '$_id' }
      }},
    { $project: {
        _id: 0,
        records: 0
    }}
  ]).toArray();

  return systems.map(system => ({
    ...system,
    status: system.recordCount > 0 ? 'active' : 'inactive',
    createdAt: system.createdAt || new Date().toISOString(),
    lastActive: system.lastActive || null
  }));
}

async function getAllSystems(database, log) {
  log.debug('Querying all systems');
  const systems = await database.collection('systems').aggregate([
    { $lookup: {
        from: 'records',
        localField: '_id',
        foreignField: 'systemId',
        as: 'records'
      }},
    { $addFields: { 
        recordCount: { $size: '$records' },
        id: { $toString: '$_id' }
      }},
    { $project: {
        _id: 0,
        records: 0
    }}
  ]).toArray();

  return systems.map(system => ({
    ...system,
    status: system.recordCount > 0 ? 'active' : 'inactive',
    createdAt: system.createdAt || new Date().toISOString(),
    lastActive: system.lastActive || null
  }));
}

async function adoptSystem(database, systemId, log) {
  try {
    // Check if system exists and is unadopted
    log.debug('Checking system for adoption', { systemId });
    const system = await database.collection('systems').findOne({
      _id: systemId,
      adopted: false
    });

    if (!system) {
      return { success: false, error: 'System not found or already adopted' };
    }

    // Update system to mark as adopted
    const result = await database.collection('systems').updateOne(
      { _id: systemId },
      { 
        $set: {
          adopted: true,
          adoptedAt: new Date(),
          lastActive: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return { success: false, error: 'Failed to update system' };
    }

    // Log the adoption
    await database.collection('system-adoption-log').insertOne({
      systemId,
      adoptedAt: new Date(),
      previousName: system.name,
      action: 'adopted'
    });

    log.debug('System adoption recorded', { systemId });
    return { success: true };
  } catch (error) {
    log.error('Error adopting system', { error: error.message, systemId });
    return { success: false, error: error.message };
  }
}
