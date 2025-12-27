// @ts-nocheck

const { getCollection } = require('./utils/mongodb.cjs');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { createStandardEntryMeta } = require('./utils/handler-logging.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

// Validate environment variables
function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}

const { COLLECTIONS } = require('./utils/collections.cjs');

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);

  const log = createLoggerFromEvent('admin-systems', event, context);
  const timer = createTimer(log, 'admin-systems');
  log.entry(createStandardEntryMeta(event));

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

  try {
    const systemsCollection = await getCollection(COLLECTIONS.SYSTEMS);
    const historyCollection = await getCollection(COLLECTIONS.HISTORY);
    const adoptionLogCollection = await getCollection(COLLECTIONS.SYSTEM_ADOPTION_LOG);

    const queryStringParameters = event.queryStringParameters || {};
    const { filter = 'unadopted' } = queryStringParameters;

    if (event.httpMethod === 'GET') {
      log.debug('Fetching systems', { filter });
      let systems;

      switch (filter) {
        case 'unadopted':
          systems = await getUnadoptedSystems(systemsCollection, log);
          break;
        case 'adopted':
          systems = await getAdoptedSystems(systemsCollection, log);
          break;
        case 'all':
          systems = await getAllSystems(systemsCollection, log);
          break;
        default:
          systems = await getUnadoptedSystems(systemsCollection, log);
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
      const result = await adoptSystem(systemsCollection, adoptionLogCollection, systemId, log);

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
  }
};

async function getUnadoptedSystems(systemsCollection, log) {
  log.debug('Querying unadopted systems');
  const systems = await systemsCollection.aggregate([
    { $match: { adopted: false } },
    {
      $lookup: {
        from: COLLECTIONS.HISTORY,
        localField: '_id',
        foreignField: 'systemId',
        as: 'records'
      }
    },
    {
      $addFields: {
        recordCount: { $size: '$records' },
        id: { $toString: '$_id' }
      }
    },
    {
      $project: {
        _id: 0,
        records: 0
      }
    }
  ]).toArray();

  return systems.map(system => ({
    ...system,
    status: system.recordCount > 0 ? 'active' : 'inactive',
    createdAt: system.createdAt || new Date().toISOString(),
    lastActive: system.lastActive || null
  }));
}

async function getAdoptedSystems(systemsCollection, log) {
  log.debug('Querying adopted systems');
  const systems = await systemsCollection.aggregate([
    {
      $match: {
        adopted: true
      }
    },
    {
      $lookup: {
        from: COLLECTIONS.HISTORY,
        localField: '_id',
        foreignField: 'systemId',
        as: 'records'
      }
    },
    {
      $addFields: {
        recordCount: { $size: '$records' },
        id: { $toString: '$_id' }
      }
    },
    {
      $project: {
        _id: 0,
        records: 0
      }
    }
  ]).toArray();

  return systems.map(system => ({
    ...system,
    status: system.recordCount > 0 ? 'active' : 'inactive',
    createdAt: system.createdAt || new Date().toISOString(),
    lastActive: system.lastActive || null
  }));
}

async function getAllSystems(systemsCollection, log) {
  log.debug('Querying all systems');
  const systems = await systemsCollection.aggregate([
    {
      $lookup: {
        from: COLLECTIONS.HISTORY,
        localField: '_id',
        foreignField: 'systemId',
        as: 'records'
      }
    },
    {
      $addFields: {
        recordCount: { $size: '$records' },
        id: { $toString: '$_id' }
      }
    },
    {
      $project: {
        _id: 0,
        records: 0
      }
    }
  ]).toArray();

  return systems.map(system => ({
    ...system,
    status: system.recordCount > 0 ? 'active' : 'inactive',
    createdAt: system.createdAt || new Date().toISOString(),
    lastActive: system.lastActive || null
  }));
}

async function adoptSystem(systemsCollection, adoptionLogCollection, systemId, log) {
  try {
    // Check if system exists and is unadopted
    log.debug('Checking system for adoption', { systemId });
    const system = await systemsCollection.findOne({
      _id: systemId,
      adopted: false
    });

    if (!system) {
      return { success: false, error: 'System not found or already adopted' };
    }

    // Update system to mark as adopted
    const result = await systemsCollection.updateOne(
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
    await adoptionLogCollection.insertOne({
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
