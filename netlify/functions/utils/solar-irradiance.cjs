/**
 * Solar Irradiance Calculation and Storage Module
 * 
 * This module calculates precise solar irradiance values based on:
 * - Solar position (altitude, azimuth)
 * - Atmospheric conditions (air mass, turbidity)
 * - Cloud cover (primary factor affecting actual vs clear-sky irradiance)
 * - Geographic location and time
 * 
 * Solar irradiance is the PRIMARY metric for understanding solar generation potential.
 * Cloud cover is SECONDARY - used to adjust clear-sky irradiance calculations.
 * 
 * @module netlify/functions/utils/solar-irradiance
 */

/**
 * Calculate solar position (altitude and azimuth) for a given time and location
 * Uses precise astronomical algorithms
 * 
 * @param {Date} timestamp - The timestamp for calculation
 * @param {number} latitude - Latitude in degrees
 * @param {number} longitude - Longitude in degrees
 * @returns {object} Solar position data
 */
function calculateSolarPosition(timestamp, latitude, longitude) {
  try {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;  // Calculate Julian Day
    let a = Math.floor((14 - month) / 12);
    let y = year + 4800 - a;
    let julianM = month + 12 * a - 3;
    const jd = day + Math.floor((153 * julianM + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) +
      Math.floor(y / 400) - 32045 + (hour - 12) / 24;

    // Julian century
    const jc = (jd - 2451545) / 36525;

    // Solar coordinates
    const l0 = 280.46646 + jc * (36000.76983 + jc * 0.0003032);
    const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
    const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);

    const c = Math.sin(m * Math.PI / 180) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
      Math.sin(2 * m * Math.PI / 180) * (0.019993 - 0.000101 * jc) +
      Math.sin(3 * m * Math.PI / 180) * 0.000289;

    const sunLon = l0 + c;
    const sunAnomaly = m + c;

    // Obliquity of ecliptic
    const obliquity = 23 + (26 + ((21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813)))) / 60) / 60;

    // Right ascension and declination
    const ra = Math.atan2(Math.cos(obliquity * Math.PI / 180) * Math.sin(sunLon * Math.PI / 180),
      Math.cos(sunLon * Math.PI / 180)) * 180 / Math.PI;
    const decl = Math.asin(Math.sin(obliquity * Math.PI / 180) * Math.sin(sunLon * Math.PI / 180)) * 180 / Math.PI;

    // Greenwich Mean Sidereal Time
    const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545) +
      0.000387933 * jc * jc - jc * jc * jc / 38710000;

    // Local sidereal time
    const lst = (gmst + longitude) % 360;

    // Hour angle
    const ha = (lst - ra + 360) % 360;

    // Convert to radians for calculation
    const latRad = latitude * Math.PI / 180;
    const declRad = decl * Math.PI / 180;
    const haRad = ha * Math.PI / 180;

    // Calculate altitude (elevation above horizon)
    const sinAlt = Math.sin(latRad) * Math.sin(declRad) +
      Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad);
    const altitude = Math.asin(sinAlt) * 180 / Math.PI;

    // Calculate azimuth (direction from north)
    const cosAz = (Math.sin(declRad) - Math.sin(latRad) * sinAlt) /
      (Math.cos(latRad) * Math.cos(altitude * Math.PI / 180));
    let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) * 180 / Math.PI;

    // Adjust azimuth based on hour angle
    if (ha > 0 && ha < 180) {
      azimuth = 360 - azimuth;
    }

    return {
      altitude: roundTo(altitude, 2),
      azimuth: roundTo(azimuth, 2),
      hourAngle: roundTo(ha, 2),
      declination: roundTo(decl, 2),
      isSunUp: altitude > 0
    };
  } catch (error) {
    console.error('Error in calculateSolarPosition:', error);
    return { altitude: 0, azimuth: 0, isSunUp: false };
  }
}

/**
 * Calculate clear-sky solar irradiance (W/m²)
 * Uses atmospheric transmission model with air mass correction
 * 
 * @param {object} solarPosition - Solar position from calculateSolarPosition
 * @param {number} altitude - Ground elevation in meters (affects atmospheric thickness)
 * @returns {object} Irradiance data
 */
function calculateClearSkyIrradiance(solarPosition, altitude = 0) {
  if (!solarPosition.isSunUp || solarPosition.altitude <= 0) {
    return {
      directNormal: 0,
      diffuse: 0,
      global: 0,
      airMass: null
    };
  }

  const altitudeRad = solarPosition.altitude * Math.PI / 180;
  const sinAltitude = Math.sin(altitudeRad);

  // Air mass calculation (Kasten and Young formula)
  const airMass = 1 / (sinAltitude + 0.50572 * Math.pow(solarPosition.altitude + 6.07995, -1.6364));

  // Atmospheric transmission coefficient (simplified model)
  // Adjusts for elevation - higher altitude = less atmosphere = more irradiance
  const elevationFactor = Math.exp(altitude / 8400); // Scale height ~8.4km
  const transmission = 0.7 * Math.pow(0.678, airMass / elevationFactor);

  // Solar constant at top of atmosphere (W/m²)
  const solarConstant = 1367;

  // Direct normal irradiance
  const directNormal = solarConstant * transmission;

  // Direct horizontal irradiance
  const directHorizontal = directNormal * sinAltitude;

  // Diffuse irradiance (scattered light)
  const diffuse = solarConstant * sinAltitude * 0.3 * (1 - transmission);

  // Global horizontal irradiance (total)
  const global = directHorizontal + diffuse;

  return {
    directNormal: roundTo(directNormal, 1),
    directHorizontal: roundTo(directHorizontal, 1),
    diffuse: roundTo(diffuse, 1),
    global: roundTo(global, 1),
    airMass: roundTo(airMass, 2),
    transmission: roundTo(transmission, 3)
  };
}

