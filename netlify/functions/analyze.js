const { getConfiguredStore } = require('./utils/blobs');
const { createLogger } = require("./utils/logger");
const { get_encoding } = require("@dqbd/tiktoken");
const { v4: uuidv4 } = require("uuid");

const JOBS_STORE_NAME = "bms-jobs";
const HISTORY_STORE_NAME = "bms-history";
const PROMPT_TEMPLATE = `You are an expert OCR data extraction and interpretation assistant. Extract the specified fields from the provided OCR text of a mobile app screenshot. The app is a Battery Management System (BMS) monitor. The user will provide a list of known system names. Match the 'DL Number' to one of the systems if possible.

[Known Systems]
{{SYSTEMS_JSON}}

[OCR Text]
{{OCR_TEXT}}

[Fields to Extract]
- DL Number: The primary identifier, usually a long alphanumeric string.
- Pack Voltage: The main voltage reading, typically between 40V and 60V.
- Pack Current: The current reading in Amps (A). Can be positive (charging) or negative (discharging).
- SoC: State of Charge, as a percentage.
- Highest Cell Voltage: The maximum voltage of any single cell.
- Lowest Cell Voltage: The minimum voltage of any single cell.
- Average Cell Voltage: The average voltage of all cells.
- Cell Voltage Difference: The difference between the highest and lowest cell voltage.
- Temperature 1: The first temperature sensor reading.
- Temperature 2: The second temperature sensor reading.
- Timestamp: The date and time shown in the screenshot, usually at the top. Convert to ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ).

[Output Format]
Return ONLY a valid JSON object with the extracted fields. Do not include any other text, explanations, or markdown.
{
  "dlNumber": "extracted_dl_number",
  "packVoltage": "extracted_pack_voltage",
  "packCurrent": "extracted_pack_current",
  "soc": "extracted_soc",
  "highestCellVoltage": "extracted_highest_cell_voltage",
  "lowestCellVoltage": "extracted_lowest_cell_voltage",
  "avgCellVoltage": "extracted_average_cell_voltage",
  "cellVoltageDiff": "extracted_cell_voltage_diff",
  "temp1": "extracted_temp1",
  "temp2": "extracted_temp2",
  "timestamp": "extracted_timestamp_iso"
}`;

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
});

const extractText = (fullText, startMarker, endMarker) => {
    try {
        const startIndex = fullText.indexOf(startMarker);
        if (startIndex === -1) return null;
        const contentAfterStart = fullText.substring(startIndex + startMarker.length);
        const endIndex = contentAfterStart.indexOf(endMarker);
        if (endIndex === -1) return null;
        return contentAfterStart.substring(0, endIndex).trim();
    } catch (e) {
        return null;
    }
};

const parseOcrData = (ocrText, systems) => {
    let jsonData = {};
    try {
        const jsonString = extractText(ocrText, '```json', '```');
        jsonData = JSON.parse(jsonString);
    } catch (e) {
        throw new Error("Failed to parse JSON from AI response.");
    }
    const system = systems.find(s => s.associatedDLs?.includes(jsonData.dlNumber)) || {};
    return {
        id: uuidv4(),
        ...jsonData,
        systemId: system.id || null,
        systemName: system.name || 'Unlinked',
    };
};

// NEW utility function to update the main batch job with progress from a worker
const updateBatchJob = async (store, batchId, job, log) => {
    if (!batchId) return;

    try {
        for (let i = 0; i < 3; i++) { // Simple retry loop for contention
            const { data: batchJob, metadata } = await store.getWithMetadata(batchId, { type: 'json' });
            if (!batchJob) {
                log.warn("Could not find batch job to update", { batchId });
                return;
            }

            if (job.status === 'completed') {
                batchJob.completedJobs += 1;
            } else {
                batchJob.failedJobs += 1;
            }
            
            const jobInBatch = batchJob.jobs.find(j => j.jobId === job.id);
            if (jobInBatch) {
                jobInBatch.status = job.status;
                jobInBatch.error = job.error || null;
            }

            const processedCount = batchJob.completedJobs + batchJob.failedJobs;
            if (processedCount === batchJob.totalJobs) {
                batchJob.status = 'completed';
                batchJob.completedAt = new Date().toISOString();
            }

            try {
                await store.setJSON(batchId, batchJob, { etag: metadata?.etag });
                log.info("Batch job updated successfully", { batchId, completed: batchJob.completedJobs, failed: batchJob.failedJobs });
                return; // Success
            } catch (e) {
                if (e.status === 412) { // Etag mismatch, retry
                    log.warn("Batch update conflict, retrying...", { batchId, attempt: i + 1 });
                    await new Promise(res => setTimeout(res, 75 * (i + 1)));
                } else {
                    throw e;
                }
            }
        }
    } catch (error) {
        log.error("Failed to update batch job after retries", { batchId, error: error.message });
    }
};

