import type { AnalysisData } from "../types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);

const isAnalysisData = (value: unknown): value is AnalysisData => {
  if (!isRecord(value)) return false;
  const cellVoltages = value.cellVoltages;
  return (
    "overallVoltage" in value &&
    "current" in value &&
    "stateOfCharge" in value &&
    "temperature" in value &&
    Array.isArray(cellVoltages)
  );
};

const fileWithMetadataToBase64 = (
  file: File,
): Promise<{ image: string; mimeType: string; fileName: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve({
          image: reader.result.split(",")[1],
          mimeType: file.type,
          fileName: file.name,
        });
      } else {
        reject(new Error("Failed to read file."));
      }
    };
    reader.onerror = (error) => reject(error);
  });
};

const log = (
  level: "info" | "warn" | "error" | "debug",
  message: string,
  context: object = {},
) => {
  console.log(
    JSON.stringify({
      level: level.toUpperCase(),
      timestamp: new Date().toISOString(),
      service: "geminiService",
      message,
      context,
    }),
  );
};

// Worker removed to improve stability
// const getAnalysisWorker = ...
/**
 * ***NEW SYNCHRONOUS FUNCTION***
 * Analyzes a single BMS screenshot and returns the data directly.
 * This replaces the old `analyzeBmsScreenshots` job-based function.
 * @param file - The file to analyze
 * @param forceReanalysis - If true, bypasses duplicate detection and forces a new analysis
 * @param systemId - Optional system ID to associate with
 * @param useAsync - If true, uses the asynchronous analysis path (returns jobId)
 */
