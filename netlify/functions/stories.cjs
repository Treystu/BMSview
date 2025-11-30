const { getCollection } = require('./utils/mongodb.cjs');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { errorResponse } = require('./utils/errors.cjs');

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
    };
  }

  const log = createLoggerFromEvent('stories', event, context);
  log.entry({ method: event.httpMethod, path: event.path });
  const timer = createTimer(log, 'stories');

  try {
    if (!process.env.MONGODB_URI) {
      log.error('MONGODB_URI is not set');
      timer.end({ error: 'missing_mongodb' });
      log.exit(500);
      return errorResponse(500, 'server_error', 'Server configuration error', null, headers);
    }

    const storiesCollection = await getCollection('stories');

    // GET request - list stories or get a specific story
    if (event.httpMethod === 'GET') {
      const { id, page = '1', limit = '20' } = event.queryStringParameters || {};

      // Get a specific story by ID
      if (id) {
        log.info('Fetching story by ID', { id });
        const story = await storiesCollection.findOne({ id });
        
        if (!story) {
          log.warn('Story not found', { id });
          timer.end({ found: false });
          log.exit(404);
          return errorResponse(404, 'not_found', 'Story not found', { id }, headers);
        }

        log.info('Successfully fetched story', { id });
        log.exit(200);

        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(story),
        };
      }

      // List all stories with pagination
      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      log.info('Listing stories', { page: pageNum, limit: limitNum });

      const [stories, totalCount] = await Promise.all([
        storiesCollection
          .find({})
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .toArray(),
        storiesCollection.countDocuments({})
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

    // DELETE request - delete a story
    if (event.httpMethod === 'DELETE') {
      const { id } = event.queryStringParameters || {};

      if (!id) {
        return errorResponse(400, 'bad_request', 'Missing required query parameter: id', null, headers);
      }

      log.info('Deleting story', { id });
      const result = await storiesCollection.deleteOne({ id });

      if (result.deletedCount === 0) {
        log.warn('Story not found for deletion', { id });
        return errorResponse(404, 'not_found', 'Story not found', { id }, headers);
      }

      log.info('Successfully deleted story', { id });
      log.exit(200);

      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, id }),
      };
    }

    // Unsupported method
    log.warn('Method not allowed', { method: event.httpMethod });
    timer.end({ error: 'method_not_allowed' });
    log.exit(405);
    return errorResponse(405, 'method_not_allowed', `Method ${event.httpMethod} not allowed`, null, headers);

  } catch (error) {
    timer.end({ error: true });
    log.error('Error in stories endpoint', { error: error.message, stack: error.stack });
    log.exit(500);
    return errorResponse(500, 'internal_error', 'Failed to process request', { message: error.message }, headers);
  }
};
