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
    // MOCK DATA FOR TEST SYSTEM
    if (systemId === 'test-system') {
      log.info('Generating mock current budget for test-system');
      return {
        systemId,
        scenario: 'current',
        timeframe: '30d',
        dataPoints: 720,
        dataQuality: { completeness: 100, samplesPerDay: 24, isReliable: true },
        energyFlow: { dailyGeneration: 2000, dailyConsumption: 1800, netDaily: 200, unit: 'Wh/day' },
        solarSufficiency: { percentage: 111, status: 'surplus', deficit: 0, note: null },
        batteryMetrics: {
          capacityAh: '200 Ah',
          capacityKwh: 9.6,
          capacityWh: 9600,
          avgStateOfCharge: 80,
          avgLoadCurrent: 1.5,
          avgLoadWatts: 72,
          daysOfAutonomy: 5.3,
          hoursOfAutonomy: 128,
          autonomyNote: 'Battery runtime at current 72W load: 5.3 days',
          peakPower: 1500
        },
        generatorRecommendation: null,
        recommendations: ['Mock Insight: System is balanced.']
      };
    }
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

    // Get system capacity and voltage for accurate calculations
    const systemCapacityAh = records[0].analysis.remainingCapacity || null;
    const nominalVoltage = records[0].analysis.overallVoltage || 48; // Use 48V as more common default for modern systems
    const fullCapacityAh = records[0].analysis.fullCapacity || systemCapacityAh;
    const batteryCapacityWh = fullCapacityAh ? fullCapacityAh * nominalVoltage : null;

    // Calculate average load (discharging current) for autonomy calculation
    const dischargingRecords = records.filter(r => r.analysis.current < -0.5);
    const avgDischargeCurrent = dischargingRecords.length > 0
      ? Math.abs(dischargingRecords.reduce((sum, r) => sum + r.analysis.current, 0) / dischargingRecords.length)
      : 0;
    const avgDischargeWatts = avgDischargeCurrent * nominalVoltage;

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

    // CRITICAL FIX: Days of autonomy = battery capacity ÷ AVERAGE LOAD, not deficit
    // This is RUNTIME until discharge at current load, NOT service life until replacement
    // Example: 660Ah @ 48V = 31,680 Wh. At 12A load (576W), that's 55 hours (2.3 days)
    const daysOfAutonomy = batteryCapacityWh && avgDischargeWatts > 0
      ? Math.round((batteryCapacityWh * (avgSoC / 100) * 0.8) / (avgDischargeWatts * 24) * 10) / 10  // 80% DoD, 24h/day
      : null;

    // Also calculate hours of autonomy for more precision on short runtimes
    const hoursOfAutonomy = batteryCapacityWh && avgDischargeWatts > 0
      ? Math.round((batteryCapacityWh * (avgSoC / 100) * 0.8) / avgDischargeWatts * 10) / 10
      : null;

    log.info('Current energy budget calculated', {
      systemId,
      dailyEnergyIn: Math.round(dailyEnergyIn),
      dailyEnergyOut: Math.round(dailyEnergyOut),
      solarSufficiency,
      hasTrueDeficit,
      effectiveDeficit: Math.round(effectiveDeficit),
      avgDischargeCurrent: Math.round(avgDischargeCurrent * 10) / 10,
      daysOfAutonomy,
      hoursOfAutonomy
    });

    // NEW: Calculate generator runtime recommendations if there's a deficit
    let generatorRecommendation = null;
    if (hasTrueDeficit && effectiveDeficit > 0) {
      // Get system info for generator capacity
      try {
        const systemsCollection = await getCollection('systems');
        const system = await systemsCollection.findOne({ id: systemId });

        if (system && system.maxAmpsGeneratorCharging) {
          const genChargeAmps = system.maxAmpsGeneratorCharging;
          const deficitAh = effectiveDeficit / nominalVoltage; // Convert Wh to Ah
          const runtimeHours = deficitAh / genChargeAmps;
          const runtimeMinutes = Math.round(runtimeHours * 60);

          generatorRecommendation = {
            dailyDeficitAh: Math.round(deficitAh * 10) / 10,
            dailyDeficitWh: Math.round(effectiveDeficit),
            generatorMaxAmps: genChargeAmps,
            recommendedRuntimeHours: Math.round(runtimeHours * 10) / 10,
            recommendedRuntimeMinutes: runtimeMinutes,
            estimatedFuelLiters: Math.round((effectiveDeficit / 1000) * GENERATOR_FUEL_CONSUMPTION_L_PER_KWH * 10) / 10,
            note: `To compensate for daily deficit, run generator at ${genChargeAmps}A for approximately ${runtimeMinutes} minutes per day (${Math.round(runtimeHours * 10) / 10} hours).`
          };

          log.info('Generator recommendation calculated', generatorRecommendation);
        }
      } catch (err) {
        log.warn('Failed to calculate generator recommendation', { error: err.message });
      }
    }

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
        capacityAh: fullCapacityAh ? `${Math.round(fullCapacityAh)} Ah` : 'unknown',
        capacityKwh: batteryCapacityWh ? Math.round(batteryCapacityWh / 1000 * 100) / 100 : null,
        avgStateOfCharge: Math.round(avgSoC * 10) / 10,
        avgLoadCurrent: Math.round(avgDischargeCurrent * 10) / 10,
        avgLoadWatts: Math.round(avgDischargeWatts),
        daysOfAutonomy,
        hoursOfAutonomy,
        autonomyNote: hoursOfAutonomy && hoursOfAutonomy < 72
          ? `Battery runtime at current ${Math.round(avgDischargeWatts)}W load: ${hoursOfAutonomy} hours (${daysOfAutonomy} days)`
          : daysOfAutonomy
            ? `Battery runtime at current ${Math.round(avgDischargeWatts)}W load: ${daysOfAutonomy} days`
            : 'Insufficient load data for autonomy calculation',
        peakPower: Math.round(peakPower)
      },
      generatorRecommendation,
      recommendations: generateBudgetRecommendations(solarSufficiency, netDaily, daysOfAutonomy, generatorRecommendation)
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
    // MOCK DATA FOR TEST SYSTEM
    if (systemId === 'test-system') {
      log.info('Generating mock worst-case scenario for test-system');
      return {
        systemId,
        scenario: 'worst_case',
        timeframe: '30d',
        worstCaseMetrics: {
          minDailyGeneration: 1000,
          maxDailyConsumption: 2500,
          dailyDeficit: 1500,
          unit: 'Wh/day'
        },
        batteryAutonomy: {
          daysWithoutSolar: 2.1,
          hoursWithoutSolar: 50,
          assumption: '80% depth of discharge',
          calculation: 'Mock calculation'
        },
        comparisonToAverage: { generationReduction: 50, consumptionIncrease: 39 },
        recommendations: ['Mock Insight: Consider backup generator for worst-case scenarios.']
      };
    }
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
    const batteryCapacityWh = currentBudget.batteryMetrics.capacityKwh
      ? currentBudget.batteryMetrics.capacityKwh * 1000
      : 0;

    // Get average load from current budget for accurate autonomy calculation
    const avgLoadWatts = currentBudget.batteryMetrics.avgLoadWatts || (worstCaseConsumption / 24);

    // CRITICAL FIX: Days without solar = battery capacity ÷ ACTUAL LOAD, not deficit
    // Example: 31,680 Wh battery @ 576W load = 55 hours, NOT 109 days
    const daysWithoutSolar = batteryCapacityWh > 0 && avgLoadWatts > 0
      ? Math.round((batteryCapacityWh * 0.8) / (avgLoadWatts * 24) * 10) / 10 // 80% DoD
      : null;

    const hoursWithoutSolar = batteryCapacityWh > 0 && avgLoadWatts > 0
      ? Math.round((batteryCapacityWh * 0.8) / avgLoadWatts * 10) / 10
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
        hoursWithoutSolar,
        assumption: '80% depth of discharge',
        calculation: `Battery runtime at ${Math.round(avgLoadWatts)}W load: ${hoursWithoutSolar}h (${daysWithoutSolar} days) - this is RUNTIME until discharge, NOT years until replacement`
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
    // MOCK DATA FOR TEST SYSTEM
    if (systemId === 'test-system') {
      log.info('Generating mock emergency backup for test-system');
      return {
        systemId,
        scenario: 'emergency',
        dailyConsumption: 1800,
        batteryCapacity: 9600,
        unit: 'Wh',
        emergencyScenarios: [
          { period: '3 days', totalEnergyNeeded: 5400, batteryCoverage: '100%', generatorEnergy: 0, recommendedGenerator: 'Not needed', estimatedFuel: 'None', runtime: '0 hours' },
          { period: '5 days', totalEnergyNeeded: 9000, batteryCoverage: '100%', generatorEnergy: 0, recommendedGenerator: 'Not needed', estimatedFuel: 'None', runtime: '0 hours' },
          { period: '7 days', totalEnergyNeeded: 12600, batteryCoverage: '76%', generatorEnergy: 3000, recommendedGenerator: '1000W minimum', estimatedFuel: '5L', runtime: '10 hours' }
        ],
        recommendations: ['Mock Insight: Battery capacity is sufficient for short emergencies.']
      };
    }
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
function generateBudgetRecommendations(solarSufficiency, netDaily, daysOfAutonomy, generatorRecommendation = null) {
  const recommendations = [];

  if (solarSufficiency < 80) {
    recommendations.push(`Solar generation covers only ${solarSufficiency}% of consumption. Consider adding solar panels or reducing loads.`);

    // Add generator recommendation if available
    if (generatorRecommendation) {
      recommendations.push(generatorRecommendation.note);
    }
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
