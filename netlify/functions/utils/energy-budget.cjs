/**
 * Energy Budget Module - Solar Sufficiency and Scenario Planning
 * 
 * Calculates energy requirements, solar generation capacity, and backup needs
 * for different scenarios. Critical for off-grid planning and expansion decisions.
 * 
 * @module netlify/functions/utils/energy-budget
 */

const { getCollection } = require('./mongodb.cjs');
const { parseTimeRange, GENERATOR_FUEL_CONSUMPTION_L_PER_KWH } = require('./analysis-utilities.cjs');

/**
 * Calculate current energy budget based on recent usage
 */
async function calculateCurrentBudget(systemId, timeframe = '30d', includeWeather = true, log) {
  log.info('Calculating current energy budget', { systemId, timeframe, includeWeather });

  try {
    const days = parseTimeRange(timeframe);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const historyCollection = await getCollection('history');
    const records = await historyCollection
      .find({
        systemId,
        timestamp: { $gte: startDate.toISOString() },
        'analysis.current': { $exists: true },
        'analysis.power': { $exists: true },
        'analysis.stateOfCharge': { $exists: true }
      })
      .sort({ timestamp: 1 })
      .toArray();

    if (records.length < 24) {
      return {
        error: false,
        insufficient_data: true,
        message: `Insufficient data for energy budget calculation. Need at least 24 hours of data.`,
        systemId
      };
    }

    // Calculate energy metrics
    let totalEnergyIn = 0; // Charging (Wh)
    let totalEnergyOut = 0; // Discharging (Wh)
    let peakPower = 0;
    let avgSoC = 0;

    for (let i = 0; i < records.length - 1; i++) {
      const current = records[i];
      const next = records[i + 1];

      const power = current.analysis.power || 0;
      const soc = current.analysis.stateOfCharge || 0;

      // Calculate time delta in hours
      const timeDelta = (new Date(next.timestamp) - new Date(current.timestamp)) / (1000 * 60 * 60);

      if (timeDelta > 0 && timeDelta < 2) { // Filter outliers
        const energy = Math.abs(power) * timeDelta; // Wh

        if (power > 0) {
          totalEnergyIn += energy;
        } else if (power < 0) {
          totalEnergyOut += energy;
        }

        peakPower = Math.max(peakPower, Math.abs(power));
      }

      avgSoC += soc;
    }

    avgSoC = avgSoC / records.length;

    // Calculate daily averages
    const dailyEnergyIn = totalEnergyIn / days;
    const dailyEnergyOut = totalEnergyOut / days;
    const netDaily = dailyEnergyIn - dailyEnergyOut;

    // NEW: Data quality check for sporadic screenshots
    const expectedSamplesPerDay = 24; // Hourly screenshots
    const actualSamplesPerDay = records.length / days;
    const dataCompleteness = Math.min(100, (actualSamplesPerDay / expectedSamplesPerDay) * 100);

    // If data is sparse, we can't reliably detect deficits
    const hasSparsData = dataCompleteness < 60; // Less than 60% coverage

    log.info('Energy budget data quality', {
      systemId,
      dataCompleteness: Math.round(dataCompleteness),
      samplesPerDay: Math.round(actualSamplesPerDay),
      hasSparsData
    });

    // Get system capacity from first record
    const systemCapacity = records[0].analysis.remainingCapacity || null;
    const nominalVoltage = records[0].analysis.overallVoltage || 12; // Assume 12V if not available
    const batteryCapacityWh = systemCapacity ? systemCapacity * nominalVoltage : null;

    // Calculate sufficiency metrics with tolerance for measurement variance
    // NEW: Apply ±10% tolerance band to account for sporadic data and measurement noise
    const TOLERANCE_PERCENT = 10;
    const toleranceBand = dailyEnergyOut * (TOLERANCE_PERCENT / 100);
    const effectiveDeficit = Math.max(0, dailyEnergyOut - dailyEnergyIn - toleranceBand);

    // Only report deficit if it's significant (>10% under needs) AND we have good data
    const hasTrueDeficit = !hasSparsData && effectiveDeficit > 0;

    const solarSufficiency = dailyEnergyIn > 0 && dailyEnergyOut > 0
      ? Math.min(100, Math.round((dailyEnergyIn / dailyEnergyOut) * 100))
      : 0;

    // Days of autonomy (at current usage rate)
    // This is RUNTIME until discharge, NOT service life until replacement
    const daysOfAutonomy = batteryCapacityWh && dailyEnergyOut > 0
      ? Math.round((batteryCapacityWh * (avgSoC / 100)) / dailyEnergyOut * 10) / 10
      : null;

    log.info('Current energy budget calculated', {
      systemId,
      dailyEnergyIn: Math.round(dailyEnergyIn),
      dailyEnergyOut: Math.round(dailyEnergyOut),
      solarSufficiency,
      hasTrueDeficit,
      effectiveDeficit: Math.round(effectiveDeficit)
    });

    return {
      systemId,
      scenario: 'current',
      timeframe: `${days} days`,
      dataPoints: records.length,
      dataQuality: {
        completeness: Math.round(dataCompleteness),
        samplesPerDay: Math.round(actualSamplesPerDay),
        isReliable: !hasSparsData
      },
      energyFlow: {
        dailyGeneration: Math.round(dailyEnergyIn),
        dailyConsumption: Math.round(dailyEnergyOut),
        netDaily: Math.round(netDaily),
        unit: 'Wh/day'
      },
      solarSufficiency: {
        percentage: solarSufficiency,
        status: hasTrueDeficit ? 'deficit' : solarSufficiency >= 100 ? 'surplus' : solarSufficiency >= 80 ? 'adequate' : 'balanced',
        deficit: hasTrueDeficit ? Math.round(effectiveDeficit) : 0,
        note: hasSparsData ? 'Sporadic data - calculations may be inaccurate. Need more frequent screenshots for reliable deficit detection.' : null
      },
      batteryMetrics: {
        capacity: systemCapacity ? `${systemCapacity} Ah` : 'unknown',
        capacityWh: batteryCapacityWh ? Math.round(batteryCapacityWh) : null,
        avgStateOfCharge: Math.round(avgSoC * 10) / 10,
        daysOfAutonomy,
        peakPower: Math.round(peakPower)
      },
      recommendations: generateBudgetRecommendations(solarSufficiency, netDaily, daysOfAutonomy)
    };

  } catch (error) {
    log.error('Current budget calculation failed', { error: error.message, systemId });
    throw error;
  }
}

