Implementation Guide: Agentic Insights with Tool Use

Objective: Update the backend insights generation logic to use a ReAct (Reasoning + Acting) loop. The Gemini model should be able to request additional historical BMS data if the initial 30-point dataset is insufficient to answer the user's question.

Architectural Change:

Current: Request -> Gemini -> Final Answer

New: Request -> Gemini -> [Decide: Tool Call or Answer?] -> (If Tool) Query DB -> Add to History -> Repeat Loop -> Final Answer

Step 1: Define the Data Retrieval Tool

We need a precise definition of the tool Gemini is allowed to use.

Task: Create or update netlify/functions/utils/gemini-tools.cjs.
Action: Overwrite with the following standard tool definition.

/**
 * Defines the tools available to the Gemini model for generating insights.
 */

const BMS_DATA_TOOL = {
  name: "request_bms_data",
  description: "Requests historical battery management system (BMS) data when the currently available data is insufficient to answer the user's question. Use this to spot long-term trends, analyze specific past events, or get a broader context.",
  parameters: {
    type: "OBJECT",
    properties: {
      metric: {
        type: "STRING",
        description: "The specific data field needed. Valid options: 'pack_voltage', 'pack_current', 'soc' (state of charge), 'cell_voltage_difference' (delta between highest and lowest cell), 'cell_temperatures' (avg temp), 'power' (calculated voltage * current).",
        enum: ["pack_voltage", "pack_current", "soc", "cell_voltage_difference", "cell_temperatures", "power"]
      },
      start_date: {
        type: "STRING",
        description: "Start date for the data range in ISO 8601 format (YYYY-MM-DD). Example: '2025-01-01'."
      },
      end_date: {
        type: "STRING",
        description: "End date for the data range in ISO 8601 format (YYYY-MM-DD). Example: '2025-01-31'."
      },
      granularity: {
        type: "STRING",
        description: "The desired aggregation level. Use 'daily' for long ranges (>30 days), 'hourly' for medium ranges (7-30 days), and 'raw' only for very short, specific event analysis (<2 days). Defaults to 'daily' if unsure.",
        enum: ["raw", "hourly", "daily"]
      }
    },
    required: ["metric", "start_date", "end_date"]
  }
};

module.exports = {
  TOOLS: [BMS_DATA_TOOL],
  TOOL_DEFINITIONS: {
    request_bms_data: BMS_DATA_TOOL
  }
};


Step 2: Create the Tool Executor (Data Fetcher)

The agent needs a way to actually run the tool when Gemini calls it. This requires querying MongoDB and aggregating the results.

Task: Create netlify/functions/utils/tool-executor.cjs.
Action: Create the file with the following logic.

const { getCluster } = require('./mongodb.cjs');

/**
 * Aggregates data based on requested granularity.
 */
