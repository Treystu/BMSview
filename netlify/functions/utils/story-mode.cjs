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
    
    const geminiClient = getGeminiClient();
    
    // Build context from timeline records
    const timelineContext = story.timeline.map((record, index) => {
      const analysis = record.analysis || {};
      return `Screenshot ${index + 1} (${record.fileName}):
  - Time: ${record.timestamp || 'Unknown'}
  - SOC: ${analysis.stateOfCharge || 'N/A'}%
  - Voltage: ${analysis.overallVoltage || 'N/A'}V
  - Current: ${analysis.current || 'N/A'}A
  - Power: ${analysis.power || 'N/A'}W
  - Temperature: ${analysis.temperature || 'N/A'}°C`;
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

    // Use callAPI (the correct method) instead of non-existent generateText
    const result = await geminiClient.callAPI(prompt, { model: 'gemini-2.5-flash' }, log);
    
    // Extract text from Gemini response
    const candidates = result?.candidates;
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      throw new Error('Invalid response structure from Gemini API');
    }
    const responseText = candidates[0]?.content?.parts?.[0]?.text || '';
    
    // Parse JSON response
    let interpretation;
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        interpretation = JSON.parse(jsonMatch[0]);
      } else {
        interpretation = { summary: responseText };
      }
    } catch (parseError) {
      log.warn('Failed to parse AI response as JSON, using raw text', { error: parseError.message });
      interpretation = { summary: responseText };
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

    // Process images in PARALLEL to avoid Netlify timeout (7 images × 6s = 42s > 26s limit)
    log.info('Processing timeline images in parallel', { count: timeline.length });
    
    const analysisPromises = timeline.map((imagePayload, i) => {
      // Clone to avoid mutation issues in parallel execution
      const payload = { ...imagePayload, sequenceId, timelinePosition: i };
      return performAnalysisPipeline(payload, null, log, context)
        .then(record => ({ index: i, record }))
        .catch(error => {
          log.error('Failed to analyze timeline image', { index: i, fileName: imagePayload.fileName, error: error.message });
          return { index: i, record: null, error: error.message };
        });
    });

    const results = await Promise.all(analysisPromises);
    
    // Sort by original timeline position and filter out failures
    const timelineRecords = results
      .sort((a, b) => a.index - b.index)
      .filter(r => r.record !== null)
      .map(r => r.record);
    
    log.info('Timeline analysis complete', { 
      requested: timeline.length, 
      successful: timelineRecords.length,
      failed: timeline.length - timelineRecords.length
    });

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