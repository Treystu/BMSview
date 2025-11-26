// @ts-nocheck
/**
 * Statistical Analysis Tools Suite
 * Provides comprehensive statistical and analytical functions for battery data
 */

const { createLogger } = require('./logger.cjs');

/**
 * Run basic statistical analysis on numeric data
 */
async function runStatisticalAnalysis(data) {
  const log = createLogger('statistical-tools:analysis');
  
  if (!data || data.length === 0) {
    log.warn('No data provided for statistical analysis');
    return null;
  }
  
  try {
    // Filter out null/undefined values
    const validData = data.filter(v => v != null && !isNaN(v));
    
    if (validData.length === 0) {
      return null;
    }
    
    const sorted = [...validData].sort((a, b) => a - b);
    const sum = validData.reduce((acc, val) => acc + val, 0);
    const mean = sum / validData.length;
    
    // Calculate variance and standard deviation
    const variance = validData.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / validData.length;
    const stdDev = Math.sqrt(variance);
    
    // Calculate percentiles
    const getPercentile = (p) => {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };
    
    return {
      descriptive: {
        mean: Math.round(mean * 1000) / 1000,
        median: sorted[Math.floor(sorted.length / 2)],
        standardDeviation: Math.round(stdDev * 1000) / 1000,
        variance: Math.round(variance * 1000) / 1000,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        range: sorted[sorted.length - 1] - sorted[0],
        count: validData.length
      },
      percentiles: {
        p5: getPercentile(5),
        p25: getPercentile(25),
        p50: getPercentile(50),
        p75: getPercentile(75),
        p95: getPercentile(95),
        p99: getPercentile(99)
      },
      outliers: detectOutliers(validData, mean, stdDev)
    };
  } catch (error) {
    log.error('Statistical analysis failed', { error: error.message });
    return null;
  }
}

/**
 * Detect outliers using IQR method
 */
function detectOutliers(data, mean, stdDev) {
  const outliers = [];
  const threshold = 2 * stdDev; // 2 standard deviations
  
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i] - mean) > threshold) {
      outliers.push({
        index: i,
        value: data[i],
        deviationFromMean: Math.abs(data[i] - mean)
      });
    }
  }
  
  return {
    count: outliers.length,
    percentage: (outliers.length / data.length) * 100,
    values: outliers.slice(0, 10) // Limit to first 10 outliers
  };
}

/**
 * Run trend analysis on time series data
 */