async function executeBmsDataRequest(systemId, params) {
  console.log(`[ToolExecutor] Executing BMS data request for ${systemId}:`, params);
  const { metric, start_date, end_date, granularity = 'daily' } = params;

  const start = new Date(start_date);
  const end = new Date(end_date);
  // Ensure we don't query future data if end_date is crazy
  const now = new Date();
  if (end > now) end = now;

  let collection;
  try {
    const mongo = await getCluster();
    const db = mongo.db('bms_data'); // Adjust DB name if different in your actual setup
    collection = db.collection('bms_logs'); // Adjust collection name
  } catch (e) {
    console.error("Failed to connect to DB for tool execution", e);
    return { error: "Database connection failed." };
  }

  // Base match stage
  const matchStage = {
    $match: {
      systemId: systemId,
      timestamp: { $gte: start, $lte: end }
    }
  };

  // Define aggregation based on metric map to DB field names
  // Adjust these field names to match your actual MongoDB schema
  const metricMap = {
    'pack_voltage': '$pack_voltage',
    'pack_current': '$pack_current',
    'soc': '$soc',
    'cell_voltage_difference': { $subtract: [{ $max: "$cell_voltages" }, { $min: "$cell_voltages" }] },
    // If cell_voltages is not an array, adjust standard deviation or min/max logic here
    'cell_temperatures': { $avg: "$temperatures" },
    'power': { $multiply: ['$pack_voltage', '$pack_current'] }
  };

  const selectedMetric = metricMap[metric] || '$pack_voltage';

  let pipeline = [matchStage];

  if (granularity === 'raw') {
     // Limit raw data to prevent blowing up context window
     pipeline.push({ $sort: { timestamp: 1 } });
     pipeline.push({ $limit: 500 });
     pipeline.push({ $project: { timestamp: 1, [metric]: selectedMetric } });
  } else {
      // Define time grouping
      const timeFormat = granularity === 'daily' ? '%Y-%m-%d' : '%Y-%m-%d-%H';

      pipeline.push({
          $group: {
              _id: { $dateToString: { format: timeFormat, date: "$timestamp" } },
              avg_value: { $avg: selectedMetric },
              min_value: { $min: selectedMetric },
              max_value: { $max: selectedMetric },
              sample_count: { $sum: 1 }
          }
      });
      pipeline.push({ $sort: { _id: 1 } });
  }

  try {
    const results = await collection.aggregate(pipeline).toArray();
    return {
      metric,
      granularity,
      data_points: results.length,
      data: results
    };
  } catch (error) {
    console.error("[ToolExecutor] Aggregation failed:", error);
    return { error: `Data retrieval failed: ${error.message}` };
  }
}

module.exports = { executeBmsDataRequest };


Step 3: Update Gemini Client to Support Tools

We need to ensure our base client can handle sending standard tools parameters to the Gemini API.

Task: Update netlify/functions/utils/geminiClient.cjs.
Action: Verify and update the generateContent call to include the tools property if passed.

(Self-Correction: Ensure you are using a model version that supports stable tool use, like gemini-1.5-flash or gemini-1.5-pro).

// In netlify/functions/utils/geminiClient.cjs

// ... existing imports

async function generateContent(prompt, options = {}) {
  // ... existing setup ...

  // ENSURE THIS PART EXISTS OR IS ADDED:
  const requestBody = {
    contents: [
       // ... ensure history is handled correctly here if options.history is passed
       ...(options.history || []),
       { role: 'user', parts: [{ text: prompt }] }
    ],
    generationConfig: {
      // ... existing config ...
    }
  };

  // ADD THIS: Support for tools
  if (options.tools) {
      requestBody.tools = [{ function_declarations: options.tools }];
      // Force the model to use standard tool calling mode
      requestBody.tool_config = { function_calling_config: { mode: "AUTO" } };
  }

  // ... execute fetch ...
}


Step 4: The "Insights Loop" (Core Logic Update)

This is the biggest change. We are replacing the linear generateInsights function with a loop.

Task: Rewrite netlify/functions/utils/insights-guru.cjs.
Action: Replace the main generation logic with this Agentic Loop.

const { generateContent } = require('./geminiClient.cjs');
const { TOOLS } = require('./gemini-tools.cjs');
const { executeBmsDataRequest } = require('./tool-executor.cjs');

const MAX_TURNS = 5; // Prevent infinite loops

