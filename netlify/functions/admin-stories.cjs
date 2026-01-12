const { getCollection } = require('./utils/mongodb.cjs');
const { ObjectId } = require('mongodb');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { errorResponse } = require('./utils/errors.cjs');
const { ensureAdminAuthorized } = require('./utils/auth.cjs');
const { v4: uuidv4 } = require('uuid');
const {
  createStandardEntryMeta,
  logDebugRequestSummary
} = require('./utils/handler-logging.cjs');

/**
 * Admin Stories - CRUD operations for story management
 * Stories link multiple analyses together with context and annotations
 * to improve AI insight generation
 */

/**
 * @param {any} event
 * @param {any} context
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);

  const log = createLoggerFromEvent('admin-stories', event, context);
  /** @type {any} */
  const timer = createTimer(log, 'admin-stories');
  const sanitizedHeaders = event.headers ? {
    ...event.headers,
    authorization: event.headers.authorization ? '[REDACTED]' : undefined,
    cookie: event.headers.cookie ? '[REDACTED]' : undefined,
    'x-api-key': event.headers['x-api-key'] ? '[REDACTED]' : undefined
  } : {};
  log.entry(createStandardEntryMeta(event, { query: event.queryStringParameters, headers: sanitizedHeaders }));
  logDebugRequestSummary(log, event, { label: 'Admin stories request', includeBody: true, bodyMaxStringLength: 20000 });

  if (event.httpMethod === 'OPTIONS') {
    timer.end({ outcome: 'preflight' });
    log.exit(200, { outcome: 'preflight' });
    return { statusCode: 200, headers };
  }

  try {
    if (!process.env.MONGODB_URI) {
      log.error('MONGODB_URI is not set');
      timer.end({ outcome: 'configuration_error' });
      log.exit(500, { outcome: 'configuration_error' });
      return errorResponse(500, 'server_error', 'Server configuration error', undefined, headers);
    }

    const authResponse = await ensureAdminAuthorized(event, context, headers, log);
    if (authResponse) {
      timer.end({ outcome: 'unauthorized' });
      log.exit(403, { outcome: 'unauthorized' });
      return authResponse;
    }

    const storiesCollection = await getCollection('stories');
    const { id, action } = event.queryStringParameters || {};

    // GET - List stories or get a specific story
    if (event.httpMethod === 'GET') {
      // Get a specific story by ID
      if (id) {
        log.info('Fetching story by ID', { id });
        /** @type {any} */
        const storyFilter = ObjectId.isValid(id)
          ? { $or: [{ id }, { _id: new ObjectId(id) }] }
          : { id };
        const story = await storiesCollection.findOne(storyFilter);

        if (!story) {
          log.warn('Story not found', { id });
          timer.end({ found: false });
          log.exit(404);
          return errorResponse(404, 'not_found', 'Story not found', { id }, headers);
        }

        log.info('Successfully fetched story', { id, title: story.title });
        timer.end({ found: true });
        log.exit(200);

        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(story),
        };
      }

      // List all stories with pagination
      const { page = '1', limit = '20', isActive, systemIdentifier, tags } = event.queryStringParameters || {};
      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      // Build filter
      /** @type {Record<string, any>} */
      const filter = {};
      if (isActive !== undefined) {
        filter.isActive = isActive === 'true';
      }
      if (systemIdentifier) {
        filter.systemIdentifier = systemIdentifier;
      }
      if (tags) {
        filter.tags = { $in: tags.split(',').map(/** @param {string} t */(t) => t.trim()) };
      }

      log.info('Listing stories', { page: pageNum, limit: limitNum, filter });

      const [stories, totalCount] = await Promise.all([
        storiesCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .toArray(),
        storiesCollection.countDocuments(filter)
      ]);

      const response = {
        items: stories,
        totalItems: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
      };

      log.info('Successfully listed stories', { count: stories.length, totalCount });
      log.exit(200);

      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      };
    }

    // POST - Create a new story or add event to existing story
    if (event.httpMethod === 'POST') {
      let body;
      try {
        body = JSON.parse(event.body);
      } catch (e) {
        return errorResponse(400, 'bad_request', 'Invalid JSON body', undefined, headers);
      }

      // Add event to existing story
      if (action === 'add-event' && id) {
        const { analysisId, annotation, contextNotes } = body;

        if (!analysisId) {
          return errorResponse(400, 'bad_request', 'Missing analysisId', undefined, headers);
        }

        // Fetch the analysis record to get its timestamp
        // Use 'history' collection - that's where records are stored
        const analysisCollection = await getCollection('history');
        /** @type {any} */
        const analysisFilter = ObjectId.isValid(analysisId)
          ? { $or: [{ _id: new ObjectId(analysisId) }, { id: analysisId }] }
          : { id: analysisId };
        const analysis = await analysisCollection.findOne(analysisFilter);

        if (!analysis) {
          return errorResponse(404, 'not_found', 'Analysis not found', { analysisId }, headers);
        }

        const newEvent = {
          analysisId: analysis._id ? analysis._id.toString() : analysisId,
          timestamp: analysis.timestamp || new Date().toISOString(),
          annotation: annotation || '',
          contextNotes: contextNotes || {
            priorEvents: '',
            environmentalFactors: '',
            maintenanceActions: ''
          },
          addedAt: new Date().toISOString()
        };

        const updateResult = await storiesCollection.updateOne(
          /** @type {any} */(ObjectId.isValid(id)
            ? { $or: [{ id }, { _id: new ObjectId(id) }] }
            : { id }),
          /** @type {any} */({
            $push: { events: newEvent },
            $set: {
              updatedAt: new Date().toISOString(),
              'metadata.totalEvents': { $add: ['$metadata.totalEvents', 1] }
            }
          })
        );

        if (updateResult.modifiedCount === 0) {
          return errorResponse(404, 'not_found', 'Story not found', { id }, headers);
        }

        // Update metadata
        await updateStoryMetadata(storiesCollection, id);

        log.info('Added event to story', { storyId: id, analysisId });
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, event: newEvent }),
        };
      }

      // Create new story
      const { title, description, systemIdentifier, events, tags, isActive = true } = body;

      if (!title) {
        return errorResponse(400, 'bad_request', 'Missing required field: title', undefined, headers);
      }

      const storyId = uuidv4();
      const now = new Date().toISOString();

      const story = {
        id: storyId,
        adminId: body.adminId || 'admin', // Could be extracted from JWT
        title,
        description: description || '',
        systemIdentifier: systemIdentifier || null,
        events: events || [],
        tags: tags || [],
        isActive,
        createdAt: now,
        updatedAt: now,
        metadata: {
          totalEvents: events ? events.length : 0,
          dateRange: calculateDateRange(events || [])
        }
      };

      await storiesCollection.insertOne(story);
      log.info('Created new story', { storyId, title });

      return {
        statusCode: 201,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(story),
      };
    }

    // PUT - Update a story
    if (event.httpMethod === 'PUT') {
      if (!id) {
        return errorResponse(400, 'bad_request', 'Missing story ID', undefined, headers);
      }

      let body;
      try {
        body = JSON.parse(event.body);
      } catch (e) {
        return errorResponse(400, 'bad_request', 'Invalid JSON body', undefined, headers);
      }

      const { title, description, systemIdentifier, events, tags, isActive } = body;
      /** @type {Record<string, any>} */
      const updateFields = { updatedAt: new Date().toISOString() };

      if (title !== undefined) updateFields.title = title;
      if (description !== undefined) updateFields.description = description;
      if (systemIdentifier !== undefined) updateFields.systemIdentifier = systemIdentifier;
      if (events !== undefined) {
        updateFields.events = events;
        updateFields['metadata.totalEvents'] = events.length;
        updateFields['metadata.dateRange'] = calculateDateRange(events);
      }
      if (tags !== undefined) updateFields.tags = tags;
      if (isActive !== undefined) updateFields.isActive = isActive;

      const updateResult = await storiesCollection.updateOne(
        /** @type {any} */(ObjectId.isValid(id)
          ? { $or: [{ id }, { _id: new ObjectId(id) }] }
          : { id }),
        { $set: updateFields }
      );

      if (updateResult.matchedCount === 0) {
        return errorResponse(404, 'not_found', 'Story not found', { id }, headers);
      }

      log.info('Updated story', { id, fields: Object.keys(updateFields) });

      // Fetch and return updated story
      const updatedStory = await storiesCollection.findOne({
        $or: ObjectId.isValid(id) ? [{ id }, { _id: new ObjectId(id) }] : [{ id }]
      });

      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedStory),
      };
    }

    // DELETE - Delete a story or remove event from story
    if (event.httpMethod === 'DELETE') {
      if (!id) {
        return errorResponse(400, 'bad_request', 'Missing story ID', undefined, headers);
      }

      // Remove event from story
      if (action === 'remove-event') {
        const { eventIndex } = event.queryStringParameters || {};

        if (eventIndex === undefined) {
          return errorResponse(400, 'bad_request', 'Missing eventIndex', undefined, headers);
        }

        const story = await storiesCollection.findOne({
          $or: ObjectId.isValid(id) ? [{ id }, { _id: new ObjectId(id) }] : [{ id }]
        });

        if (!story) {
          return errorResponse(404, 'not_found', 'Story not found', { id }, headers);
        }

        const index = parseInt(eventIndex, 10);
        if (index < 0 || index >= story.events.length) {
          return errorResponse(400, 'bad_request', 'Invalid event index', { eventIndex }, headers);
        }

        story.events.splice(index, 1);

        await storiesCollection.updateOne(
          /** @type {any} */(ObjectId.isValid(id) ? { $or: [{ id }, { _id: new ObjectId(id) }] } : { id }),
          /** @type {any} */({
            $set: {
              events: story.events,
              updatedAt: new Date().toISOString(),
              'metadata.totalEvents': story.events.length,
              'metadata.dateRange': calculateDateRange(story.events)
            }
          })
        );

        log.info('Removed event from story', { storyId: id, eventIndex: index });
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true }),
        };
      }

      // Delete entire story
      const result = await storiesCollection.deleteOne({
        $or: ObjectId.isValid(id) ? [{ id }, { _id: new ObjectId(id) }] : [{ id }]
      });

      if (result.deletedCount === 0) {
        return errorResponse(404, 'not_found', 'Story not found', { id }, headers);
      }

      log.info('Deleted story', { id });
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, id }),
      };
    }

    log.warn('Method not allowed', { method: event.httpMethod });
    timer.end({ error: 'method_not_allowed' });
    log.exit(405);
    return errorResponse(405, 'method_not_allowed', `Method ${event.httpMethod} not allowed`, undefined, headers);

  } catch (error) {
    timer.end({ error: true });
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    log.error('Error in admin-stories endpoint', { error: message, stack });
    log.exit(500);
    return errorResponse(500, 'internal_error', 'Failed to process request', { message }, headers);
  }
};