export const analyzeBmsScreenshot = async (
  file: File,
  forceReanalysis: boolean = false,
  systemId?: string,
  useAsync: boolean = false,
): Promise<AnalysisData> => {
  const analysisContext = {
    fileName: file.name,
    fileSize: file.size,
    forceReanalysis,
    useAsync,
  };
  log(
    "info",
    `Starting ${useAsync ? "async" : "synchronous"} analysis.`,
    analysisContext,
  );

  let endpoint = "/.netlify/functions/analyze";
  const params = new URLSearchParams();

  if (!useAsync) {
    params.append("sync", "true");
  }
  if (forceReanalysis) {
    params.append("force", "true");
  }
  if (systemId) {
    params.append("systemId", systemId);
  }

  const queryString = params.toString();
  if (queryString) {
    endpoint += `?${queryString}`;
  }

  try {
    const imagePayload = await fileWithMetadataToBase64(file);

    // For async analysis, we need to send a different payload structure
    let requestBody: Record<string, unknown>;
    if (useAsync) {
      // Generate a unique jobId for async requests
      const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      requestBody = {
        jobId,
        fileData: imagePayload.image,
        fileName: imagePayload.fileName,
        mimeType: imagePayload.mimeType,
        systemId,
        forceReanalysis,
      };
    } else {
      // Sync requests use the existing payload structure
      requestBody = { image: imagePayload };
    }

    const responseJson = await performAnalysisRequest(
      file,
      endpoint,
      analysisContext,
      requestBody,
    );

    // Handle Async Response (202 Accepted)
    if (useAsync) {
      // In async mode, we get { success: true, jobId: "...", eventId?: "..." }
      log("info", "Async analysis accepted.", responseJson);
      const jobId =
        typeof responseJson.jobId === "string"
          ? responseJson.jobId
          : "unknown-job";
      return {
        _recordId: jobId,
        _timestamp: new Date().toISOString(),
        _isDuplicate: false,
        status: "pending",
        // Minimal valid shape to satisfy type
        hardwareSystemId: "PENDING",
        serialNumber: "PENDING",
        stateOfCharge: 0,
        overallVoltage: 0,
        current: 0,
        power: 0,
        fullCapacity: 0,
        remainingCapacity: 0,
        cycleCount: 0,
        temperature: 0,
        cellVoltages: [],
      } as unknown as AnalysisData;
    }

    // In sync mode, the server returns the full AnalysisRecord directly.
    // We extract the 'analysis' part and also check for isDuplicate flag
    const analysis = responseJson.analysis;
    if (!isAnalysisData(analysis)) {
      log(
        "error",
        "API response was successful but missing analysis data.",
        responseJson,
      );
      throw new Error("API response was successful but missing analysis data.");
    }

    const isDuplicate =
      typeof responseJson.isDuplicate === "boolean"
        ? responseJson.isDuplicate
        : false;
    const recordId =
      typeof responseJson.recordId === "string"
        ? responseJson.recordId
        : undefined;
    const timestamp =
      typeof responseJson.timestamp === "string"
        ? responseJson.timestamp
        : undefined;

    log("info", "Synchronous analysis successful.", {
      fileName: file.name,
      isDuplicate,
    });

    // Attach metadata about duplicate detection to the analysis data
    // This allows the UI to show duplicate status
    const analysisWithMeta = {
      ...analysis,
      _isDuplicate: isDuplicate,
      _recordId: recordId,
      _timestamp: timestamp,
    };

    return analysisWithMeta as AnalysisData;
  } catch (error) {
    log("error", "Synchronous analysis failed.", {
      ...analysisContext,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

import { calculateFileHash } from "../utils/clientHash";

/**
 * Check if a file is a duplicate without performing full analysis.
 * This is a lightweight check using the backend's content hash detection.
 * @param file - The file to check
 * @returns Promise with isDuplicate flag, needsUpgrade flag, and optional recordId/timestamp/analysisData of existing record
 */
export const checkFileDuplicate = async (
  file: File,
): Promise<{
  isDuplicate: boolean;
  needsUpgrade: boolean;
  recordId?: string;
  timestamp?: string;
  analysisData?: unknown;
}> => {
  const startTime = Date.now();
  const checkContext = { fileName: file.name, fileSize: file.size };
  log("info", "DUPLICATE_CHECK: Starting individual file check", {
    ...checkContext,
    event: "FILE_CHECK_START",
  });

  try {
    // OPTIMIZATION: Use hash-only check to avoid uploading the full image
    // Calculate hash on client side
    const hashStartTime = Date.now();
    const hash = await calculateFileHash(file);

    if (hash) {
      log("debug", "DUPLICATE_CHECK: Calculated client-side hash", {
        fileName: file.name,
        hashPreview: hash.substring(0, 16) + "...",
        durationMs: Date.now() - hashStartTime,
      });

      // Use the batch endpoint for single file hash check
      // This avoids sending the binary data over the network
      const endpoint = "/.netlify/functions/check-duplicates-batch";
      const payload = {
        files: [
          {
            fileName: file.name,
            hash: hash,
          },
        ],
      };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.results && data.results.length > 0) {
          const result = data.results[0];
          log("info", "DUPLICATE_CHECK: Hash-only check complete", {
            fileName: file.name,
            isDuplicate: !!result.isDuplicate,
            needsUpgrade: !!result.needsUpgrade,
            event: "HASH_CHECK_SUCCESS",
          });

          return {
            isDuplicate: result.isDuplicate,
            needsUpgrade: result.needsUpgrade,
            recordId: result.recordId,
            timestamp: result.timestamp,
            analysisData: result.analysisData,
          };
        }
      } else {
        log(
          "warn",
          "DUPLICATE_CHECK: Hash check endpoint failed, falling back to legacy",
          { status: response.status },
        );
      }
    }

    // Fallback or if hash failing: Use worker (without resizing per user feedback) for check
    // This uploads the file, which is slower but reliable
    const endpoint = "/.netlify/functions/analyze?sync=true&check=true";
    const responseJson = await performAnalysisRequest(
      file,
      endpoint,
      checkContext,
      undefined,
      25000,
    ); // 25s timeout

    const totalDurationMs = Date.now() - startTime;
    const result = responseJson;

    // Enhanced logging with full result details
    log("info", "DUPLICATE_CHECK: Backend response received (legacy path)", {
      fileName: file.name,
      isDuplicate: !!result.isDuplicate,
      needsUpgrade: !!result.needsUpgrade,
      hasRecordId: !!result.recordId,
      hasTimestamp: !!result.timestamp,
      hasAnalysisData: !!result.analysisData,
      totalDurationMs, // Total = read + fetch + overhead (JSON parsing, etc.)
      event: "API_RESPONSE",
    });

    return {
      isDuplicate:
        typeof result.isDuplicate === "boolean" ? result.isDuplicate : false,
      needsUpgrade:
        typeof result.needsUpgrade === "boolean" ? result.needsUpgrade : false,
      recordId:
        typeof result.recordId === "string" ? result.recordId : undefined,
      timestamp:
        typeof result.timestamp === "string" ? result.timestamp : undefined,
      analysisData: result.analysisData,
    };
  } catch (error) {
    // Detect timeout errors specifically
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const totalDurationMs = Date.now() - startTime;

    // Special handling for 404/501 (Endpoint not available) - usually propagated as Error
    if (errorMessage.includes("404") || errorMessage.includes("501")) {
      log(
        "info",
        "DUPLICATE_CHECK: Endpoint not available, treating as new file",
        {
          fileName: file.name,
          event: "ENDPOINT_NOT_AVAILABLE",
        },
      );
      return { isDuplicate: false, needsUpgrade: false };
    }

    log("warn", "DUPLICATE_CHECK: File check failed, treating as new file", {
      ...checkContext,
      error: errorMessage,
      isTimeout,
      totalDurationMs,
      event: "FILE_CHECK_ERROR",
    });
    return { isDuplicate: false, needsUpgrade: false };
  }
};

/**
 * Shared helper to perform analysis requests (analyze or duplicate check)
 * Tries to use Worker (for resizing efficiency) then falls back to main thread.
 */
async function performAnalysisRequest(
  file: File,
  relativeEndpoint: string,
  context: object,
  requestBody?: Record<string, unknown>,
  timeoutMs: number = 60000,
): Promise<Record<string, unknown>> {
  // 1. Direct Fetch (Main Thread) - Worker path removed for stability

  const imagePayload = await fileWithMetadataToBase64(file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    log("warn", `Request timed out on client after ${timeoutMs}ms.`);
    controller.abort();
  }, timeoutMs);

  try {
    log(
      "info",
      `Submitting request to ${relativeEndpoint} (Basic Fetch)`,
      context,
    );

    // Use provided request body or default to image payload
    const body = requestBody || { image: imagePayload };

    const response = await fetch(relativeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorText = "Failed to read error response";
      try {
        errorText = await response.text();
      } catch {
        // ignore
      }
      // Try to parse JSON error if possible
      let errorBody;
      try {
        errorBody = JSON.parse(errorText);
      } catch {
        /* ignore parse errors */
      }

      const errorMessage =
        typeof errorBody === "object" && errorBody?.error
          ? errorBody.error
          : `Server responded with status ${response.status}: ${errorText}`;
      throw new Error(errorMessage);
    }

    const rawData = (await response.json()) as unknown;
    const data = isRecord(rawData) ? rawData : { data: rawData };
    return {
      ...data,
      _meta: {
        headers: response.headers,
      },
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