async function generateInsights(dataContext, userQuestion, systemId) {
    let conversationHistory = [
        {
            role: 'user',
            parts: [{
                text: `System Prompt: You are an expert BMS (Battery Management System) analyst.
Your goal is to answer the user's question accurately based *only* on verified data.
You have access to a tool 'request_bms_data' to fetch historical data if the initial snippet is insufficient.
Don't guess. If you need 30 days of voltage data to determine a trend, USE THE TOOL.
Current Date: ${new Date().toISOString().split('T')[0]}
Initial Data Snippet provided below.
\nUser Question: "${userQuestion}"\n
Initial Data: ${JSON.stringify(dataContext.slice(0, 50))}` // Limit initial data dump
            }]
        }
    ];

    let turnCount = 0;

    while (turnCount < MAX_TURNS) {
        turnCount++;
        console.log(`[InsightsGuru] Loop turn ${turnCount}`);

        // 1. Call Gemini with current history and tools
        const response = await generateContent(null, { // Pass null prompt, rely on history
             history: conversationHistory,
             tools: TOOLS
        });

        const responseContent = response.candidates[0].content;
        const responseParts = responseContent.parts;

        // Add model's response to history immediately to maintain conversational state
        conversationHistory.push(responseContent);

        // 2. Check for Tool Calls
        const toolCalls = responseParts.filter(part => part.functionCall);

        if (toolCalls.length > 0) {
            console.log(`[InsightsGuru] Model requested ${toolCalls.length} tools.`);

            // 3. Execute Tools
            for (const call of toolCalls) {
                const functionName = call.functionCall.name;
                const args = call.functionCall.args;

                if (functionName === 'request_bms_data') {
                    // Execute the actual DB query
                    console.log(`[InsightsGuru] Calling tool: ${functionName}`);
                    const toolResultData = await executeBmsDataRequest(systemId, args);

                    // 4. Feed result back to model as a 'function' role
                    conversationHistory.push({
                        role: 'function',
                        parts: [{
                            functionResponse: {
                                name: functionName,
                                response: { result: toolResultData }
                            }
                        }]
                    });
                }
                 // Add other tools here if defined later
            }
            // Loop continues to next turn to let model analyze new data
        } else {
            // 5. No tools called? This is the final answer.
            console.log("[InsightsGuru] Final answer received.");
            // Extract text from the parts
            const finalAnswer = responseParts.map(p => p.text).join('');
            return finalAnswer;
        }
    }

    return "I'm sorry, I reached my maximum number of analysis steps without finalizing an answer. Please try a more specific question.";
}

module.exports = { generateInsights };


Step 5: Testing the Loop

Create a specific test to verify the loop works without needing the full frontend.

Task: Create tests/agent-loop.test.js.
Action: Use this to mock the DB and verify the model asks for data.

// Mock the dependencies
jest.mock('../netlify/functions/utils/geminiClient.cjs');
jest.mock('../netlify/functions/utils/tool-executor.cjs');

const { generateInsights } = require('../netlify/functions/utils/insights-guru.cjs');
const { generateContent } = require('../netlify/functions/utils/geminiClient.cjs');
const { executeBmsDataRequest } = require('../netlify/functions/utils/tool-executor.cjs');

describe('Agentic Insights Loop', () => {
    it('should call tool when data is missing and then provide final answer', async () => {
        // Turn 1 Response: Model asks for tool
        generateContent.mockResolvedValueOnce({
            candidates: [{
                content: {
                    role: 'model',
                    parts: [{
                        functionCall: {
                            name: 'request_bms_data',
                            args: { metric: 'pack_voltage', start_date: '2025-10-01', end_date: '2025-11-01' }
                        }
                    }]
                }
            }]
        });

        // Tool Execution Mock Result
        executeBmsDataRequest.mockResolvedValueOnce({
            metric: 'pack_voltage',
            data: [{ _id: '2025-10-01', avg_value: 52.5 }]
        });

        // Turn 2 Response: Model gives final answer based on new data
        generateContent.mockResolvedValueOnce({
            candidates: [{
                content: {
                    role: 'model',
                    parts: [{ text: 'Based on the additional 30 days of data, the voltage is stable.' }]
                }
            }]
        });

        const result = await generateInsights([], "Is my voltage stable long term?", "test-sys-id");

        expect(executeBmsDataRequest).toHaveBeenCalledTimes(1);
        expect(result).toContain('voltage is stable');
    });
});


Summary of Changes for the AI

gemini-tools.cjs: Defined the contract for asking for more data.

tool-executor.cjs: The "muscle" that actually runs the MongoDB aggregation when requested.

insights-guru.cjs: The "brain" that now loops, talks to Gemini, spots tool requests, calls the executor, and repeats until satisfied.