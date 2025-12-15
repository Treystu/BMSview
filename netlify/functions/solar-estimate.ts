import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createLoggerFromEvent, createTimer } from "./utils/logger.cjs";

interface SolarEstimateParams {
  location: string;
  panelWatts: string;
  startDate: string;
  endDate: string;
}

const SOLAR_API_BASE_URL = "https://sunestimate.netlify.app/api/calculate";

const sanitizeHeaders = (headers: Record<string, string | undefined> = {}) => {
  const redacted = { ...headers };
  if (redacted.authorization) redacted.authorization = "[REDACTED]";
  if (redacted.cookie) redacted.cookie = "[REDACTED]";
  if (redacted["x-api-key"]) redacted["x-api-key"] = "[REDACTED]";
  return redacted;
};

export const handler: Handler = async (
  event: HandlerEvent,
  context: HandlerContext
) => {
  const log = createLoggerFromEvent("solar-estimate", event, context);
  const timer = createTimer(log, "solar-estimate");

  log.entry({
    method: event.httpMethod,
    path: event.path,
    query: event.queryStringParameters,
    headers: sanitizeHeaders(event.headers as Record<string, string>),
    bodyLength: event.body ? event.body.length : 0,
  });

  if (event.httpMethod === "OPTIONS") {
    timer.end({ outcome: "preflight" });
    log.exit(200, { outcome: "preflight" });
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
      body: "",
    };
  }

  // Only allow GET requests
  if (event.httpMethod !== "GET") {
    log.warn("Method not allowed", { method: event.httpMethod });
    timer.end({ outcome: "method_not_allowed" });
    log.exit(405, { outcome: "method_not_allowed" });
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    // Extract and validate query parameters
    const { location, panelWatts, startDate, endDate } = event.queryStringParameters as Partial<SolarEstimateParams>;

    // Validation
    if (!location) {
      log.warn("Missing location parameter");
      timer.end({ outcome: "validation_error", field: "location" });
      log.exit(400, { outcome: "validation_error", field: "location" });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Location is required (zip code or lat,lon)" }),
      };
    }

    if (!panelWatts || isNaN(Number(panelWatts)) || Number(panelWatts) <= 0) {
      log.warn("Invalid panelWatts parameter", { panelWatts });
      timer.end({ outcome: "validation_error", field: "panelWatts" });
      log.exit(400, { outcome: "validation_error", field: "panelWatts" });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Valid panel wattage is required" }),
      };
    }

    if (!startDate || !endDate) {
      log.warn("Missing date parameters", { startDate, endDate });
      timer.end({ outcome: "validation_error", field: "dates" });
      log.exit(400, { outcome: "validation_error", field: "dates" });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Start date and end date are required (YYYY-MM-DD format)" }),
      };
    }

    // Validate date format (basic check)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      log.warn("Invalid date format", { startDate, endDate });
      timer.end({ outcome: "validation_error", field: "date_format" });
      log.exit(400, { outcome: "validation_error", field: "date_format" });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid date format. Use YYYY-MM-DD" }),
      };
    }

    // Build the external API URL
    const apiUrl = new URL(SOLAR_API_BASE_URL);
    apiUrl.searchParams.append("location", location);
    apiUrl.searchParams.append("panelWatts", panelWatts);
    apiUrl.searchParams.append("startDate", startDate);
    apiUrl.searchParams.append("endDate", endDate);

    log.debug("Calling external solar API", { url: apiUrl.toString() });

    // Make the request to the external Solar API
    const apiStart = Date.now();
    const response = await fetch(apiUrl.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    const apiDurationMs = Date.now() - apiStart;

    // Handle non-200 responses
    if (!response.ok) {
      const errorText = await response.text();
      log.error("External API error", { 
        status: response.status, 
        errorText: errorText.substring(0, 500),
        apiDurationMs 
      });
      
      let errorMessage = "Failed to fetch solar estimate";
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorMessage;
      } catch {
        // If not JSON, use the raw text
        errorMessage = errorText || errorMessage;
      }

      timer.end({ outcome: "error", status: response.status, apiDurationMs });
      log.exit(response.status, { outcome: "error" });
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: errorMessage }),
      };
    }

    // Parse and return the successful response
    const data = await response.json();
    
    const dailyEstimatesCount = data.dailyEstimates?.length || 0;
    const durationMs = timer.end({ outcome: "success", apiDurationMs, dailyEstimatesCount });
    log.info("Solar estimate completed successfully", { 
      dailyEstimatesCount,
      durationMs,
      apiDurationMs
    });

    log.exit(200, { outcome: "success" });
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      },
      body: JSON.stringify(data),
    };

  } catch (error) {
    const err = error as Error;
    log.error("Unexpected error in solar estimate", { 
      error: err?.message || "Unknown error",
      stack: err?.stack,
      durationMs: timer.end({ outcome: "exception" })
    });
    log.exit(500, { outcome: "exception" });
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Internal server error while fetching solar estimate",
        details: err?.message || "Unknown error"
      }),
    };
  }
};
