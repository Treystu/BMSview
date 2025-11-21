/**
 * Tests for weather-fetcher utility
 */

const { calculateSunriseSunset, getDaylightHours } = require('../netlify/functions/utils/weather-fetcher.cjs');

describe('Weather Fetcher Utility', () => {
  describe('calculateSunriseSunset', () => {
    it('should calculate sunrise and sunset for mid-latitude location', () => {
      // Test location: New York City (40.7°N, 74°W)
      const date = new Date('2024-06-21'); // Summer solstice
      const result = calculateSunriseSunset(40.7, -74, date);
      
      expect(result).toHaveProperty('sunrise');
      expect(result).toHaveProperty('sunset');
      expect(result.isPolarNight).toBe(false);
      expect(result.isPolarDay).toBe(false);
      
      // Verify sunrise is before sunset
      expect(result.sunrise.getTime()).toBeLessThan(result.sunset.getTime());
      
      // Calculate day length in hours (should be around 15 hours for NYC in summer)
      const dayLengthMs = result.sunset - result.sunrise;
      const dayLengthHours = dayLengthMs / (1000 * 60 * 60);
      expect(dayLengthHours).toBeGreaterThan(14);
      expect(dayLengthHours).toBeLessThan(16);
    });

    it('should calculate shorter days in winter', () => {
      // Test location: New York City (40.7°N, 74°W)
      const summerDate = new Date('2024-06-21'); // Summer solstice
      const winterDate = new Date('2024-12-21'); // Winter solstice
      
      const summerResult = calculateSunriseSunset(40.7, -74, summerDate);
      const winterResult = calculateSunriseSunset(40.7, -74, winterDate);
      
      // Calculate day length in hours
      const summerDayLength = (summerResult.sunset - summerResult.sunrise) / (1000 * 60 * 60);
      const winterDayLength = (winterResult.sunset - winterResult.sunrise) / (1000 * 60 * 60);
      
      // Summer day should be longer than winter day
      expect(summerDayLength).toBeGreaterThan(winterDayLength);
      
      // Summer day should be around 15 hours, winter around 9 hours (rough check)
      expect(summerDayLength).toBeGreaterThan(14);
      expect(winterDayLength).toBeLessThan(10);
    });

    it('should handle equatorial location', () => {
      // Test location: Quito, Ecuador (0°, 78.5°W)
      const date = new Date('2024-03-20'); // Spring equinox
      const result = calculateSunriseSunset(0, -78.5, date);
      
      expect(result).toHaveProperty('sunrise');
      expect(result).toHaveProperty('sunset');
      expect(result.isPolarNight).toBe(false);
      expect(result.isPolarDay).toBe(false);
      
      // At equator on equinox, day should be close to 12 hours
      const dayLength = (result.sunset - result.sunrise) / (1000 * 60 * 60);
      expect(dayLength).toBeGreaterThan(11);
      expect(dayLength).toBeLessThan(13);
    });

    it('should detect polar night', () => {
      // North Pole in winter
      const date = new Date('2024-12-21'); // Winter solstice
      const result = calculateSunriseSunset(89, 0, date);
      
      expect(result.isPolarNight).toBe(true);
      expect(result.sunrise).toBeNull();
      expect(result.sunset).toBeNull();
    });

    it('should detect polar day', () => {
      // North Pole in summer
      const date = new Date('2024-06-21'); // Summer solstice
      const result = calculateSunriseSunset(89, 0, date);
      
      expect(result.isPolarDay).toBe(true);
      expect(result.sunrise).toBeNull();
      expect(result.sunset).toBeNull();
    });
  });

  describe('getDaylightHours', () => {
    it('should return daylight hours for typical location', () => {
      // New York City, summer
      const date = new Date('2024-06-21');
      const hours = getDaylightHours(40.7, -74, date);
      
      expect(Array.isArray(hours)).toBe(true);
      expect(hours.length).toBeGreaterThan(12); // At least 12 daylight hours
      expect(hours.length).toBeLessThan(18); // Less than 18 daylight hours
      
      // Hours should be sequential
      for (let i = 1; i < hours.length; i++) {
        expect(hours[i]).toBe(hours[i - 1] + 1);
      }
      
      // Should include noon (12)
      expect(hours).toContain(12);
    });

    it('should return empty array for polar night', () => {
      const date = new Date('2024-12-21');
      const hours = getDaylightHours(89, 0, date);
      
      expect(hours).toEqual([]);
    });

    it('should return all 24 hours for polar day', () => {
      const date = new Date('2024-06-21');
      const hours = getDaylightHours(89, 0, date);
      
      expect(hours).toHaveLength(24);
      expect(hours).toEqual(expect.arrayContaining([0, 6, 12, 18, 23]));
    });

    it('should return roughly 12 hours at equator on equinox', () => {
      const date = new Date('2024-03-20');
      const hours = getDaylightHours(0, -78.5, date);
      
      expect(hours.length).toBeGreaterThan(10);
      expect(hours.length).toBeLessThan(14);
    });

    it('should have shorter days in winter than summer', () => {
      const summerDate = new Date('2024-06-21');
      const winterDate = new Date('2024-12-21');
      
      const summerHours = getDaylightHours(40.7, -74, summerDate);
      const winterHours = getDaylightHours(40.7, -74, winterDate);
      
      expect(summerHours.length).toBeGreaterThan(winterHours.length);
    });
  });
});
