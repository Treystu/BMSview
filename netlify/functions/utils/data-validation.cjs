"use strict";

/**
 * Data Integrity Validation Layer
 * 
 * Validates analysis data for physical consistency and sanity.
 * Designed to catch AI OCR errors like misread digits (13.4V vs 18.4V) or hallucinated values.
 * 
 * @module data-validation
 */

/**
 * Validate analysis data for physical integrity and logical consistency
 * 
 * @param {Object} data - AnalysisData object to validate
 * @param {Object} log - Logger instance (optional)
 * @returns {Object} Validation result { isValid: boolean, warnings: string[], flags: string[] }
 */
function validateAnalysisData(data, log = null) {
    const warnings = [];
    const flags = [];
    let isValid = true;

    // Helper function to add warning
    const addWarning = (message, isCritical = false) => {
        warnings.push(message);
        if (isCritical) {
            flags.push(message);
            isValid = false;
        }
        if (log) {
            log(isCritical ? 'warn' : 'info', 'Validation check: ' + message, { isCritical });
        }
    };

    // 1. State of Charge Range Check (0-100%)
    if (data.stateOfCharge !== null && data.stateOfCharge !== undefined) {
        if (data.stateOfCharge < 0 || data.stateOfCharge > 100) {
            addWarning(`Invalid SOC: ${data.stateOfCharge}% (must be 0-100%)`, true);
        }
    }

    // 2. Cell Voltage Range Check (2.0V - 4.5V for typical LiFePO4/Li-ion)
    if (data.cellVoltages && Array.isArray(data.cellVoltages) && data.cellVoltages.length > 0) {
        const MIN_CELL_VOLTAGE = 2.0;
        const MAX_CELL_VOLTAGE = 4.5;
        
        data.cellVoltages.forEach((voltage, index) => {
            if (voltage < MIN_CELL_VOLTAGE || voltage > MAX_CELL_VOLTAGE) {
                addWarning(`Cell ${index + 1} voltage ${voltage}V out of range (${MIN_CELL_VOLTAGE}-${MAX_CELL_VOLTAGE}V)`, true);
            }
        });
    }

    // 3. Physics Check: Overall voltage should approximately match sum of cell voltages
    if (data.overallVoltage && data.cellVoltages && data.cellVoltages.length > 0) {
        const sumCellVoltages = data.cellVoltages.reduce((sum, v) => sum + v, 0);
        const VOLTAGE_TOLERANCE = 0.5; // Allow ±0.5V margin for BMS reading variations
        
        const voltageDiff = Math.abs(data.overallVoltage - sumCellVoltages);
        if (voltageDiff > VOLTAGE_TOLERANCE) {
            addWarning(
                `Voltage mismatch: Overall ${data.overallVoltage}V vs sum of cells ${sumCellVoltages.toFixed(2)}V (diff: ${voltageDiff.toFixed(2)}V)`,
                voltageDiff > 1.0 // Critical if diff > 1V
            );
        }
    }

    // 4. Temperature Range Check (0-100°C for battery operation)
    const MIN_TEMP = 0;
    const MAX_TEMP = 100;
    
    // Check main battery temperature
    if (data.temperature !== null && data.temperature !== undefined) {
        if (data.temperature <= MIN_TEMP || data.temperature > MAX_TEMP) {
            addWarning(`Suspicious battery temperature: ${data.temperature}°C (expected ${MIN_TEMP}-${MAX_TEMP}°C)`, true);
        }
    }

    // Check temperature array
    if (data.temperatures && Array.isArray(data.temperatures)) {
        data.temperatures.forEach((temp, index) => {
            if (temp <= MIN_TEMP || temp > MAX_TEMP) {
                addWarning(`Suspicious temperature sensor ${index + 1}: ${temp}°C (expected ${MIN_TEMP}-${MAX_TEMP}°C)`, true);
            }
        });
    }

    // Check MOS temperature
    if (data.mosTemperature !== null && data.mosTemperature !== undefined) {
        if (data.mosTemperature <= MIN_TEMP || data.mosTemperature > MAX_TEMP) {
            addWarning(`Suspicious MOS temperature: ${data.mosTemperature}°C (expected ${MIN_TEMP}-${MAX_TEMP}°C)`, true);
        }
    }

    // 5. Logical Consistency: Discharge MOS and Current Direction
    // If current < 0 (discharging), dischargeMosOn should typically be true
    if (data.current !== null && data.current !== undefined && data.current < -0.5) {
        // Only check if we have discharge MOS status
        if (data.dischargeMosOn === false) {
            addWarning(
                `Discharge current detected (${data.current}A) but discharge MOS is OFF - possible data inconsistency`,
                false // Not critical, could be transient state
            );
        }
    }

    // 6. Logical Consistency: Charge MOS and Current Direction
    // If current > 0 (charging), chargeMosOn should typically be true
    if (data.current !== null && data.current !== undefined && data.current > 0.5) {
        // Only check if we have charge MOS status
        if (data.chargeMosOn === false) {
            addWarning(
                `Charge current detected (${data.current}A) but charge MOS is OFF - possible data inconsistency`,
                false // Not critical, could be transient state
            );
        }
    }

    // 7. Power and Current Consistency Check
    // Power should be approximately current * voltage
    if (data.power !== null && data.current !== null && data.overallVoltage !== null) {
        const expectedPower = data.current * data.overallVoltage;
        const powerDiff = Math.abs(data.power - expectedPower);
        const POWER_TOLERANCE_PERCENT = 10; // 10% tolerance
        const powerTolerance = Math.abs(expectedPower) * (POWER_TOLERANCE_PERCENT / 100);
        
        if (powerDiff > powerTolerance && Math.abs(expectedPower) > 10) { // Only check if power > 10W
            addWarning(
                `Power inconsistency: Reported ${data.power}W vs calculated ${expectedPower.toFixed(1)}W (${powerDiff.toFixed(1)}W difference)`,
                powerDiff > Math.abs(expectedPower) * 0.5 // Critical if diff > 50%
            );
        }
    }

    // 8. Capacity Consistency Check
    // Remaining capacity should not exceed full capacity
    if (data.remainingCapacity !== null && data.fullCapacity !== null && 
        data.remainingCapacity > 0 && data.fullCapacity > 0) {
        if (data.remainingCapacity > data.fullCapacity * 1.05) { // Allow 5% tolerance
            addWarning(
                `Remaining capacity (${data.remainingCapacity}Ah) exceeds full capacity (${data.fullCapacity}Ah)`,
                true
            );
        }
    }

    // 9. SOC and Capacity Consistency Check
    // If we have both SOC and capacities, they should be consistent
    if (data.stateOfCharge !== null && data.remainingCapacity !== null && 
        data.fullCapacity !== null && data.fullCapacity > 0) {
        const calculatedSOC = (data.remainingCapacity / data.fullCapacity) * 100;
        const socDiff = Math.abs(data.stateOfCharge - calculatedSOC);
        
        if (socDiff > 10) { // More than 10% difference is suspicious
            addWarning(
                `SOC inconsistency: Reported ${data.stateOfCharge}% vs calculated ${calculatedSOC.toFixed(1)}% (${socDiff.toFixed(1)}% difference)`,
                socDiff >= 25 // Critical if diff >= 25%
            );
        }
    }

    // 10. Cell Voltage Statistics Consistency
    if (data.cellVoltages && data.cellVoltages.length > 0) {
        const actualHighest = Math.max(...data.cellVoltages);
        const actualLowest = Math.min(...data.cellVoltages);
        const actualAverage = data.cellVoltages.reduce((sum, v) => sum + v, 0) / data.cellVoltages.length;
        const actualDifference = actualHighest - actualLowest;

        // Check highest cell voltage
        if (data.highestCellVoltage !== null && data.highestCellVoltage !== undefined) {
            if (Math.abs(data.highestCellVoltage - actualHighest) > 0.01) {
                addWarning(
                    `Highest cell voltage mismatch: Reported ${data.highestCellVoltage}V vs actual ${actualHighest}V`,
                    false
                );
            }
        }

        // Check lowest cell voltage
        if (data.lowestCellVoltage !== null && data.lowestCellVoltage !== undefined) {
            if (Math.abs(data.lowestCellVoltage - actualLowest) > 0.01) {
                addWarning(
                    `Lowest cell voltage mismatch: Reported ${data.lowestCellVoltage}V vs actual ${actualLowest}V`,
                    false
                );
            }
        }

        // Check average cell voltage
        if (data.averageCellVoltage !== null && data.averageCellVoltage !== undefined) {
            if (Math.abs(data.averageCellVoltage - actualAverage) > 0.01) {
                addWarning(
                    `Average cell voltage mismatch: Reported ${data.averageCellVoltage}V vs actual ${actualAverage.toFixed(3)}V`,
                    false
                );
            }
        }

        // Check cell voltage difference
        if (data.cellVoltageDifference !== null && data.cellVoltageDifference !== undefined) {
            if (Math.abs(data.cellVoltageDifference - actualDifference) > 0.01) {
                addWarning(
                    `Cell voltage difference mismatch: Reported ${data.cellVoltageDifference}V vs actual ${actualDifference.toFixed(3)}V`,
                    false
                );
            }
        }
    }

    if (log) {
        log('info', 'Data validation complete.', {
            isValid,
            warningCount: warnings.length,
            flagCount: flags.length
        });
    }

    return {
        isValid,
        warnings,
        flags
    };
}

module.exports = {
    validateAnalysisData
};
