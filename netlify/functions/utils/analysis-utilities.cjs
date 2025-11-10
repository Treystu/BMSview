/**
 * Shared Utilities for Analysis Modules
 * 
 * Common helper functions used across forecasting, pattern analysis, and energy budget modules.
 * 
 * @module netlify/functions/utils/analysis-utilities
 */

/**
 * Parse time range string (e.g., "7d", "30d", "90d", "1y") to number of days
 * 
 * @param {string} timeRange - Time range string (e.g., "30d", "2w", "3m", "1y")
 * @returns {number} Number of days
 * 
 * @example
 * parseTimeRange("7d") // Returns 7
 * parseTimeRange("2w") // Returns 14
 * parseTimeRange("3m") // Returns 90
 * parseTimeRange("1y") // Returns 365
 */
function parseTimeRange(timeRange) {
  const match = timeRange.match(/^(\d+)(d|w|m|y)$/);
  if (!match) return 30; // Default to 30 days
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 'd': return value;
    case 'w': return value * 7;
    case 'm': return value * 30;
    case 'y': return value * 365;
    default: return 30;
  }
}

/**
 * Calculate statistics (mean, standard deviation, min, max) for a numeric array
 * 
 * @param {number[]} values - Array of numeric values
 * @returns {Object} Statistics object with mean, stdDev, min, max
 */
function calculateStats(values) {
  if (values.length === 0) {
    return { mean: 0, stdDev: 0, min: 0, max: 0 };
  }
  
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  
  return { mean, stdDev, min, max };
}

/**
 * Battery replacement threshold constants
 * Different battery chemistries have different end-of-life criteria
 */
const BATTERY_REPLACEMENT_THRESHOLDS = {
  // Lithium-based batteries (LiFePO4, Li-ion)
  lithium: 0.80, // 80% of original capacity is common replacement threshold
  
  // Lead-acid batteries
  leadAcid: 0.70, // 70% is typical for lead-acid
  
  // Default (conservative estimate)
  default: 0.80
};

/**
 * Anomaly detection threshold in standard deviations
 * Values beyond this many standard deviations are considered anomalies
 * 
 * Common values:
 * - 2.0σ: ~95% confidence (more sensitive, catches more anomalies)
 * - 2.5σ: ~98% confidence (balanced sensitivity)
 * - 3.0σ: ~99.7% confidence (less sensitive, only extreme outliers)
 */
const ANOMALY_THRESHOLD_SIGMA = 2.5;

/**
 * Generator fuel consumption estimate
 * Average fuel consumption for portable generators
 * 
 * Note: Actual consumption varies by generator type, load, and efficiency.
 * This is a conservative estimate for planning purposes.
 */
const GENERATOR_FUEL_CONSUMPTION_L_PER_KWH = 0.3; // Liters per kWh

/**
 * Group consecutive alert occurrences into time-based events
 * 
 * The key insight: Multiple screenshots showing the same alert don't represent multiple events.
 * They represent ONE event that persists until the threshold is crossed back.
 * 
 * For example:
 * - 30 screenshots from 2am-6am all showing "Low battery: 18.6%" (threshold: 20%)
 * - This is ONE 4-hour event, not 30 events
 * - Event ends when next screenshot shows SOC > 20%
 * 
 * Time-of-day inference:
 * - Low battery at night (18:00-06:00) likely clears when sun comes up
 * - If no screenshot confirms recovery, estimate recovery time based on typical solar hours
 * 
 * @param {Array} snapshots - Array of snapshots with timestamps and alerts
 * @param {Object} options - Configuration options
 * @param {number} options.maxGapHours - Maximum hours between snapshots to consider same event (default: 12)
 * @returns {Object} Alert event analysis with grouped events and statistics
 */
