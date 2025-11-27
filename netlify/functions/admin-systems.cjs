const { MongoClient } = require('mongodb');
const { createLogger } = require('./utils/logger.cjs');

// Validate environment variables
function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}

exports.handler = async (event, context) => {
  const log = createLogger('admin-systems', context);
  
  if (!validateEnvironment(log)) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  const database = client.db('battery-analysis');
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers
    };
  }

  try {
    await client.connect();
    
    const { httpMethod } = event;
    const queryStringParameters = event.queryStringParameters || {};
    const { userId, filter = 'unadopted' } = queryStringParameters;

    if (httpMethod === 'GET') {
      let systems;
      
      switch (filter) {
        case 'unadopted':
          systems = await getUnadoptedSystems(database, log);
          break;
        case 'adopted':
          systems = await getAdoptedSystems(database, userId, log);
          break;
        case 'all':
          systems = await getAllSystems(database, log);
          break;
        default:
          systems = await getUnadoptedSystems(database, log);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(systems)
      };
    }

    if (httpMethod === 'POST') {
      const { systemId, userId } = JSON.parse(event.body);
      
      if (!systemId || !userId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing systemId or userId' })
        };
      }

      const result = await adoptSystem(database, systemId, userId, log);
      
      if (result.success) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'System adopted successfully'
          })
        };
      } else {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: result.error || 'Failed to adopt system'
          })
        };
      }
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    log.error('Admin systems error:', { error: error.message, stack: error.stack });
    return {
      statusCode: 500,
      headers,
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

async function getAdoptedSystems(database, userId, log) {
  const systems = await database.collection('systems').aggregate([
    { $match: { 
        adopted: true,
        adoptedBy: userId 
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

async function adoptSystem(database, systemId, userId, log) {
  try {
    // Check if system exists and is unadopted
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
          adoptedBy: userId,
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
      userId,
      adoptedAt: new Date(),
      previousName: system.name,
      action: 'adopted'
    });

    return { success: true };
  } catch (error) {
    console.error('Error adopting system:', error);
    return { success: false, error: error.message };
  }
}

