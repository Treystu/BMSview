// battery-analysis.new.cjs
// Revised utilities to satisfy test expectations and improve robustness.

/**
 * Calculate runtime estimate based on measurements and last known battery state.
 * Returns an object with runtimeHours, explanation, and confidence.
 * If insufficient data, returns null runtime and low confidence.
 */
function calculateRuntimeEstimate(measurements, lastKnown = {}) {
    const defaultResult = {
        runtimeHours: null,
        explanation: 'Insufficient data for runtime estimate',
        confidence: 'low'
    };

    if (!Array.isArray(measurements) || measurements.length === 0) {
        return defaultResult;
    }

    // Prefer explicit lastKnown values; fall back to latest measurement.
    const capacityAh = lastKnown.capacityAh || lastKnown.capacity || measurements[measurements.length - 1].capacity;
    const voltage = lastKnown.voltage || measurements[measurements.length - 1].voltage;
    const soc = lastKnown.stateOfCharge ?? lastKnown.soc ?? measurements[measurements.length - 1].stateOfCharge;

    if (capacityAh == null || voltage == null || soc == null) {
        return defaultResult;
    }

    // Usable energy in Wh.
    const usableWh = capacityAh * voltage * (soc / 100);

    // Find discharge measurements (negative current) with valid voltage.
    const discharge = measurements.filter(m => typeof m.current === 'number' && m.current < 0 && typeof m.voltage === 'number');

    let runtime = null;
    let explanation = '';
    let confidence = 'low';

    if (discharge.length > 0) {
        // Average power draw in Watts.
        const avgPowerW = discharge.reduce((sum, m) => sum + Math.abs(m.current * m.voltage), 0) / discharge.length;
        if (avgPowerW > 0) {
            runtime = usableWh / avgPowerW;
            explanation = `Estimated from last known capacity using average discharge power of ${Math.round(avgPowerW)}W`;
            confidence = discharge.length > 100 ? 'high' : 'medium';
        }
    }

    // Fallback: estimate based on state of charge change over time.
    if (runtime === null) {
        const socRecords = measurements.filter(m => typeof m.stateOfCharge === 'number');
        if (socRecords.length >= 2) {
            const first = socRecords[0];
            const last = socRecords[socRecords.length - 1];
            const hours = (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 3600000;
            const socDrop = (first.stateOfCharge || 0) - (last.stateOfCharge || 0);
            if (hours > 0 && socDrop > 0) {
                runtime = ((last.stateOfCharge || 0) / (socDrop / hours));
                explanation = `Estimated from SOC trend over ${Math.round(hours)}h`;
                confidence = 'low';
            }
        }
    }

    if (runtime !== null) {
        // Clamp to realistic bounds (1 hour to 1 week).
        runtime = Math.max(1, Math.min(168, runtime));
        runtime = Math.round(runtime * 10) / 10;
        return { runtimeHours: runtime, explanation, confidence };
    }

    return defaultResult;
}

/**
 * Generate generator recommendations.
 * Returns an array of recommendation objects.
 * Each object contains:
 *   - recommended (boolean)
 *   - suggestedGeneratorKW (number, optional)
 *   - message (string)
 */
function generateGeneratorRecommendations(runtimeHours, avgPowerW) {
    const recommendations = [];

    if (typeof runtimeHours !== 'number' || typeof avgPowerW !== 'number') {
        recommendations.push({ recommended: false, message: 'Insufficient data for generator recommendations' });
        return recommendations;
    }

    // Determine generator size in kW.
    let suggestedKW = 0;
    if (avgPowerW < 1000) {
        suggestedKW = 2; // small portable
    } else if (avgPowerW < 3000) {
        suggestedKW = 5; // mid-sized
    } else {
        suggestedKW = 7; // large standby
    }

    recommendations.push({
        recommended: true,
        suggestedGeneratorKW: suggestedKW,
        message: `Generator size ${suggestedKW}kW recommended for avg power ${avgPowerW}W`
    });

    // Runtime based advice.
    if (runtimeHours < 4) {
        recommendations.push({ recommended: true, message: 'Consider adding battery capacity for longer runtime' });
    } else if (runtimeHours > 24) {
        recommendations.push({ recommended: true, message: 'Current capacity sufficient for extended outages' });
    }

    const dailyKwh = (avgPowerW * 24) / 1000;
    recommendations.push({ recommended: true, message: `Estimated daily consumption: ${Math.round(dailyKwh)}kWh` });

    return recommendations;
}

module.exports = {
    calculateRuntimeEstimate,
    generateGeneratorRecommendations
};
