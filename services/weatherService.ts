
import type { WeatherData } from '../types';

export const fetchWeatherForLocation = async (lat: number, lon: number, timestamp?: string): Promise<WeatherData> => {
  try {
    const response = await fetch('/.netlify/functions/weather', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lat, lon, timestamp }),
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || `Server responded with status: ${response.status}`);
    }
    
    return result as WeatherData;

  } catch (error) {
    console.error("Error fetching weather data:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to fetch weather data: ${error.message}`);
    }
    throw new Error("Failed to fetch weather data due to an unknown error.");
  }
};
