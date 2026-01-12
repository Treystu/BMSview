// @ts-nocheck
const { getCollection } = require('./utils/mongodb.cjs');
const { v4: uuidv4 } = require("uuid");
const { createLogger, createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { createStandardEntryMeta, logDebugRequestSummary } = require('./utils/handler-logging.cjs');
const { createForwardingLogger } = require('./utils/log-forwarder.cjs');

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
  const log = createLoggerFromEvent('upload-story-photo', event, context);
  const timer = createTimer(log, 'upload-story-photo-handler');
  const headers = getCorsHeaders(event);

  log.entry(createStandardEntryMeta(event));
  logDebugRequestSummary(log, event, { label: 'Upload story photo request', includeBody: true, bodyMaxStringLength: 20000 });

  // Unified logging: also forward to centralized collector
  const forwardLog = createForwardingLogger('upload-story-photo');

  if (event.httpMethod === 'OPTIONS') {
    log.debug('OPTIONS preflight request');
    timer.end();
    log.exit(200);
    return {
      statusCode: 200,
      headers,
    };
  }

  try {
    if (!process.env.MONGODB_URI) {
      log.error('MONGODB_URI is not set');
      timer.end({ success: false, error: 'configuration' });
      log.exit(500);
      return errorResponse(500, 'server_error', 'Server configuration error', undefined, headers);
    }

    const { storyId, caption, timestamp } = event.queryStringParameters || {};
    if (!storyId || !caption || !timestamp) {
      return errorResponse(400, 'bad_request', 'Missing required query parameters: storyId, caption, timestamp', undefined, headers);
    }

    let image;
    try {
      image = JSON.parse(event.body).image;
      if (!image) {
        return errorResponse(400, 'bad_request', 'Missing image in request body', undefined, headers);
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
      timer.end({ success: false });
      log.exit(404);
      return errorResponse(404, 'not_found', 'Story not found', { storyId }, headers);
    }

    log.info('Successfully added photo to story', { storyId, photoId });
    timer.end({ success: true });
    log.exit(200, { storyId, photoId });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(photo),
    };
  } catch (error) {
    log.error('Error uploading story photo', { error: error.message, stack: error.stack });
    timer.end({ success: false, error: error.message });
    log.exit(500);
    return errorResponse(500, 'internal_error', 'Failed to upload photo', { message: error.message }, headers);
  }
};