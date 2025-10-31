import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";

interface SolarEstimateParams {
  location: string;
  panelWatts: string;
  startDate: string;
  endDate: string;
}

const SOLAR_API_BASE_URL = "https://sunestimate.netlify.app/api/calculate";

export const handler: Handler = async (
  event: HandlerEvent,
  context: HandlerContext
) => {
  // Only allow GET requests
  if (event.httpMethod !== "GET") {
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
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Location is required (zip code or lat,lon)" }),
      };
    }

    if (!panelWatts || isNaN(Number(panelWatts)) || Number(panelWatts) <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Valid panel wattage is required" }),
      };
    }

    if (!startDate || !endDate) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Start date and end date are required (YYYY-MM-DD format)" }),
      };
    }

    // Validate date format (basic check)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
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

    console.log(`[Solar Estimate] Fetching data from: ${apiUrl.toString()}`);

    // Make the request to the external Solar API
    const response = await fetch(apiUrl.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    // Handle non-200 responses
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Solar Estimate] API Error (${response.status}):`, errorText);
      
      let errorMessage = "Failed to fetch solar estimate";
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorMessage;
      } catch {
        // If not JSON, use the raw text
        errorMessage = errorText || errorMessage;
      }

      return {
        statusCode: response.status,
        body: JSON.stringify({ error: errorMessage }),
      };
    }

    // Parse and return the successful response
    const data = await response.json();
    
    console.log(`[Solar Estimate] Success: ${data.dailyEstimates?.length || 0} daily estimates returned`);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      },
      body: JSON.stringify(data),
    };

  } catch (error) {
    console.error("[Solar Estimate] Unexpected error:", error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Internal server error while fetching solar estimate",
        details: error instanceof Error ? error.message : "Unknown error"
      }),
    };
  }
};