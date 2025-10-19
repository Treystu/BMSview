import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { BmsSystem, AnalysisRecord, AnalysisData, WeatherData } from '../types';
import { getSystemAnalytics } from '../services/clientService'; // This service is now used directly here
import SpinnerIcon from './icons/SpinnerIcon';
import AlertAnalysis from './admin/AlertAnalysis';

// NOTE: All the chart logic (METRICS, mapRecordToPoint, SvgChart, etc.) remains unchanged.
// The only change is how the data is passed into the main HistoricalChart component.
// For brevity, those unchanged parts are omitted, but they exist in the original file.

type MetricKey = 'stateOfCharge' | 'overallVoltage' | 'current' | 'temperature' | 'power' | 'cellVoltageDifference' | 'clouds' | 'uvi' | 'temp' | 'soh' | 'mosTemperature';
type Axis = 'left' | 'right';
type ChartView = 'timeline' | 'hourly';

const METRICS: Record<MetricKey, { 
    label: string; 
    unit: string; 
    color: string; 
    multiplier?: number; 
    source: 'analysis' | 'weather'; 
    group: 'Battery' | 'Weather' | 'Health';
    anomaly?: (value: number) => { type: 'critical' | 'warning', message: string } | null;
}> = {
  stateOfCharge: { label: 'SOC', unit: '%', color: '#34d399', source: 'analysis', group: 'Battery', anomaly: (val) => val < 20 ? { type: 'warning', message: `Warning: SOC is low (${val.toFixed(1)}%)` } : null },
  overallVoltage: { label: 'Voltage', unit: 'V', color: '#fbbf24', source: 'analysis', group: 'Battery' },
  current: { label: 'Current', unit: 'A', color: '#60a5fa', source: 'analysis', group: 'Battery' },
  power: { label: 'Power', unit: 'W', color: '#c084fc', source: 'analysis', group: 'Battery' },
  temperature: { label: 'Batt Temp', unit: '°C', color: '#f87171', source: 'analysis', group: 'Battery', anomaly: (val) => val > 45 ? { type: 'critical', message: `CRITICAL: Battery temp is high (${val.toFixed(1)}°C)` } : null },
  mosTemperature: { label: 'MOS Temp', unit: '°C', color: '#fca5a5', source: 'analysis', group: 'Battery', anomaly: (val) => val > 80 ? { type: 'critical', message: `CRITICAL: MOS temp is high (${val.toFixed(1)}°C)` } : null },
  cellVoltageDifference: { label: 'Cell Diff', unit: 'mV', color: '#a3a3a3', multiplier: 1000, source: 'analysis', group: 'Battery', anomaly: (val) => val > 0.1 ? { type: 'critical', message: `CRITICAL: Cell difference is high (${(val * 1000).toFixed(0)}mV)` } : null },
  clouds: { label: 'Clouds', unit: '%', color: '#94a3b8', source: 'weather', group: 'Weather' },
  uvi: { label: 'UV Index', unit: '', color: '#fde047', source: 'weather', group: 'Weather' },
  temp: { label: 'Air Temp', unit: '°C', color: '#a78bfa', source: 'weather', group: 'Weather' },
  soh: { label: 'SOH', unit: '%', color: '#ec4899', source: 'analysis', group: 'Health', anomaly: (val) => val < 80 ? { type: 'critical', message: `CRITICAL: State of Health is low (${val.toFixed(1)}%)` } : null },
};
// ... SvgChart, ChartControls, etc. would be here ...

const HistoricalChart: React.FC<{ systems: BmsSystem[], history: AnalysisRecord[] }> = ({ systems, history }) => {
    const [selectedSystemId, setSelectedSystemId] = useState<string>('');
    const [metricConfig, setMetricConfig] = useState<Partial<Record<MetricKey, { axis: Axis }>>>({ stateOfCharge: { axis: 'left' }, current: { axis: 'right' } });
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [timelineData, setTimelineData] = useState<any | null>(null);
    const [analyticsData, setAnalyticsData] = useState<any | null>(null); // Using `any` for simplicity from original file
    const [chartView, setChartView] = useState<ChartView>('timeline');
    const [hourlyMetric, setHourlyMetric] = useState<MetricKey>('power');
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    // ... other state like zoom, averaging, etc. remains the same

    const prepareChartData = useCallback(async () => {
        if (!selectedSystemId) return;
        setIsGenerating(true);
        setError(null);
        setTimelineData(null);
        setAnalyticsData(null);

        try {
            // Fetch analytics on-demand when the user clicks generate
            const analytics = await getSystemAnalytics(selectedSystemId);
            setAnalyticsData(analytics);

            const system = systems.find(s => s.id === selectedSystemId);
            const ratedCapacity = system?.capacity;
            
            // The `history` prop is now the complete cache from the parent
            const systemHistory = history.filter(r => r.systemId === selectedSystemId).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            
            // The rest of the data preparation logic remains the same
            const historyWithSoh = systemHistory.map(r => {
                let soh = null;
                if (ratedCapacity && ratedCapacity > 0 && r.analysis?.fullCapacity && r.analysis.fullCapacity > 0) {
                    soh = (r.analysis.fullCapacity / ratedCapacity) * 100;
                }
                return {
                    ...r,
                    analysis: { ...r.analysis, soh } as AnalysisData & { soh: number | null },
                };
            });

            const filteredHistory = historyWithSoh.filter(r => (!startDate || new Date(r.timestamp) >= new Date(startDate)) && (!endDate || new Date(r.timestamp) <= new Date(endDate)));

            if (filteredHistory.length < 2) {
                setTimelineData(null);
            } else {
                // ... This data aggregation and scaling logic is unchanged
                const dataLODs: Record<string, any[]> = { /* ... */ };
                const xMin = new Date(filteredHistory[0].timestamp).getTime();
                const xMax = new Date(filteredHistory[filteredHistory.length - 1].timestamp).getTime();
                // ...
                setTimelineData({ 
                    /* ... */
                });
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to generate chart data.");
        } finally {
            setIsGenerating(false);
        }
    }, [selectedSystemId, history, systems, startDate, endDate]);
    
    // The rest of the component (return statement with ChartControls, SvgChart, etc.) remains the same
    return (
        <div>
           {/* ChartControls and Chart display logic is unchanged */}
        </div>
    );
};

export default HistoricalChart;