exports.handler = async (event, context) => {
    const log = createLogger('analyze', context);
    const jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);
    const { jobId } = event.queryStringParameters;

    if (jobId) { // This is the WORKER logic
        let jobData;
        try {
            jobData = await jobsStore.get(jobId, { type: 'json' });
            if (!jobData) throw new Error(`Job data not found for ID: ${jobId}`);

            jobData.status = 'processing';
            await jobsStore.setJSON(jobId, jobData);

            const { imageData, fileName, systems } = jobData;
            
            // This is your existing OCR/AI logic
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                    model: "gpt-4-vision-preview",
                    messages: [{
                        role: "user",
                        content: [
                            { type: "text", text: PROMPT_TEMPLATE.replace('{{SYSTEMS_JSON}}', JSON.stringify(systems)) },
                            { type: "image_url", image_url: { url: imageData } },
                        ],
                    }],
                    max_tokens: 1000,
                }),
            });

            if (!response.ok) {
                throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const ocrText = data.choices[0].message.content;
            const analysisResult = parseOcrData(ocrText, systems);
            analysisResult.fileName = fileName;

            const historyStore = getConfiguredStore(HISTORY_STORE_NAME, log);
            await historyStore.set(analysisResult.id, JSON.stringify(analysisResult));

            jobData.status = 'completed';
            jobData.result = analysisResult;
            await jobsStore.setJSON(jobId, jobData);

        } catch (error) {
            log.error(`Failed to process job ${jobId}`, { error: error.message, stack: error.stack });
            if (jobData) {
                jobData.status = "failed";
                jobData.error = error.message;
                await jobsStore.setJSON(jobId, jobData);
            }
            return respond(500, { error: `Failed to process job ${jobId}: ${error.message}` });
        } finally {
            if (jobData && jobData.batchId) {
                await updateBatchJob(jobsStore, jobData.batchId, jobData, log);
            }
        }
        return respond(200, { message: `Successfully processed job ${jobId}` });
    }

    // This is the DISPATCHER logic
    try {
        if (event.httpMethod !== 'POST') return respond(405, { error: 'Method Not Allowed' });
        
        const body = JSON.parse(event.body);
        const { images, systems } = body;
        if (!Array.isArray(images) || images.length === 0) {
            return respond(400, { error: "No images provided for analysis." });
        }

        const batchId = uuidv4();
        const batchJob = {
            id: batchId,
            status: 'processing',
            createdAt: new Date().toISOString(),
            totalJobs: images.length,
            completedJobs: 0,
            failedJobs: 0,
            jobs: []
        };
        log.info(`Starting batch job creation for ${images.length} images.`, { batchId });

        const createdJobs = [];
        for (const image of images) {
            const newJobId = uuidv4();
            const jobData = {
                id: newJobId,
                batchId: batchId,
                fileName: image.name,
                status: "queued",
                imageData: image.data,
                systems,
                createdAt: new Date().toISOString(),
            };
            await jobsStore.set(newJobId, JSON.stringify(jobData));
            createdJobs.push({ jobId: newJobId });
            batchJob.jobs.push({ jobId: newJobId, fileName: image.name, status: 'queued' });
        }
        
        await jobsStore.setJSON(batchId, batchJob);

        (async () => {
            for (const job of createdJobs) {
                try {
                    const response = await fetch(`${context.env.URL}/.netlify/functions/analyze?jobId=${job.jobId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                    });
                    if (response.status !== 200 && response.status !== 202) {
                       throw new Error(`Invocation failed with status ${response.status}`);
                    }
                } catch (e) {
                     log.error("Error invoking background function, marking as failed.", { jobId: job.jobId, error: e.message });
                     const failedJobData = await jobsStore.get(job.jobId, {type: 'json'});
                     failedJobData.status = 'failed';
                     failedJobData.error = `Invocation failed: ${e.message}`;
                     await jobsStore.setJSON(job.jobId, failedJobData);
                     await updateBatchJob(jobsStore, batchId, failedJobData, log);
                }
                // Delay to help prevent overwhelming the API on large batches
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        })();

        return respond(202, {
            message: `${images.length} analysis jobs queued.`,
            batchId: batchId,
        });

    } catch (error) {
        log.error("Critical error in analyze dispatcher.", { errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred." });
    }
};