/**
 * Adjust clear-sky irradiance for cloud cover
 * Cloud cover is the PRIMARY factor reducing actual from clear-sky irradiance
 * 
 * @param {object} clearSkyIrradiance - Clear sky irradiance from calculateClearSkyIrradiance
 * @param {number} cloudCoverPercent - Cloud cover percentage (0-100)
 * @returns {object} Cloud-adjusted irradiance
 */
function adjustIrradianceForClouds(clearSkyIrradiance, cloudCoverPercent) {
  if (cloudCoverPercent == null || clearSkyIrradiance.global === 0) {
    return {
      ...clearSkyIrradiance,
      cloudFactor: 1.0,
      cloudCoverPercent: null
    };
  }

  // Cloud transmission factor (Kasten and Czeplak model)
  // 0% clouds = 1.0 transmission (100%)
  // 100% clouds = ~0.25 transmission (25% - heavy overcast allows some diffuse light)
  const cloudFactor = 1 - 0.75 * Math.pow(cloudCoverPercent / 100, 3.4);

  return {
    directNormal: roundTo(clearSkyIrradiance.directNormal * cloudFactor, 1),
    directHorizontal: roundTo(clearSkyIrradiance.directHorizontal * cloudFactor, 1),
    diffuse: roundTo(clearSkyIrradiance.diffuse * (0.5 + 0.5 * cloudFactor), 1), // Diffuse less affected
    global: roundTo(clearSkyIrradiance.global * cloudFactor, 1),
    airMass: clearSkyIrradiance.airMass,
    transmission: clearSkyIrradiance.transmission,
    cloudFactor: roundTo(cloudFactor, 3),
    cloudCoverPercent: roundTo(cloudCoverPercent, 1)
  };
}

/**
 * Calculate complete solar irradiance for a given timestamp and location
 * This is the main function to call for getting irradiance data
 * 
 * @param {Date|string} timestamp - Timestamp for calculation
 * @param {number} latitude - Latitude in degrees
 * @param {number} longitude - Longitude in degrees
 * @param {number} cloudCoverPercent - Cloud cover percentage (0-100), optional
 * @param {number} groundAltitude - Ground elevation in meters, optional
 * @returns {object} Complete irradiance data with solar position
 */
function calculateSolarIrradiance(timestamp, latitude, longitude, cloudCoverPercent = null, groundAltitude = 0) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);

  const solarPosition = calculateSolarPosition(date, latitude, longitude);
  const clearSky = calculateClearSkyIrradiance(solarPosition, groundAltitude);
  const actual = adjustIrradianceForClouds(clearSky, cloudCoverPercent);

  return {
    timestamp: date.toISOString(),
    latitude: roundTo(latitude, 4),
    longitude: roundTo(longitude, 4),
    solarPosition,
    clearSkyIrradiance: clearSky,
    actualIrradiance: actual,
    // Summary values for easy access
    globalIrradiance: actual.global,
    directIrradiance: actual.directHorizontal,
    diffuseIrradiance: actual.diffuse,
    cloudCoverPercent: cloudCoverPercent,
    solarAltitude: solarPosition.altitude,
    isSunUp: solarPosition.isSunUp
  };
}

/**
 * Estimate cloud cover from UVI (UV Index)
 * Used as fallback when cloud data is not available
 * 
 * @param {number} uvi - UV Index value
 * @param {number} solarAltitude - Solar altitude in degrees
 * @returns {number} Estimated cloud cover percentage (0-100)
 */
function estimateCloudCoverFromUVI(uvi, solarAltitude) {
  if (!uvi || solarAltitude <= 0) {
    return null;
  }

  // Expected UVI for clear sky at this solar altitude
  // UVI peaks at ~11-12 with sun directly overhead (90° altitude)
  const maxUVI = 12;
  const expectedClearSkyUVI = maxUVI * Math.sin(solarAltitude * Math.PI / 180);

  if (expectedClearSkyUVI === 0) {
    return null;
  }

  // Calculate cloud cover from ratio
  const ratio = uvi / expectedClearSkyUVI;
  const cloudCover = Math.max(0, Math.min(100, (1 - ratio) * 100));

  return roundTo(cloudCover, 1);
}

/**
 * Helper: Round to specified decimal places
 */
function roundTo(value, decimals) {
  if (value == null || !isFinite(value)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

module.exports = {
  calculateSolarPosition,
  calculateClearSkyIrradiance,
  adjustIrradianceForClouds,
  calculateSolarIrradiance,
  estimateCloudCoverFromUVI
};
