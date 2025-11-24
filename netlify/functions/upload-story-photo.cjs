const { getCollection } = require('./utils/mongodb.cjs');
const { v4: uuidv4 } = require("uuid");
const { createLogger } = require('./utils/logger.cjs');

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}
const { getCorsHeaders } = require('./utils/cors.cjs');
const { errorResponse } = require('./utils/errors.cjs');

exports.handler = async (event, context) => {
  const log = createLogger('upload-story-photo', context);
  const headers = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
    };
  }

  try {
    log.entry({ method: event.httpMethod, path: event.path });

    if (!process.env.MONGODB_URI) {
      log.error('MONGODB_URI is not set');
      return errorResponse(500, 'server_error', 'Server configuration error', null, headers);
    }

    const { storyId, caption, timestamp } = event.queryStringParameters || {};
    if (!storyId || !caption || !timestamp) {
      return errorResponse(400, 'bad_request', 'Missing required query parameters: storyId, caption, timestamp', null, headers);
    }

    let image;
    try {
      image = JSON.parse(event.body).image;
      if (!image) {
        return errorResponse(400, 'bad_request', 'Missing image in request body', null, headers);
      }
    } catch (e) {
      log.warn('Failed to parse request body as JSON', { error: e.message });
      return errorResponse(400, 'bad_request', 'Invalid JSON in request body', { message: e.message }, headers);
    }

    log.info('Received photo upload request', { storyId });

    const photoId = uuidv4();
    const photo = {
      id: photoId,
      storyId,
      caption,
      timestamp,
      url: `/.netlify/blobs/story-photos/${photoId}.png`,
    };

    const storiesCollection = await getCollection('stories');
    const updateResult = await storiesCollection.updateOne(
      { id: storyId },
      { $push: { photos: photo } }
    );

    if (updateResult.modifiedCount === 0) {
      log.warn('Story not found or no changes made', { storyId });
      return errorResponse(404, 'not_found', 'Story not found', { storyId }, headers);
    }

    log.info('Successfully added photo to story', { storyId, photoId });
    log.exit(200);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(photo),
    };
  } catch (error) {
    log.error('Error uploading story photo', { error: error.message, stack: error.stack });
    return errorResponse(500, 'internal_error', 'Failed to upload photo', { message: error.message }, headers);
  }
};