/**
 * Calculate worst-case scenario (minimum solar + maximum consumption)
 */
async function calculateWorstCase(systemId, timeframe = '30d', includeWeather = true, log) {
  log.info('Calculating worst-case scenario', { systemId, timeframe });

  try {
    // First get current budget
    const currentBudget = await calculateCurrentBudget(systemId, timeframe, includeWeather, log);

    if (currentBudget.error || currentBudget.insufficient_data) {
      return currentBudget;
    }

    const days = parseTimeRange(timeframe);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const historyCollection = await getCollection('history');
    const records = await historyCollection
      .find({
        systemId,
        timestamp: { $gte: startDate.toISOString() },
        'analysis.power': { $exists: true }
      })
      .sort({ timestamp: 1 })
      .toArray();

    // Find worst-case daily values
    const dailyData = {};

    for (const record of records) {
      const date = new Date(record.timestamp).toISOString().split('T')[0];
      const power = record.analysis.power || 0;

      if (!dailyData[date]) {
        dailyData[date] = { generation: 0, consumption: 0 };
      }

      // Note: Assuming ~1-minute data intervals for energy calculation
      // For different intervals, this calculation should be adjusted dynamically
      // based on actual timestamp differences
      if (power > 0) {
        dailyData[date].generation += power / 60; // Approximate Wh (assuming 1-min intervals)
      } else {
        dailyData[date].consumption += Math.abs(power) / 60;
      }
    }

    // Get percentile values
    const dailyGenerations = Object.values(dailyData).map(d => d.generation).sort((a, b) => a - b);
    const dailyConsumptions = Object.values(dailyData).map(d => d.consumption).sort((a, b) => b - a);

    // Worst case: 10th percentile generation, 90th percentile consumption
    const worstCaseGeneration = dailyGenerations[Math.floor(dailyGenerations.length * 0.1)] || 0;
    const worstCaseConsumption = dailyConsumptions[Math.floor(dailyConsumptions.length * 0.1)] || 0;

    const deficit = worstCaseConsumption - worstCaseGeneration;
    const batteryCapacityWh = currentBudget.batteryMetrics.capacityWh || 0;

    // Days battery can sustain deficit
    const daysWithoutSolar = batteryCapacityWh > 0 && deficit > 0
      ? Math.round((batteryCapacityWh * 0.8) / deficit * 10) / 10 // Assume 80% DoD
      : null;

    return {
      systemId,
      scenario: 'worst_case',
      timeframe: `${days} days`,
      worstCaseMetrics: {
        minDailyGeneration: Math.round(worstCaseGeneration),
        maxDailyConsumption: Math.round(worstCaseConsumption),
        dailyDeficit: Math.round(deficit),
        unit: 'Wh/day'
      },
      batteryAutonomy: {
        daysWithoutSolar,
        assumption: '80% depth of discharge'
      },
      comparisonToAverage: {
        generationReduction: currentBudget.energyFlow.dailyGeneration > 0
          ? Math.round((1 - worstCaseGeneration / currentBudget.energyFlow.dailyGeneration) * 100)
          : 0,
        consumptionIncrease: currentBudget.energyFlow.dailyConsumption > 0
          ? Math.round((worstCaseConsumption / currentBudget.energyFlow.dailyConsumption - 1) * 100)
          : 0
      },
      recommendations: [
        daysWithoutSolar && daysWithoutSolar < 2
          ? 'Critical: Battery autonomy is less than 2 days in worst-case scenarios. Consider adding battery capacity or backup generator.'
          : daysWithoutSolar && daysWithoutSolar < 3
            ? 'Warning: Limited battery autonomy in worst-case scenarios. Monitor closely during low-solar periods.'
            : 'Battery autonomy appears adequate for worst-case scenarios.',
        deficit > currentBudget.energyFlow.dailyGeneration * 0.5
          ? 'Worst-case deficit exceeds 50% of average generation. Consider expanding solar array.'
          : 'Worst-case deficit is manageable with current solar capacity.'
      ]
    };

  } catch (error) {
    log.error('Worst-case calculation failed', { error: error.message, systemId });
    throw error;
  }
}

