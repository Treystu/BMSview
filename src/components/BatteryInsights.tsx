import React, { useState, useEffect } from 'react';

interface BatteryData {
  measurements: Array<{
    timestamp: string;
    voltage: number;
    current: number;
    temperature: number;
    capacity: number;
    soc: number; // State of Charge
    energyIn?: number;
    energyOut?: number;
    state: 'charging' | 'discharging' | 'idle';
  }>;
  metadata?: {
    batteryType: string;
    nominalCapacity: number;
    manufactureDate?: string;
  };
}

interface HealthInsight {
  status: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Critical';
  score: number;
  recommendation: string;
  estimatedLifespan: string;
  efficiency: number;
  cycleCount: number;
  degradationRate: number;
}

interface PredictiveInsight {
  failureRisk: 'Low' | 'Medium' | 'High' | 'Critical';
  nextMaintenance: string;
  componentRisks: Array<{
    component: string;
    risk: 'Low' | 'Medium' | 'High';
    recommendation: string;
  }>;
  performanceForecast: {
    week: number;
    capacityPrediction: number;
    efficiencyPrediction: number;
  }[];
}

interface BatteryInsightsProps {
  batteryData: BatteryData;
  onRefresh?: () => void;
}

const BatteryInsights: React.FC<BatteryInsightsProps> = ({ batteryData, onRefresh }) => {
  const [insights, setInsights] = useState<HealthInsight | null>(null);
  const [predictions, setPredictions] = useState<PredictiveInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (batteryData) {
      generateInsights();
    }
  }, [batteryData]);

  const generateInsights = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Generate health insights
      const healthInsight = getHealthInsights(batteryData);
      setInsights(healthInsight);

      // Generate predictive insights
      const predictiveInsight = getPredictiveInsights(batteryData);
      setPredictions(predictiveInsight);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate insights');
      console.error('Error generating insights:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="battery-insights" style={{ padding: '20px', textAlign: 'center' }}>
        <div>Analyzing battery data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="battery-insights" style={{ padding: '20px' }}>
        <div style={{
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#dc2626',
          padding: '12px',
          borderRadius: '4px',
          marginBottom: '16px'
        }}>
          Error: {error}
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Excellent': return '#10b981';
      case 'Good': return '#3b82f6';
      case 'Fair': return '#f59e0b';
      case 'Poor': return '#ef4444';
      case 'Critical': return '#991b1b';
      default: return '#6b7280';
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'Low': return '#10b981';
      case 'Medium': return '#f59e0b';
      case 'High': return '#ef4444';
      case 'Critical': return '#991b1b';
      default: return '#6b7280';
    }
  };

  return (
    <div className="battery-insights" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, color: '#1f2937' }}>Battery Insights</h2>
        <button
          onClick={onRefresh || generateInsights}
          style={{
            padding: '8px 16px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Refresh Insights
        </button>
      </div>

      {/* Health Status Card */}
      {insights && (
        <div style={{
          backgroundColor: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
        }}>
          <h3 style={{ margin: '0 0 16px 0', color: '#1f2937' }}>Health Status</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>Overall Status</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: getStatusColor(insights.status)
                }} />
                <span style={{ 
                  fontSize: '18px', 
                  fontWeight: 'bold',
                  color: getStatusColor(insights.status)
                }}>
                  {insights.status}
                </span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>Health Score</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1f2937' }}>
                {insights.score}/100
              </div>
            </div>

            <div>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>Efficiency</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1f2937' }}>
                {(insights.efficiency * 100).toFixed(1)}%
              </div>
            </div>

            <div>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>Cycle Count</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1f2937' }}>
                {insights.cycleCount.toLocaleString()}
              </div>
            </div>
          </div>

          <div style={{ marginTop: '20px', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '6px' }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1f2937', marginBottom: '8px' }}>
              Recommendation
            </div>
            <div style={{ fontSize: '14px', color: '#4b5563', lineHeight: '1.5' }}>
              {insights.recommendation}
            </div>
          </div>

          <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>Estimated Lifespan</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1f2937' }}>
                {insights.estimatedLifespan}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>Degradation Rate</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1f2937' }}>
                {insights.degradationRate.toFixed(3)}%/cycle
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Predictive Insights Card */}
      {predictions && (
        <div style={{
          backgroundColor: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
        }}>
          <h3 style={{ margin: '0 0 16px 0', color: '#1f2937' }}>Predictive Insights</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>Failure Risk</div>
              <div style={{ 
                fontSize: '18px', 
                fontWeight: 'bold',
                color: getRiskColor(predictions.failureRisk)
              }}>
                {predictions.failureRisk}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>Next Maintenance</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1f2937' }}>
                {predictions.nextMaintenance}
              </div>
            </div>
          </div>

          {/* Component Risks */}
          {predictions.componentRisks.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ margin: '0 0 12px 0', color: '#1f2937', fontSize: '16px' }}>
                Component Risk Assessment
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {predictions.componentRisks.map((risk, index) => (
                  <div key={index} style={{
                    padding: '12px',
                    backgroundColor: '#f9fafb',
                    borderRadius: '4px',
                    borderLeft: `4px solid ${getRiskColor(risk.risk)}`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 'bold', color: '#1f2937' }}>{risk.component}</span>
                      <span style={{
                        fontSize: '12px',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        backgroundColor: getRiskColor(risk.risk),
                        color: 'white',
                        fontWeight: 'bold'
                      }}>
                        {risk.risk}
                      </span>
                    </div>
                    <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px' }}>
                      {risk.recommendation}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Performance Forecast */}
          {predictions.performanceForecast.length > 0 && (
            <div>
              <h4 style={{ margin: '0 0 12px 0', color: '#1f2937', fontSize: '16px' }}>
                4-Week Performance Forecast
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
                {predictions.performanceForecast.map((forecast, index) => (
                  <div key={index} style={{
                    padding: '12px',
                    backgroundColor: '#f9fafb',
                    borderRadius: '4px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                      Week {forecast.week}
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1f2937' }}>
                      {forecast.capacityPrediction.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      {(forecast.efficiencyPrediction * 100).toFixed(1)}% eff
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Utility functions for generating insights
function getHealthInsights(batteryData: BatteryData): HealthInsight {
  const measurements = batteryData.measurements || [];
  
  if (measurements.length === 0) {
    return {
      status: 'Unknown',
      score: 0,
      recommendation: 'No data available for analysis',
      estimatedLifespan: 'Unknown',
      efficiency: 0,
      cycleCount: 0,
      degradationRate: 0
    };
  }

  const latest = measurements[measurements.length - 1];
  const earliest = measurements[0];

  // Calculate capacity trend
  const capacityTrend = latest.capacity / earliest.capacity;
  
  // Count charge cycles
  const cycles = countChargeCycles(measurements);
  
  // Calculate efficiency
  const efficiency = calculateEfficiency(measurements);
  
  // Calculate degradation rate
  const degradationRate = calculateDegradationRate(measurements);

  // Determine health status
  let status: HealthInsight['status'];
  let score: number;
  let recommendation: string;

  if (capacityTrend > 0.95 && efficiency > 0.9) {
    status = 'Excellent';
    score = 90 + Math.round(Math.random() * 10);
    recommendation = 'Battery is in excellent condition. Continue normal operation and regular maintenance.';
  } else if (capacityTrend > 0.85 && efficiency > 0.8) {
    status = 'Good';
    score = 70 + Math.round(Math.random() * 20);
    recommendation = 'Battery health is good. Monitor performance monthly and maintain optimal charging practices.';
  } else if (capacityTrend > 0.70 && efficiency > 0.7) {
    status = 'Fair';
    score = 50 + Math.round(Math.random() * 20);
    recommendation = 'Battery showing signs of aging. Consider capacity calibration and more frequent monitoring.';
  } else if (capacityTrend > 0.50) {
    status = 'Poor';
    score = 25 + Math.round(Math.random() * 25);
    recommendation = 'Battery health is declining. Schedule professional inspection and consider replacement planning.';
  } else {
    status = 'Critical';
    score = Math.round(Math.random() * 25);
    recommendation = 'Battery health is critical. Immediate replacement recommended to prevent system failure.';
  }

  // Calculate estimated lifespan
  const daysSinceFirstMeasurement = Math.floor(
    (new Date(latest.timestamp).getTime() - new Date(earliest.timestamp).getTime()) / (1000 * 60 * 60 * 24)
  );
  
  const cyclesPerDay = cycles / Math.max(daysSinceFirstMeasurement, 1);
  const estimatedDaysRemaining = Math.max(0, Math.round(1000 / cyclesPerDay));
  
  const estimatedLifespan = estimatedDaysRemaining > 365 
    ? `${Math.round(estimatedDaysRemaining / 365)} years`
    : estimatedDaysRemaining > 30
    ? `${Math.round(estimatedDaysRemaining / 30)} months`
    : `${estimatedDaysRemaining} days`;

  return {
    status,
    score,
    recommendation,
    estimatedLifespan,
    efficiency,
    cycleCount: cycles,
    degradationRate
  };
}

function getPredictiveInsights(batteryData: BatteryData): PredictiveInsight {
  const measurements = batteryData.measurements || [];
  
  // Calculate failure risk based on current metrics
  const healthScore = calculateHealthScore(measurements);
  
  let failureRisk: PredictiveInsight['failureRisk'];
  if (healthScore > 80) failureRisk = 'Low';
  else if (healthScore > 60) failureRisk = 'Medium';
  else if (healthScore > 40) failureRisk = 'High';
  else failureRisk = 'Critical';

  // Calculate next maintenance
  const nextMaintenance = calculateNextMaintenance(measurements);

  // Identify component risks
  const componentRisks = identifyComponentRisks(measurements);

  // Generate performance forecast
  const performanceForecast = generatePerformanceForecast(measurements);

  return {
    failureRisk,
    nextMaintenance,
    componentRisks,
    performanceForecast
  };
}

function countChargeCycles(measurements: any[]): number {
  let cycles = 0;
  let wasCharging = false;
  
  for (const measurement of measurements) {
    if (measurement.state === 'charging' && !wasCharging) {
      cycles++;
    }
    wasCharging = measurement.state === 'charging';
  }
  
  return cycles;
}

function calculateEfficiency(measurements: any[]): number {
  let totalEnergyIn = 0;
  let totalEnergyOut = 0;
  
  for (const measurement of measurements) {
    if (measurement.energyIn) totalEnergyIn += measurement.energyIn;
    if (measurement.energyOut) totalEnergyOut += measurement.energyOut;
  }
  
  return totalEnergyIn > 0 ? totalEnergyOut / totalEnergyIn : 0.8;
}

function calculateDegradationRate(measurements: any[]): number {
  if (measurements.length < 2) return 0;
  
  const first = measurements[0];
  const last = measurements[measurements.length - 1];
  const cycles = countChargeCycles(measurements);
  
  const degradationPercent = ((first.capacity - last.capacity) / first.capacity) * 100;
  return cycles > 0 ? degradationPercent / cycles : 0;
}

function calculateHealthScore(measurements: any[]): number {
  if (measurements.length === 0) return 0;
  
  const latest = measurements[measurements.length - 1];
  const earliest = measurements[0];
  
  const capacityRetention = (latest.capacity / earliest.capacity) * 100;
  const efficiency = calculateEfficiency(measurements) * 100;
  
  return Math.round((capacityRetention + efficiency) / 2);
}

function calculateNextMaintenance(measurements: any[]): string {
  const healthScore = calculateHealthScore(measurements);
  
  if (healthScore > 80) return '6 months';
  if (healthScore > 60) return '3 months';
  if (healthScore > 40) return '1 month';
  return 'Immediate';
}

function identifyComponentRisks(measurements: any[]) {
  const risks = [];
  const latest = measurements[measurements.length - 1] || {};
  
  if (latest.temperature > 45) {
    risks.push({
      component: 'Thermal Management',
      risk: 'High' as const,
      recommendation: 'Check cooling system and ventilation'
    });
  }
  
  if (latest.voltage < latest.voltage * 0.9) {
    risks.push({
      component: 'Voltage Regulation',
      risk: 'Medium' as const,
      recommendation: 'Monitor voltage stability and check connections'
    });
  }
  
  if (countChargeCycles(measurements) > 500) {
    risks.push({
      component: 'Battery Cells',
      risk: 'Medium' as const,
      recommendation: 'Consider cell balancing and capacity test'
    });
  }
  
  return risks;
}

function generatePerformanceForecast(measurements: any[]) {
  const forecast = [];
  const latest = measurements[measurements.length - 1] || { capacity: 100, efficiency: 0.8 };
  
  for (let week = 1; week <= 4; week++) {
    const degradationFactor = 0.995; // 0.5% degradation per week
    forecast.push({
      week,
      capacityPrediction: latest.capacity * Math.pow(degradationFactor, week),
      efficiencyPrediction: latest.efficiency * Math.pow(degradationFactor, week * 0.5)
    });
  }
  
  return forecast;
}

export default BatteryInsights;