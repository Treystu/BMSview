import type { ReactNode } from 'react';
import type { AnalysisRecord } from '../../types';

// Helper function to safely access nested properties
export const getNestedValue = (obj: unknown, path: string): unknown => {
    if (!path || obj == null) return obj;
    return path.split('.').reduce((acc: unknown, part) => {
        if (acc && typeof acc === 'object' && part in acc) {
            return (acc as Record<string, unknown>)[part];
        }
        return undefined;
    }, obj);
};

// Type definition for a single column
export interface ColumnDefinition {
    label: string;
    group: 'General' | 'Core Vitals' | 'Capacity & Cycles' | 'System Status' | 'Temperatures' | 'Cell Health' | 'Device Details' | 'Insights' | 'Weather';
    sortable: boolean;
    unit?: string;
    format?: (value: unknown, record?: AnalysisRecord) => ReactNode;
}

// Define all possible columns
export const ALL_HISTORY_COLUMNS: Record<string, ColumnDefinition> = {
    // General
    'timestamp': {
        label: 'Timestamp',
        group: 'General',
        sortable: true,
        format: (val: unknown): ReactNode => {
            if (typeof val !== 'string' || !val) return 'N/A';
            const date = new Date(val);
            const options: Intl.DateTimeFormatOptions = {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: false, // Use 24-hour format for clarity
                timeZone: 'UTC',
            };
            return `${date.toLocaleString('en-US', options)} UTC`;
        }
    },
    'systemName': {
        label: 'System Name', group: 'General', sortable: true, format: (val) => {
            if (typeof val === 'string' && val.trim().length > 0) return val;
            return 'Unlinked';
        }
    },
    'fileName': { label: 'File Name', group: 'General', sortable: true, format: (val) => typeof val === 'string' ? val.split(/[/\\]/).pop() : 'N/A' },
    'hardwareSystemId': {
        label: 'Hardware ID',
        group: 'General',
        sortable: true,
        format: (val, record) => {
            // Robust fallback for Hardware ID
            // Unified access per DATA_MODEL.md: Check root hardwareSystemId first
            if (record?.hardwareSystemId) return record.hardwareSystemId;
            if (typeof val === 'string' && val) return val; // If accessed via key path
            if (record?.dlNumber) return record.dlNumber;
            // Legacy/Nested fallbacks
            if (record?.analysis?.hardwareSystemId) return record.analysis.hardwareSystemId;
            if (record?.analysis?.dlNumber) return record.analysis.dlNumber;
            return 'N/A';
        }
    },

    // Core Vitals
    'analysis.overallVoltage': { label: 'Voltage', unit: 'V', group: 'Core Vitals', sortable: true, format: (val) => typeof val === 'number' ? val.toFixed(1) : 'N/A' },
    'analysis.current': { label: 'Current', unit: 'A', group: 'Core Vitals', sortable: true, format: (val) => typeof val === 'number' ? val.toFixed(1) : 'N/A' },
    'analysis.power': { label: 'Power', unit: 'W', group: 'Core Vitals', sortable: true, format: (val) => typeof val === 'number' ? val.toFixed(0) : 'N/A' },
    'analysis.stateOfCharge': { label: 'SOC', unit: '%', group: 'Core Vitals', sortable: true, format: (val) => typeof val === 'number' ? val.toFixed(1) : 'N/A' },

    // Capacity & Cycles
    'analysis.remainingCapacity': { label: 'Remaining Cap.', unit: 'Ah', group: 'Capacity & Cycles', sortable: true, format: (val) => typeof val === 'number' ? val.toFixed(1) : 'N/A' },
    'analysis.fullCapacity': { label: 'Full Cap.', unit: 'Ah', group: 'Capacity & Cycles', sortable: true, format: (val) => typeof val === 'number' ? val.toFixed(1) : 'N/A' },
    'analysis.cycleCount': { label: 'Cycles', group: 'Capacity & Cycles', sortable: true },

    // System Status
    'analysis.status': { label: 'Status', group: 'System Status', sortable: true },
    'analysis.chargeMosOn': { label: 'Charge MOS', group: 'System Status', sortable: true, format: (val) => val === null || val === undefined ? 'N/A' : (val ? 'ON' : 'OFF') },
    'analysis.dischargeMosOn': { label: 'Discharge MOS', group: 'System Status', sortable: true, format: (val) => val === null || val === undefined ? 'N/A' : (val ? 'ON' : 'OFF') },
    'analysis.balanceOn': { label: 'Balancing', group: 'System Status', sortable: true, format: (val) => val === null || val === undefined ? 'N/A' : (val ? 'ON' : 'OFF') },

    // Temperatures
    'analysis.temperature': { label: 'Batt Temp', unit: '°C', group: 'Temperatures', sortable: true, format: (val) => typeof val === 'number' ? val.toFixed(1) : 'N/A' },
    'analysis.mosTemperature': { label: 'MOS Temp', unit: '°C', group: 'Temperatures', sortable: true, format: (val) => typeof val === 'number' ? val.toFixed(1) : 'N/A' },
    'analysis.numTempSensors': { label: 'Temp Sensors', group: 'Temperatures', sortable: true },

    // Cell Health
    'analysis.highestCellVoltage': { label: 'Highest Cell', unit: 'V', group: 'Cell Health', sortable: true, format: (val) => typeof val === 'number' ? val.toFixed(3) : 'N/A' },
    'analysis.lowestCellVoltage': { label: 'Lowest Cell', unit: 'V', group: 'Cell Health', sortable: true, format: (val) => typeof val === 'number' ? val.toFixed(3) : 'N/A' },
    'analysis.cellVoltageDifference': { label: 'Cell Diff.', unit: 'mV', group: 'Cell Health', sortable: true, format: (val) => typeof val === 'number' ? (val * 1000).toFixed(1) : 'N/A' },
    'analysis.averageCellVoltage': { label: 'Average Cell', unit: 'V', group: 'Cell Health', sortable: true, format: (val) => typeof val === 'number' ? val.toFixed(3) : 'N/A' },

    // Device Details
    'analysis.serialNumber': { label: 'Serial Number', group: 'Device Details', sortable: true },
    'analysis.softwareVersion': { label: 'SW Version', group: 'Device Details', sortable: true },
    'analysis.hardwareVersion': { label: 'HW Version', group: 'Device Details', sortable: true },
    'analysis.snCode': { label: 'SN Code', group: 'Device Details', sortable: true },

    // Insights
    'analysis.runtimeEstimateMiddleHours': { label: 'Est. Runtime', unit: 'hrs', group: 'Insights', sortable: true, format: (val) => typeof val === 'number' ? val.toFixed(1) : 'N/A' },
    'analysis.generatorRecommendation.run': { label: 'Gen Reco.', group: 'Insights', sortable: true, format: (val) => val === null || val === undefined ? 'N/A' : (val ? 'RUN' : 'NO') },

    // Weather
    'weather.temp': { label: 'Air Temp', unit: '°C', group: 'Weather', sortable: true, format: (val) => typeof val === 'number' ? val.toFixed(1) : 'N/A' },
    'weather.clouds': { label: 'Clouds', unit: '%', group: 'Weather', sortable: true },
    'weather.uvi': { label: 'UV Index', group: 'Weather', sortable: true },
    'weather.weather_main': { label: 'Weather', group: 'Weather', sortable: true },
};

export type HistoryColumnKey = keyof typeof ALL_HISTORY_COLUMNS;

export const DEFAULT_VISIBLE_COLUMNS: HistoryColumnKey[] = [
    'timestamp',
    'systemName',
    'hardwareSystemId',
    'analysis.overallVoltage',
    'analysis.current',
    'analysis.stateOfCharge',
    'analysis.cellVoltageDifference',
];