/**
 * Calculate average scenario
 */
async function calculateAverage(systemId, timeframe = '30d', includeWeather = true, log) {
  log.info('Calculating average scenario', { systemId, timeframe });

  // Average scenario is essentially the current budget
  const budget = await calculateCurrentBudget(systemId, timeframe, includeWeather, log);

  if (budget.error || budget.insufficient_data) {
    return budget;
  }

  return {
    ...budget,
    scenario: 'average',
    note: 'Average scenario represents typical operating conditions based on historical data.'
  };
}

/**
 * Calculate emergency backup requirements
 */
async function calculateEmergencyBackup(systemId, timeframe = '30d', log) {
  log.info('Calculating emergency backup requirements', { systemId, timeframe });

  try {
    const currentBudget = await calculateCurrentBudget(systemId, timeframe, false, log);

    if (currentBudget.error || currentBudget.insufficient_data) {
      return currentBudget;
    }

    const dailyConsumption = currentBudget.energyFlow.dailyConsumption;
    const batteryCapacityWh = currentBudget.batteryMetrics.capacityWh || 0;

    // Emergency scenarios: 3 days, 5 days, 7 days without solar
    const emergencyPeriods = [3, 5, 7];
    const scenarios = emergencyPeriods.map(days => {
      const totalNeeded = dailyConsumption * days;
      const batteryCoverage = batteryCapacityWh > 0
        ? Math.round((batteryCapacityWh * 0.8 / totalNeeded) * 100)
        : 0;
      const generatorNeeded = Math.max(0, totalNeeded - (batteryCapacityWh * 0.8));

      // Generator sizing (assume 50% runtime efficiency)
      const generatorWatts = generatorNeeded > 0
        ? Math.ceil((generatorNeeded / days) / 0.5 / 10) * 10 // Round to nearest 10W
        : 0;

      // Fuel estimate using configurable constant (0.3L/kWh is typical for portable generators)
      // Note: Actual consumption varies by generator type, load, and efficiency
      const fuelNeeded = generatorWatts > 0
        ? Math.round(generatorWatts * days * GENERATOR_FUEL_CONSUMPTION_L_PER_KWH / 1000 * 10) / 10
        : 0;

      return {
        period: `${days} days`,
        totalEnergyNeeded: Math.round(totalNeeded),
        batteryCoverage: `${batteryCoverage}%`,
        generatorEnergy: Math.round(generatorNeeded),
        recommendedGenerator: generatorWatts > 0 ? `${generatorWatts}W minimum` : 'Not needed',
        estimatedFuel: fuelNeeded > 0 ? `${fuelNeeded}L` : 'None',
        runtime: generatorWatts > 0 ? `${Math.round(days * 12)} hours` : '0 hours'
      };
    });

    return {
      systemId,
      scenario: 'emergency',
      dailyConsumption: Math.round(dailyConsumption),
      batteryCapacity: batteryCapacityWh ? Math.round(batteryCapacityWh) : 'unknown',
      unit: 'Wh',
      emergencyScenarios: scenarios,
      recommendations: [
        batteryCapacityWh < dailyConsumption * 2
          ? 'Battery capacity is less than 2 days of consumption. Consider adding battery storage for emergency preparedness.'
          : 'Battery capacity provides good emergency backup.',
        'Always maintain fuel reserves for extended no-solar periods (1 week minimum).',
        'Consider reducing non-essential loads during emergencies to extend battery life.'
      ]
    };

  } catch (error) {
    log.error('Emergency backup calculation failed', { error: error.message, systemId });
    throw error;
  }
}

