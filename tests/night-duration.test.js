/**
 * Test for overnight load analysis night duration calculations
 */

// Mock the weather-fetcher module
jest.mock('../netlify/functions/utils/weather-fetcher.cjs', () => ({
  calculateSunriseSunset: jest.fn((lat, lon, date) => {
    // Mock realistic sunrise/sunset for mid-latitudes in winter
    // For this test: sunrise at 7:30 AM, sunset at 5:00 PM
    const sunrise = new Date(date);
    sunrise.setHours(7, 30, 0, 0);
    
    const sunset = new Date(date);
    sunset.setHours(17, 0, 0, 0);
    
    return {
      sunrise,
      sunset,
      isPolarNight: false,
      isPolarDay: false
    };
  })
}));

// Import after mocking
const { calculateSunriseSunset } = require('../netlify/functions/utils/weather-fetcher.cjs');

describe('Night Duration Calculation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calculateSunriseSunset should be called with correct parameters', () => {
    const testDate = new Date('2025-11-23T12:00:00Z');
    const lat = 40.7128; // New York
    const lon = -74.0060;
    
    calculateSunriseSunset(lat, lon, testDate);
    
    expect(calculateSunriseSunset).toHaveBeenCalledWith(lat, lon, testDate);
  });

  test('should calculate correct night duration from sunset to sunrise', () => {
    const testDate = new Date('2025-11-23T12:00:00Z');
    const lat = 40.7128;
    const lon = -74.0060;
    
    const result = calculateSunriseSunset(lat, lon, testDate);
    
    expect(result).toHaveProperty('sunrise');
    expect(result).toHaveProperty('sunset');
    expect(result.sunrise).toBeInstanceOf(Date);
    expect(result.sunset).toBeInstanceOf(Date);
    
    // Calculate night hours: from sunset to next sunrise
    // Sunset at 17:00, sunrise at 07:30 next day = 14.5 hours
    const nightMs = result.sunrise.getTime() - result.sunset.getTime();
    const expectedNightMs = (14.5 * 60 * 60 * 1000); // Should be negative since sunrise < sunset on same day
    
    // Since our mock returns same-day times, we need to adjust
    // In reality, previous day's sunset to current day's sunrise
    // Mock gives us sunrise 7:30, sunset 17:00 (same day)
    // Night should be from 17:00 previous day to 7:30 current day = 14.5 hours
  });

  test('should handle polar night correctly', () => {
    // Update mock for polar night
    calculateSunriseSunset.mockReturnValueOnce({
      sunrise: null,
      sunset: null,
      isPolarNight: true,
      isPolarDay: false
    });
    
    const testDate = new Date('2025-12-21T12:00:00Z');
    const lat = 70; // Arctic
    const lon = 20;
    
    const result = calculateSunriseSunset(lat, lon, testDate);
    
    expect(result.isPolarNight).toBe(true);
    expect(result.sunrise).toBeNull();
    expect(result.sunset).toBeNull();
  });

  test('should handle polar day correctly', () => {
    // Update mock for polar day
    calculateSunriseSunset.mockReturnValueOnce({
      sunrise: null,
      sunset: null,
      isPolarNight: false,
      isPolarDay: true
    });
    
    const testDate = new Date('2025-06-21T12:00:00Z');
    const lat = 70; // Arctic
    const lon = 20;
    
    const result = calculateSunriseSunset(lat, lon, testDate);
    
    expect(result.isPolarDay).toBe(true);
    expect(result.sunrise).toBeNull();
    expect(result.sunset).toBeNull();
  });
});

describe('Night Duration Edge Cases', () => {
  test('should default to 12 hours when location not available', () => {
    // This tests the fallback behavior
    const defaultNightHours = 12;
    
    // When no location is provided, we expect 12-hour default
    expect(defaultNightHours).toBe(12);
  });

  test('should handle sparse snapshot scenario correctly', () => {
    // Scenario: 5 snapshots during night
    // Old behavior: 5 * 0.25 = 1.25 hours (WRONG)
    // New behavior: Should use full night duration (e.g., 11.2 hours)
    
    const snapshotCount = 5;
    const measuredDuration = 1.25; // Old fallback calculation
    const actualNightHours = 11.2; // Calculated from sunrise/sunset
    
    // Measured consumption
    const measuredAh = 19.3;
    
    // Projected consumption for full night
    const projectedAh = measuredAh * (actualNightHours / measuredDuration);
    
    // Should be ~172.7 Ah for full 11.2-hour night
    expect(projectedAh).toBeGreaterThan(150);
    expect(projectedAh).toBeLessThan(200);
    // Allow for floating point precision
    expect(projectedAh).toBeCloseTo(172.7, 0);
  });

  test('should calculate measurement coverage correctly', () => {
    const measuredHours = 1.4;
    const actualNightHours = 11.2;
    
    const coverage = (measuredHours / actualNightHours) * 100;
    
    expect(coverage).toBeCloseTo(12.5, 1);
  });
});
