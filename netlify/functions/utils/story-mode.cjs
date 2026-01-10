const { v4: uuidv4 } = require("uuid");
const { createTimer } = require('./logger.cjs');
const { performAnalysisPipeline } = require('./analysis-pipeline.cjs');
const { getCollection } = require('./mongodb.cjs');
const { getGeminiClient } = require('./geminiClient.cjs');

/**
 * Generate AI interpretation for a story using Gemini
 */
async function generateStoryInterpretation(story, log) {
  try {
    log.info('Generating AI interpretation for story', { storyId: story.id });
    
    const geminiClient = getGeminiClient(log);
    
    // Build context from timeline records
    const timelineContext = story.timeline.map((record, index) => {
      const data = record.data || {};
      return `Screenshot ${index + 1} (${record.fileName}):
  - Time: ${record.timestamp || 'Unknown'}
  - SOC: ${data.stateOfCharge || 'N/A'}%
  - Voltage: ${data.voltage || 'N/A'}V
  - Current: ${data.current || 'N/A'}A
  - Power: ${data.power || 'N/A'}W
  - Temperature: ${data.temperature || 'N/A'}°C`;
    }).join('\n\n');

    const prompt = `You are analyzing a sequence of BMS (Battery Management System) screenshots provided by an admin user.

**Story Title:** ${story.title}
**User Summary:** ${story.summary}
${story.userContext ? `**User Context:** ${story.userContext}` : ''}

**Timeline Data:**
${timelineContext}

Please provide a JSON response with the following structure:
{
  "summary": "A concise summary of what happened in this sequence",
  "trendAnalysis": "Analysis of any trends observed (charging/discharging patterns, efficiency, etc.)",
  "events": ["List of notable events or changes detected"],
  "recommendations": ["Any recommendations based on the observed data"]
}

Focus on:
1. Identifying the sequence of events and their causality
2. Correlating the user's context with the BMS data
3. Detecting any anomalies or noteworthy patterns
4. Providing actionable insights`;

    const response = await geminiClient.generateText(prompt);
    
    // Parse JSON response
    let interpretation;
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        interpretation = JSON.parse(jsonMatch[0]);
      } else {
        interpretation = { summary: response };
      }
    } catch (parseError) {
      log.warn('Failed to parse AI response as JSON, using raw text', { error: parseError.message });
      interpretation = { summary: response };
    }

    return {
      ...interpretation,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    log.error('Error generating story interpretation', { error: error.message });
    return {
      summary: 'AI interpretation could not be generated at this time.',
      generatedAt: new Date().toISOString()
    };
  }
}

async function handleStoryModeAnalysis(requestBody, idemKey, forceReanalysis, headers, log, context) {
  try {
    const { timeline, title, summary, userContext } = requestBody;
    const sequenceId = uuidv4();
    const storyTimer = createTimer(log, 'story-mode-analysis');

    log.info('Starting story mode analysis', { sequenceId, timelineCount: timeline.length, title });

    const timelineRecords = [];
    for (let i = 0; i < timeline.length; i++) {
      const imagePayload = timeline[i];
      imagePayload.sequenceId = sequenceId;
      imagePayload.timelinePosition = i;

      // This re-uses the single-image analysis logic
      const record = await performAnalysisPipeline(imagePayload, null, log, context);
      timelineRecords.push(record);
    }

    const story = {
      id: sequenceId,
      title,
      summary,
      userContext: userContext || null,
      timeline: timelineRecords,
      photos: [],
      createdAt: new Date().toISOString(),
    };

    // Generate AI interpretation
    const aiInterpretation = await generateStoryInterpretation(story, log);
    story.aiInterpretation = aiInterpretation;

    const storiesCollection = await getCollection('stories');
    await storiesCollection.insertOne(story);
    log.info('Story created and saved successfully', { sequenceId, title, hasAiInterpretation: !!story.aiInterpretation });

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

module.exports = { handleStoryModeAnalysis, generateStoryInterpretation };