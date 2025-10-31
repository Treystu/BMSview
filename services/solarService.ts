import type { 
  SolarEstimateRequest, 
  SolarEstimateResponse, 
  SolarAPIError 
} from '../types/solar';

// Cache for storing API responses
interface CacheEntry {
  data: SolarEstimateResponse;
  timestamp: number;
}

class SolarEstimateCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly TTL = 3600000; // 1 hour in milliseconds

  private generateKey(request: SolarEstimateRequest): string {
    return `${request.location}_${request.panelWatts}_${request.startDate}_${request.endDate}`;
  }

  get(request: SolarEstimateRequest): SolarEstimateResponse | null {
    const key = this.generateKey(request);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check if cache entry is still valid
    const now = Date.now();
    if (now - entry.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set(request: SolarEstimateRequest, data: SolarEstimateResponse): void {
    const key = this.generateKey(request);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

const cache = new SolarEstimateCache();

/**
 * Fetches solar energy estimates from the proxy API
 */
export async function fetchSolarEstimate(
  request: SolarEstimateRequest
): Promise<SolarEstimateResponse> {
  // Check cache first
  const cachedData = cache.get(request);
  if (cachedData) {
    console.log('[Solar Service] Returning cached data');
    return cachedData;
  }

  // Build query parameters
  const params = new URLSearchParams({
    location: request.location,
    panelWatts: request.panelWatts.toString(),
    startDate: request.startDate,
    endDate: request.endDate,
  });

  const url = `/.netlify/functions/solar-estimate?${params.toString()}`;

  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorData: SolarAPIError = await response.json();
      throw new Error(errorData.error || 'Failed to fetch solar estimate');
    }

    const data: SolarEstimateResponse = await response.json();
    
    // Cache the successful response
    cache.set(request, data);
    
    return data;
  } catch (error) {
    console.error('[Solar Service] Error fetching solar estimate:', error);
    throw error;
  }
}

/**
 * Calculates total estimated energy for a date range
 */
export function calculateTotalEstimatedEnergy(
  response: SolarEstimateResponse
): number {
  return response.dailyEstimates.reduce(
    (total, day) => total + day.estimatedWh,
    0
  );
}

/**
 * Gets hourly data for a specific date
 */
export function getHourlyDataForDate(
  response: SolarEstimateResponse,
  date: string
): typeof response.hourlyBreakdown {
  return response.hourlyBreakdown.filter(hour => 
    hour.timestamp.startsWith(date)
  );
}

/**
 * Filters hourly data to only daylight hours
 */
export function getDaylightHours(
  hourlyData: SolarEstimateResponse['hourlyBreakdown']
): typeof hourlyData {
  return hourlyData.filter(hour => hour.is_daylight);
}

/**
 * Calculates peak solar generation hour
 */
export function getPeakSolarHour(
  hourlyData: SolarEstimateResponse['hourlyBreakdown']
): typeof hourlyData[0] | null {
  if (hourlyData.length === 0) return null;
  
  return hourlyData.reduce((peak, current) => 
    current.estimated_wh > peak.estimated_wh ? current : peak
  );
}

/**
 * Separates historical and forecast data
 */
export function separateHistoricalAndForecast(
  response: SolarEstimateResponse
): {
  historical: typeof response.dailyEstimates;
  forecast: typeof response.dailyEstimates;
} {
  const historical = response.dailyEstimates.filter(day => !day.isForecast);
  const forecast = response.dailyEstimates.filter(day => day.isForecast);
  
  return { historical, forecast };
}

/**
 * Validates location format (zip code or lat,lon)
 */
export function validateLocation(location: string): boolean {
  // Check for zip code (5 digits)
  const zipRegex = /^\d{5}$/;
  if (zipRegex.test(location)) return true;
  
  // Check for lat,lon format
  const coordRegex = /^-?\d+\.?\d*,-?\d+\.?\d*$/;
  if (coordRegex.test(location)) {
    const [lat, lon] = location.split(',').map(Number);
    return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }
  
  return false;
}

/**
 * Formats date to YYYY-MM-DD
 */
export function formatDateForAPI(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Gets date range for the last N days
 */
export function getDateRangeForLastDays(days: number): {
  startDate: string;
  endDate: string;
} {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return {
    startDate: formatDateForAPI(startDate),
    endDate: formatDateForAPI(endDate),
  };
}

/**
 * Clears the solar estimate cache
 */
export function clearSolarCache(): void {
  cache.clear();
}