function groupAlertEvents(snapshots, options = {}) {
  const { maxGapHours = 12 } = options;
  
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return {
      events: [],
      totalEvents: 0,
      totalAlertOccurrences: 0,
      eventsByAlert: {}
    };
  }

  // Sort snapshots chronologically
  const sorted = [...snapshots].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const events = [];
  const activeEvents = new Map(); // alertText -> current event

  for (const snapshot of sorted) {
    const snapshotTime = new Date(snapshot.timestamp);
    const alerts = Array.isArray(snapshot.alerts) ? snapshot.alerts : [];
    const soc = snapshot.soc;

    // Process each alert in current snapshot
    for (const alertText of alerts) {
      const normalizedAlert = String(alertText).trim();
      
      if (activeEvents.has(normalizedAlert)) {
        // Continue existing event
        const event = activeEvents.get(normalizedAlert);
        const lastTime = new Date(event.lastSeen);
        const gapHours = (snapshotTime - lastTime) / (1000 * 60 * 60);

        if (gapHours <= maxGapHours) {
          // Same event continuing
          event.lastSeen = snapshot.timestamp;
          event.occurrences++;
          if (soc != null) {
            event.socValues.push(soc);
          }
        } else {
          // Gap too large, close previous event and start new one
          closeEvent(event, events);
          activeEvents.set(normalizedAlert, createEvent(normalizedAlert, snapshot));
        }
      } else {
        // New event starting
        activeEvents.set(normalizedAlert, createEvent(normalizedAlert, snapshot));
      }
    }

    // Check for events that may have cleared (threshold recovery)
    for (const [alertText, event] of activeEvents.entries()) {
      if (!alerts.includes(alertText)) {
        // Alert not present in current snapshot - may have cleared
        const lastTime = new Date(event.lastSeen);
        const gapHours = (snapshotTime - lastTime) / (1000 * 60 * 60);

        if (gapHours <= maxGapHours) {
          // Close the event - threshold recovered
          event.recoveryTimestamp = snapshot.timestamp;
          event.recoverySOC = soc;
          event.recoveryInferred = false; // Confirmed by data
          closeEvent(event, events);
          activeEvents.delete(alertText);
        }
      }
    }
  }

  // Close any remaining active events with inference
  for (const event of activeEvents.values()) {
    inferEventRecovery(event, sorted);
    closeEvent(event, events);
  }

  // Calculate statistics
  const eventsByAlert = {};
  let totalOccurrences = 0;

  for (const event of events) {
    if (!eventsByAlert[event.alert]) {
      eventsByAlert[event.alert] = {
        alert: event.alert,
        eventCount: 0,
        totalOccurrences: 0,
        totalDurationHours: 0,
        avgDurationHours: 0,
        avgSOC: null,
        events: []
      };
    }

    const group = eventsByAlert[event.alert];
    group.eventCount++;
    group.totalOccurrences += event.occurrences;
    group.totalDurationHours += event.durationHours;
    group.events.push(event);
    totalOccurrences += event.occurrences;
  }

  // Calculate averages
  for (const group of Object.values(eventsByAlert)) {
    group.avgDurationHours = group.eventCount > 0 
      ? group.totalDurationHours / group.eventCount 
      : 0;
    
    const allSOC = group.events.flatMap(e => e.socValues).filter(s => s != null);
    group.avgSOC = allSOC.length > 0
      ? allSOC.reduce((sum, s) => sum + s, 0) / allSOC.length
      : null;
  }

  return {
    events,
    totalEvents: events.length,
    totalAlertOccurrences: totalOccurrences,
    eventsByAlert,
    summary: Object.values(eventsByAlert)
      .sort((a, b) => b.totalOccurrences - a.totalOccurrences)
      .slice(0, 10) // Top 10 alerts
  };
}

/**
 * Create a new alert event
 */
function createEvent(alertText, snapshot) {
  return {
    alert: alertText,
    firstSeen: snapshot.timestamp,
    lastSeen: snapshot.timestamp,
    occurrences: 1,
    socValues: snapshot.soc != null ? [snapshot.soc] : [],
    recoveryTimestamp: null,
    recoverySOC: null,
    recoveryInferred: false,
    durationHours: 0
  };
}

/**
 * Close an event and calculate its duration
 */
function closeEvent(event, events) {
  const start = new Date(event.firstSeen);
  const end = event.recoveryTimestamp 
    ? new Date(event.recoveryTimestamp)
    : new Date(event.lastSeen);
  
  event.durationHours = (end - start) / (1000 * 60 * 60);
  
  // Calculate average SOC during event
  if (event.socValues.length > 0) {
    event.avgSOC = event.socValues.reduce((sum, s) => sum + s, 0) / event.socValues.length;
  } else {
    event.avgSOC = null;
  }

  events.push(event);
}

/**
 * Infer when an event likely recovered using time-of-day context
 */
function inferEventRecovery(event, allSnapshots) {
  const lastSeenTime = new Date(event.lastSeen);
  const lastSeenHour = lastSeenTime.getHours();

  // Find next snapshot after this event
  const nextSnapshot = allSnapshots.find(s => 
    new Date(s.timestamp) > lastSeenTime
  );

  if (nextSnapshot) {
    const nextTime = new Date(nextSnapshot.timestamp);
    const isNightEvent = lastSeenHour >= 18 || lastSeenHour < 6;
    const nextHour = nextTime.getHours();
    const isMorning = nextHour >= 6 && nextHour < 12;

    // If alert was at night and next snapshot is morning/day, likely recovered with sunrise
    if (isNightEvent && isMorning && nextSnapshot.soc && nextSnapshot.soc > (event.avgSOC || 0)) {
      event.recoveryTimestamp = nextSnapshot.timestamp;
      event.recoverySOC = nextSnapshot.soc;
      event.recoveryInferred = true;
      event.inferredRecoveryReason = 'Likely recovered with sunrise - next reading shows higher SOC during daylight';
    } else {
      // Use next snapshot time as upper bound
      event.recoveryTimestamp = nextSnapshot.timestamp;
      event.recoverySOC = nextSnapshot.soc;
      event.recoveryInferred = true;
      event.inferredRecoveryReason = 'Recovery time estimated based on next available reading';
    }
  } else {
    // No subsequent snapshot - event may still be active
    event.recoveryTimestamp = null;
    event.recoveryInferred = true;
    event.inferredRecoveryReason = 'Event may still be active - no subsequent data available';
  }
}

module.exports = {
  parseTimeRange,
  calculateStats,
  groupAlertEvents,
  BATTERY_REPLACEMENT_THRESHOLDS,
  ANOMALY_THRESHOLD_SIGMA,
  GENERATOR_FUEL_CONSUMPTION_L_PER_KWH
};
