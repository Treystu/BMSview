<![CDATA[
const { v4: uuidv4 } = require("uuid");
const { createTimer } = require('./logger.cjs');
const { executeAnalysisPipeline } = require('./analysis-pipeline.cjs');

async function handleStoryModeAnalysis(requestBody, idemKey, forceReanalysis, headers, log, context) {
  try {
    const { timeline, title, summary } = requestBody;
    const sequenceId = uuidv4();
  const storyTimer = createTimer(log, 'story-mode-analysis');

  log.info('Starting story mode analysis', { sequenceId, timelineCount: timeline.length, title });

  const timelineRecords = [];
  for (let i = 0; i < timeline.length; i++) {
    const imagePayload = timeline[i];
    imagePayload.sequenceId = sequenceId;
    imagePayload.timelinePosition = i;

    // This re-uses the single-image analysis logic
    const record = await executeAnalysisPipeline(imagePayload, log, context);
    timelineRecords.push(record);
  }

  const story = {
    id: sequenceId,
    title,
    summary,
    timeline: timelineRecords,
    photos: [], // Photo upload will be a separate step
  };

  // Here you would save the story to a new 'stories' collection in MongoDB
  // For now, we'll just log it.
  log.info('Story created successfully', { sequenceId, title });

  const durationMs = storyTimer.end();
  log.exit(200, { mode: 'story', durationMs });

  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(story),
  };
  } catch (error) {
    log.error('Error in handleStoryModeAnalysis', { error: error.message, stack: error.stack });
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to process story mode analysis' })
    };
  }
}

module.exports = { handleStoryModeAnalysis };
]]>