/**
 * Calculate the date range for a list of events
 */
/**
 * Calculate the date range for a list of events
 * @param {any[]} events
 */
function calculateDateRange(events) {
  if (!events || events.length === 0) {
    return { start: null, end: null };
  }

  const timestamps = events
    .map(/** @param {any} e */(e) => e.timestamp ? new Date(e.timestamp).getTime() : null)
    .filter(/** @param {number|null} t */(t) => t !== null);

  if (timestamps.length === 0) {
    return { start: null, end: null };
  }

  return {
    start: new Date(Math.min(...timestamps)).toISOString(),
    end: new Date(Math.max(...timestamps)).toISOString()
  };
}

/**
 * Update story metadata after changes
 */
/**
 * @param {any} storiesCollection
 * @param {string} storyId
 */
async function updateStoryMetadata(storiesCollection, storyId) {
  const story = await storiesCollection.findOne(
    /** @type {any} */(ObjectId.isValid(storyId)
      ? { $or: [{ id: storyId }, { _id: new ObjectId(storyId) }] }
      : { id: storyId })
  );

  if (story) {
    await storiesCollection.updateOne(
      /** @type {any} */(ObjectId.isValid(storyId)
        ? { $or: [{ id: storyId }, { _id: new ObjectId(storyId) }] }
        : { id: storyId }),
      /** @type {any} */({
        $set: {
          'metadata.totalEvents': story.events ? story.events.length : 0,
          'metadata.dateRange': calculateDateRange(story.events || [])
        }
      })
    );
  }
}
