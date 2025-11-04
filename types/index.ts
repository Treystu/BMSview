// Global type definitions for BMSview

export interface BatteryMeasurement {
    timestamp: string;
    voltage: number | null;
    current: number | null;
    temperature: number | null;
    stateOfCharge: number | null;
    capacity: number | null;
}

export interface BatteryAnalysisRequest {
    systemId?: string;
    measurements: BatteryMeasurement[];
    metadata?: {
        source: string;
        timestamp: string;
        [key: string]: any;
    };
}

export interface BatteryPerformanceMetrics {
    trend: 'Improving' | 'Stable' | 'Declining' | 'Unknown';
    capacityRetention: number;
    degradationRate: number;
}

export interface BatteryEfficiencyMetrics {
    chargeEfficiency: number;
    dischargeEfficiency: number;
    cyclesAnalyzed: number;
}

export interface BatteryInsights {
    healthStatus: string;
    performance: BatteryPerformanceMetrics;
    recommendations: string[];
    estimatedLifespan: string;
    efficiency: BatteryEfficiencyMetrics;
    rawText: string;
}

export interface AnalysisResponse {
    success: boolean;
    insights: BatteryInsights;
    tokenUsage: {
        prompt: number;
        generated: number;
        total: number;
    };
    timestamp: string;
}

// Service response types
export interface ServiceResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    timestamp: string;
}

// State management types
export interface BatteryState {
    measurements: BatteryMeasurement[];
    lastUpdate: string;
    isAnalyzing: boolean;
    insights: BatteryInsights | null;
    error: string | null;
}

// Component prop types
export interface ChartProps {
    data: BatteryMeasurement[];
    type: 'voltage' | 'current' | 'temperature' | 'stateOfCharge';
    height?: number;
    width?: number;
}

export interface AnalysisResultProps {
    insights: BatteryInsights;
    onReanalyze?: () => void;
}

// Utility types
export type TimeRange = '1h' | '24h' | '7d' | '30d' | 'all';

export interface DataFilter {
    timeRange: TimeRange;
    metrics: Array<'voltage' | 'current' | 'temperature' | 'stateOfCharge'>;
    threshold?: number;
}

// API types
export interface APIResponse<T> {
    statusCode: number;
    body: string; // JSON string of ServiceResponse<T>
}