const { MongoClient } = require('mongodb');

// MongoDB connection
const client = new MongoClient(process.env.MONGODB_URI);
const database = client.db('battery-analysis');

exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
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
          systems = await getUnadoptedSystems();
          break;
        case 'adopted':
          systems = await getAdoptedSystems(userId);
          break;
        case 'all':
          systems = await getAllSystems();
          break;
        default:
          systems = await getUnadoptedSystems();
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

      const result = await adoptSystem(systemId, userId);
      
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
    console.error('Admin systems error:', error);
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

async function getUnadoptedSystems() {
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

async function getAdoptedSystems(userId) {
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

async function getAllSystems() {
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

async function adoptSystem(systemId, userId) {
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

// Additional helper functions for system management
async function createMockSystems() {
  // Create some mock unadopted systems for testing
  const mockSystems = [
    {
      name: 'Battery System Alpha',
      adopted: false,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      type: 'lithium-ion'
    },
    {
      name: 'Energy Storage Beta',
      adopted: false,
      createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
      type: 'lead-acid'
    },
    {
      name: 'Solar Battery Gamma',
      adopted: false,
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      type: 'lithium-ion'
    }
  ];

  for (const system of mockSystems) {
    const existing = await database.collection('systems').findOne({
      name: system.name
    });

    if (!existing) {
      await database.collection('systems').insertOne({
        ...system,
        _id: `system-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      });
    }
  }
}

// Initialize mock data if needed
async function initializeMockData() {
  const systemCount = await database.collection('systems').countDocuments();
  if (systemCount === 0) {
    await createMockSystems();
  }
}