/**
 * Generate recommendations based on budget analysis
 */
function generateBudgetRecommendations(solarSufficiency, netDaily, daysOfAutonomy) {
  const recommendations = [];

  if (solarSufficiency < 80) {
    recommendations.push(`Solar generation covers only ${solarSufficiency}% of consumption. Consider adding solar panels or reducing loads.`);
  } else if (solarSufficiency >= 100) {
    recommendations.push(`Excellent: Solar generation exceeds consumption by ${Math.round((solarSufficiency - 100) * 10) / 10}%. System is sustainable.`);
  } else {
    recommendations.push('Solar generation is adequate but monitor during low-sunlight seasons.');
  }

  if (daysOfAutonomy && daysOfAutonomy < 1) {
    recommendations.push('Critical: Battery autonomy is less than 1 day at current SoC. Charge immediately or reduce loads.');
  } else if (daysOfAutonomy && daysOfAutonomy < 2) {
    recommendations.push('Warning: Battery autonomy is less than 2 days. Consider increasing battery capacity.');
  }

  if (netDaily < -100) {
    recommendations.push(`Daily energy deficit of ${Math.round(Math.abs(netDaily))} Wh. System is running on stored battery energy.`);
  } else if (netDaily > 100) {
    recommendations.push(`Daily energy surplus of ${Math.round(netDaily)} Wh. Battery charging efficiently.`);
  }

  return recommendations;
}

module.exports = {
  calculateCurrentBudget,
  calculateWorstCase,
  calculateAverage,
  calculateEmergencyBackup
};