async function runTrendAnalysis(timeSeries) {
  const log = createLogger('statistical-tools:trend');
  
  if (!timeSeries || timeSeries.length < 2) {
    log.warn('Insufficient data for trend analysis');
    return null;
  }
  
  try {
    // Convert timestamps to numeric values (hours since first point)
    const startTime = new Date(timeSeries[0].timestamp).getTime();
    const points = timeSeries.map(point => ({
      x: (new Date(point.timestamp).getTime() - startTime) / (1000 * 60 * 60), // hours
      y: point.value
    })).filter(p => p.y != null && !isNaN(p.y));
    
    if (points.length < 2) {
      return null;
    }
    
    // Calculate linear regression
    const n = points.length;
    const sumX = points.reduce((acc, p) => acc + p.x, 0);
    const sumY = points.reduce((acc, p) => acc + p.y, 0);
    const sumXY = points.reduce((acc, p) => acc + p.x * p.y, 0);
    const sumX2 = points.reduce((acc, p) => acc + p.x * p.x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Calculate R-squared
    const yMean = sumY / n;
    const ssTotal = points.reduce((acc, p) => acc + Math.pow(p.y - yMean, 2), 0);
    const ssResidual = points.reduce((acc, p) => {
      const predicted = slope * p.x + intercept;
      return acc + Math.pow(p.y - predicted, 2);
    }, 0);
    const rSquared = 1 - (ssResidual / ssTotal);
    
    return {
      trend: slope > 0.001 ? 'increasing' : slope < -0.001 ? 'decreasing' : 'stable',
      slope: Math.round(slope * 10000) / 10000,
      intercept: Math.round(intercept * 100) / 100,
      rSquared: Math.round(rSquared * 1000) / 1000,
      confidence: rSquared > 0.7 ? 'high' : rSquared > 0.4 ? 'medium' : 'low',
      changePoints: detectChangePoints(points)
    };
  } catch (error) {
    log.error('Trend analysis failed', { error: error.message });
    return null;
  }
}

/**
 * Detect change points in time series
 */
function detectChangePoints(points) {
  const changePoints = [];
  const windowSize = Math.max(5, Math.floor(points.length / 10));
  
  for (let i = windowSize; i < points.length - windowSize; i++) {
    const beforeWindow = points.slice(i - windowSize, i);
    const afterWindow = points.slice(i, i + windowSize);
    
    const beforeMean = beforeWindow.reduce((acc, p) => acc + p.y, 0) / beforeWindow.length;
    const afterMean = afterWindow.reduce((acc, p) => acc + p.y, 0) / afterWindow.length;
    
    const change = Math.abs(afterMean - beforeMean);
    const threshold = 5; // Configurable threshold
    
    if (change > threshold) {
      changePoints.push({
        index: i,
        timestamp: points[i].x,
        changeMagnitude: Math.round(change * 100) / 100,
        beforeMean: Math.round(beforeMean * 100) / 100,
        afterMean: Math.round(afterMean * 100) / 100
      });
    }
  }
  
  return changePoints.slice(0, 5); // Return top 5 change points
}

/**
 * Run anomaly detection
 */
async function runAnomalyDetection(data) {
  const log = createLogger('statistical-tools:anomaly');
  
  if (!data || data.length === 0) {
    log.warn('No data provided for anomaly detection');
    return null;
  }
  
  try {
    const validData = data.filter(v => v != null && !isNaN(v));
    
    if (validData.length === 0) {
      return null;
    }
    
    // Calculate mean and standard deviation
    const mean = validData.reduce((acc, val) => acc + val, 0) / validData.length;
    const variance = validData.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / validData.length;
    const stdDev = Math.sqrt(variance);
    
    // Detect anomalies (values beyond 3 standard deviations)
    const anomalies = [];
    const threshold = 3 * stdDev;
    
    for (let i = 0; i < validData.length; i++) {
      const deviation = Math.abs(validData[i] - mean);
      if (deviation > threshold) {
        anomalies.push({
          index: i,
          value: validData[i],
          anomalyScore: deviation / stdDev,
          isAnomaly: true
        });
      }
    }
    
    return {
      anomalies: anomalies.slice(0, 20), // Limit to 20 most significant
      anomalyRate: (anomalies.length / validData.length) * 100,
      totalAnomalies: anomalies.length,
      threshold,
      mean,
      stdDev
    };
  } catch (error) {
    log.error('Anomaly detection failed', { error: error.message });
    return null;
  }
}

/**
 * Run correlation analysis on multivariate data
 */
async function runCorrelationAnalysis(multiVariateData) {
  const log = createLogger('statistical-tools:correlation');
  
  try {
    const variables = Object.keys(multiVariateData);
    
    if (variables.length < 2) {
      log.warn('Need at least 2 variables for correlation analysis');
      return null;
    }
    
    // Build correlation matrix
    const correlationMatrix = {};
    const strongCorrelations = [];
    
    for (let i = 0; i < variables.length; i++) {
      correlationMatrix[variables[i]] = {};
      
      for (let j = 0; j < variables.length; j++) {
        const correlation = calculateCorrelation(
          multiVariateData[variables[i]],
          multiVariateData[variables[j]]
        );
        
        correlationMatrix[variables[i]][variables[j]] = correlation;
        
        // Track strong correlations (excluding self-correlation)
        if (i !== j && Math.abs(correlation) > 0.7) {
          strongCorrelations.push({
            var1: variables[i],
            var2: variables[j],
            correlation: Math.round(correlation * 1000) / 1000,
            strength: Math.abs(correlation) > 0.9 ? 'very strong' : 'strong',
            direction: correlation > 0 ? 'positive' : 'negative'
          });
        }
      }
    }
    
    return {
      matrix: correlationMatrix,
      strongCorrelations,
      totalPairs: (variables.length * (variables.length - 1)) / 2
    };
  } catch (error) {
    log.error('Correlation analysis failed', { error: error.message });
    return null;
  }
}

/**
 * Calculate Pearson correlation coefficient
 */
function calculateCorrelation(x, y) {
  // Filter to ensure equal length and valid values
  const pairs = [];
  const minLength = Math.min(x.length, y.length);
  
  for (let i = 0; i < minLength; i++) {
    if (x[i] != null && y[i] != null && !isNaN(x[i]) && !isNaN(y[i])) {
      pairs.push({ x: x[i], y: y[i] });
    }
  }
  
  if (pairs.length < 2) {
    return 0;
  }
  
  const n = pairs.length;
  const sumX = pairs.reduce((acc, p) => acc + p.x, 0);
  const sumY = pairs.reduce((acc, p) => acc + p.y, 0);
  const sumXY = pairs.reduce((acc, p) => acc + p.x * p.y, 0);
  const sumX2 = pairs.reduce((acc, p) => acc + p.x * p.x, 0);
  const sumY2 = pairs.reduce((acc, p) => acc + p.y * p.y, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  if (denominator === 0) {
    return 0;
  }
  
  return numerator / denominator;
}

module.exports = {
  runStatisticalAnalysis,
  runTrendAnalysis,
  runAnomalyDetection,
  runCorrelationAnalysis
};
