/**
 * Data Processing Web Worker
 * Handles CPU-intensive data processing tasks in the background
 */

interface WorkerMessage<T = any> {
  id: string;
  type: string;
  data: T;
}

interface WorkerResponse<T = any> {
  id: string;
  type: string;
  data?: T;
  error?: string;
}

// Worker message handler
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { id, type, data } = event.data;

  try {
    let result: any;

    switch (type) {
      case 'processChunk':
        result = processChunk(data);
        break;
      case 'sortArray':
        result = sortArray(data);
        break;
      case 'filterArray':
        result = filterArray(data);
        break;
      case 'mapArray':
        result = mapArray(data);
        break;
      case 'aggregateData':
        result = aggregateData(data);
        break;
      case 'calculateStatistics':
        result = calculateStatistics(data);
        break;
      case 'processAnalysisData':
        result = processAnalysisData(data);
        break;
      case 'compressData':
        result = compressData(data);
        break;
      case 'decompressData':
        result = decompressData(data);
        break;
      case 'validateDataSet':
        result = validateDataSet(data);
        break;
      default:
        throw new Error(`Unknown task type: ${type}`);
    }

    const response: WorkerResponse = {
      id,
      type,
      data: result,
    };

    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id,
      type,
      error: error instanceof Error ? error.message : String(error),
    };

    self.postMessage(response);
  }
};

// Task implementations
function processChunk(params: {
  chunk: any[];
  processor: string;
  chunkIndex: number;
}): any[] {
  const { chunk, processor, chunkIndex } = params;

  // Execute the processor function
  const processorFn = new Function('return ' + processor)();
  return processorFn(chunk, chunkIndex);
}

function sortArray(params: {
  data: any[];
  compareFn?: string;
  algorithm?: string;
}): any[] {
  const { data, compareFn, algorithm = 'quicksort' } = params;

  const compareFunction = compareFn
    ? new Function('return ' + compareFn)()
    : undefined;

  switch (algorithm) {
    case 'quicksort':
      return quickSort([...data], compareFunction);
    case 'mergesort':
      return mergeSort([...data], compareFunction);
    case 'heapsort':
      return heapSort([...data], compareFunction);
    default:
      return [...data].sort(compareFunction);
  }
}

function filterArray(params: {
  data: any[];
  filterFn: string;
}): any[] {
  const { data, filterFn } = params;
  const filter = new Function('return ' + filterFn)();
  return data.filter(filter);
}

function mapArray(params: {
  data: any[];
  mapFn: string;
}): any[] {
  const { data, mapFn } = params;
  const mapper = new Function('return ' + mapFn)();
  return data.map(mapper);
}

function aggregateData(params: {
  data: any[];
  groupBy: string;
  aggregations: Record<string, string>;
}): Record<string, any> {
  const { data, groupBy, aggregations } = params;

  const grouper = new Function('return ' + groupBy)();
  const groups: Record<string, any[]> = {};

  // Group data
  data.forEach(item => {
    const key = grouper(item);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
  });

  // Apply aggregations
  const result: Record<string, any> = {};
  Object.entries(groups).forEach(([key, items]) => {
    result[key] = {};
    Object.entries(aggregations).forEach(([field, aggFn]) => {
      const aggregator = new Function('return ' + aggFn)();
      result[key][field] = aggregator(items);
    });
  });

  return result;
}

function calculateStatistics(params: {
  data: number[];
  fields?: string[];
}): Record<string, number> {
  const { data, fields } = params;

  if (!Array.isArray(data) || data.length === 0) {
    return {};
  }

  const sorted = [...data].sort((a, b) => a - b);
  const len = data.length;
  const sum = data.reduce((acc, val) => acc + val, 0);
  const mean = sum / len;

  const variance = data.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / len;
  const stdDev = Math.sqrt(variance);

  const stats: Record<string, number> = {
    count: len,
    sum,
    mean,
    median: len % 2 === 0
      ? (sorted[len / 2 - 1] + sorted[len / 2]) / 2
      : sorted[Math.floor(len / 2)],
    mode: calculateMode(data),
    range: sorted[len - 1] - sorted[0],
    min: sorted[0],
    max: sorted[len - 1],
    q1: getPercentile(sorted, 25),
    q3: getPercentile(sorted, 75),
    variance,
    standardDeviation: stdDev,
    skewness: calculateSkewness(data, mean, stdDev),
    kurtosis: calculateKurtosis(data, mean, stdDev),
  };

  // Return only requested fields if specified
  if (fields) {
    const filteredStats: Record<string, number> = {};
    fields.forEach(field => {
      if (field in stats) {
        filteredStats[field] = stats[field];
      }
    });
    return filteredStats;
  }

  return stats;
}

function processAnalysisData(params: {
  records: any[];
  analysisType: string;
  options?: Record<string, any>;
}): any {
  const { records, analysisType, options = {} } = params;

  switch (analysisType) {
    case 'batteryTrends':
      return analyzeBatteryTrends(records, options);
    case 'performanceMetrics':
      return calculatePerformanceMetrics(records, options);
    case 'anomalyDetection':
      return detectAnomalies(records, options);
    case 'correlation':
      return calculateCorrelations(records, options);
    case 'timeSeriesAnalysis':
      return analyzeTimeSeries(records, options);
    default:
      throw new Error(`Unknown analysis type: ${analysisType}`);
  }
}

function compressData(params: {
  data: any;
  algorithm?: string;
}): string {
  const { data, algorithm = 'lz' } = params;
  const jsonString = JSON.stringify(data);

  switch (algorithm) {
    case 'lz':
      return lzCompress(jsonString);
    case 'rle':
      return runLengthEncode(jsonString);
    default:
      return jsonString;
  }
}

function decompressData(params: {
  compressedData: string;
  algorithm?: string;
}): any {
  const { compressedData, algorithm = 'lz' } = params;

  let decompressed: string;
  switch (algorithm) {
    case 'lz':
      decompressed = lzDecompress(compressedData);
      break;
    case 'rle':
      decompressed = runLengthDecode(compressedData);
      break;
    default:
      decompressed = compressedData;
  }

  return JSON.parse(decompressed);
}

function validateDataSet(params: {
  data: any[];
  schema: any;
  options?: Record<string, any>;
}): { valid: boolean; errors: string[]; warnings: string[] } {
  const { data, schema, options = {} } = params;
  const errors: string[] = [];
  const warnings: string[] = [];

  data.forEach((item, index) => {
    try {
      validateItem(item, schema, options);
    } catch (error) {
      errors.push(`Item ${index}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Add warnings for potential issues
  if (data.length === 0) {
    warnings.push('Dataset is empty');
  }

  if (data.length > 100000) {
    warnings.push('Large dataset detected - consider pagination');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Utility functions
function quickSort<T>(arr: T[], compareFn?: (a: T, b: T) => number): T[] {
  if (arr.length <= 1) return arr;

  const compare = compareFn || ((a, b) => a > b ? 1 : a < b ? -1 : 0);
  const pivot = arr[Math.floor(arr.length / 2)];
  const left = arr.filter(x => compare(x, pivot) < 0);
  const middle = arr.filter(x => compare(x, pivot) === 0);
  const right = arr.filter(x => compare(x, pivot) > 0);

  return [...quickSort(left, compare), ...middle, ...quickSort(right, compare)];
}

function mergeSort<T>(arr: T[], compareFn?: (a: T, b: T) => number): T[] {
  if (arr.length <= 1) return arr;

  const compare = compareFn || ((a, b) => a > b ? 1 : a < b ? -1 : 0);
  const middle = Math.floor(arr.length / 2);
  const left = arr.slice(0, middle);
  const right = arr.slice(middle);

  return merge(mergeSort(left, compare), mergeSort(right, compare), compare);
}

function merge<T>(left: T[], right: T[], compare: (a: T, b: T) => number): T[] {
  const result: T[] = [];
  let i = 0, j = 0;

  while (i < left.length && j < right.length) {
    if (compare(left[i], right[j]) <= 0) {
      result.push(left[i++]);
    } else {
      result.push(right[j++]);
    }
  }

  return result.concat(left.slice(i)).concat(right.slice(j));
}

function heapSort<T>(arr: T[], compareFn?: (a: T, b: T) => number): T[] {
  const compare = compareFn || ((a, b) => a > b ? 1 : a < b ? -1 : 0);
  const result = [...arr];

  // Build max heap
  for (let i = Math.floor(result.length / 2) - 1; i >= 0; i--) {
    heapify(result, result.length, i, compare);
  }

  // Extract elements from heap one by one
  for (let i = result.length - 1; i >= 0; i--) {
    [result[0], result[i]] = [result[i], result[0]];
    heapify(result, i, 0, compare);
  }

  return result;
}

function heapify<T>(arr: T[], n: number, i: number, compare: (a: T, b: T) => number): void {
  let largest = i;
  const left = 2 * i + 1;
  const right = 2 * i + 2;

  if (left < n && compare(arr[left], arr[largest]) > 0) {
    largest = left;
  }

  if (right < n && compare(arr[right], arr[largest]) > 0) {
    largest = right;
  }

  if (largest !== i) {
    [arr[i], arr[largest]] = [arr[largest], arr[i]];
    heapify(arr, n, largest, compare);
  }
}

function getPercentile(sortedData: number[], percentile: number): number {
  const index = (percentile / 100) * (sortedData.length - 1);
  if (Math.floor(index) === index) {
    return sortedData[index];
  } else {
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return sortedData[lower] + (index - lower) * (sortedData[upper] - sortedData[lower]);
  }
}

function calculateMode(data: number[]): number {
  const frequency: Record<number, number> = {};
  data.forEach(num => {
    frequency[num] = (frequency[num] || 0) + 1;
  });

  let maxCount = 0;
  let mode = data[0];
  Object.entries(frequency).forEach(([num, count]) => {
    if (count > maxCount) {
      maxCount = count;
      mode = Number(num);
    }
  });

  return mode;
}

function calculateSkewness(data: number[], mean: number, stdDev: number): number {
  const n = data.length;
  const sum = data.reduce((acc, val) => acc + Math.pow((val - mean) / stdDev, 3), 0);
  return (n / ((n - 1) * (n - 2))) * sum;
}

function calculateKurtosis(data: number[], mean: number, stdDev: number): number {
  const n = data.length;
  const sum = data.reduce((acc, val) => acc + Math.pow((val - mean) / stdDev, 4), 0);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum - (3 * Math.pow(n - 1, 2)) / ((n - 2) * (n - 3));
}

function analyzeBatteryTrends(records: any[], options: Record<string, any>): any {
  const timeField = options.timeField || 'timestamp';
  const valueField = options.valueField || 'stateOfCharge';

  const sortedRecords = records
    .filter(r => r[timeField] && r[valueField] !== undefined)
    .sort((a, b) => new Date(a[timeField]).getTime() - new Date(b[timeField]).getTime());

  const values = sortedRecords.map(r => r[valueField]);
  const times = sortedRecords.map(r => new Date(r[timeField]).getTime());

  return {
    trend: calculateTrend(values, times),
    volatility: calculateStatistics({ data: values }).standardDeviation,
    changeRate: calculateChangeRate(values, times),
    cycles: detectCycles(values),
    outliers: detectOutliers(values),
  };
}

function calculatePerformanceMetrics(records: any[], options: Record<string, any>): any {
  const metrics: Record<string, any> = {};

  const fields = options.fields || ['voltage', 'current', 'temperature', 'stateOfCharge'];
  fields.forEach((field: string) => {
    const values = records
      .map(r => r[field])
      .filter(v => v !== undefined && v !== null && !isNaN(v));

    if (values.length > 0) {
      metrics[field] = calculateStatistics({ data: values });
    }
  });

  return metrics;
}

function detectAnomalies(records: any[], options: Record<string, any>): any {
  const field = options.field || 'voltage';
  const threshold = options.threshold || 2; // Standard deviations

  const values = records
    .map(r => r[field])
    .filter(v => v !== undefined && v !== null && !isNaN(v));

  if (values.length === 0) return { anomalies: [], anomalyCount: 0 };

  const stats = calculateStatistics({ data: values });
  const anomalies = values
    .map((value, index) => ({
      index,
      value,
      deviation: Math.abs(value - stats.mean) / stats.standardDeviation,
      isAnomaly: Math.abs(value - stats.mean) > threshold * stats.standardDeviation,
    }))
    .filter(item => item.isAnomaly);

  return {
    anomalies,
    anomalyCount: anomalies.length,
    anomalyRate: anomalies.length / values.length,
    threshold,
  };
}

function calculateCorrelations(records: any[], options: Record<string, any>): any {
  const fields = options.fields || ['voltage', 'current', 'temperature', 'stateOfCharge'];
  const correlations: Record<string, Record<string, number>> = {};

  fields.forEach((field1: string) => {
    correlations[field1] = {};
    fields.forEach((field2: string) => {
      const values1 = records.map(r => r[field1]).filter(v => v != null);
      const values2 = records.map(r => r[field2]).filter(v => v != null);

      correlations[field1][field2] = calculatePearsonCorrelation(values1, values2);
    });
  });

  return correlations;
}

function analyzeTimeSeries(records: any[], options: Record<string, any>): any {
  const timeField = options.timeField || 'timestamp';
  const valueField = options.valueField || 'stateOfCharge';

  const sortedData = records
    .filter(r => r[timeField] && r[valueField] !== undefined)
    .sort((a, b) => new Date(a[timeField]).getTime() - new Date(b[timeField]).getTime())
    .map(r => ({
      time: new Date(r[timeField]).getTime(),
      value: r[valueField],
    }));

  if (sortedData.length < 2) {
    return { trend: 0, seasonality: [], forecast: [] };
  }

  return {
    trend: calculateTrend(
      sortedData.map(d => d.value),
      sortedData.map(d => d.time)
    ),
    seasonality: detectSeasonality(sortedData),
    autocorrelation: calculateAutocorrelation(sortedData.map(d => d.value)),
    forecast: forecastNextValues(sortedData, options.forecastSteps || 5),
  };
}

// Additional utility functions
function calculateTrend(values: number[], times: number[]): number {
  const n = values.length;
  const sumX = times.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = times.reduce((sum, x, i) => sum + x * values[i], 0);
  const sumXX = times.reduce((sum, x) => sum + x * x, 0);

  return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
}

function calculateChangeRate(values: number[], times: number[]): number {
  if (values.length < 2) return 0;

  const totalChange = values[values.length - 1] - values[0];
  const totalTime = times[times.length - 1] - times[0];

  return totalTime > 0 ? totalChange / totalTime : 0;
}

function detectCycles(values: number[]): number {
  // Simple cycle detection using zero crossings of centered data
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const centered = values.map(v => v - mean);

  let cycles = 0;
  for (let i = 1; i < centered.length; i++) {
    if (centered[i - 1] * centered[i] < 0) {
      cycles++;
    }
  }

  return cycles / 2; // Each cycle has 2 zero crossings
}

function detectOutliers(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = getPercentile(sorted, 25);
  const q3 = getPercentile(sorted, 75);
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  return values.filter(v => v < lowerBound || v > upperBound);
}

function calculatePearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  const sumX = x.slice(0, n).reduce((a, b) => a + b, 0);
  const sumY = y.slice(0, n).reduce((a, b) => a + b, 0);
  const sumXX = x.slice(0, n).reduce((sum, val) => sum + val * val, 0);
  const sumYY = y.slice(0, n).reduce((sum, val) => sum + val * val, 0);
  const sumXY = x.slice(0, n).reduce((sum, val, i) => sum + val * y[i], 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));

  return denominator === 0 ? 0 : numerator / denominator;
}

function detectSeasonality(data: Array<{ time: number; value: number }>): number[] {
  // Simple seasonal decomposition using moving averages
  const windowSize = Math.min(12, Math.floor(data.length / 4));
  if (windowSize < 3) return [];

  const seasonal: number[] = [];

  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(data.length, i + Math.floor(windowSize / 2) + 1);
    const window = data.slice(start, end);
    const average = window.reduce((sum, d) => sum + d.value, 0) / window.length;
    seasonal.push(data[i].value - average);
  }

  return seasonal;
}

function calculateAutocorrelation(values: number[], maxLag = 10): number[] {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const correlations: number[] = [];

  for (let lag = 0; lag <= Math.min(maxLag, n - 1); lag++) {
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n - lag; i++) {
      numerator += (values[i] - mean) * (values[i + lag] - mean);
    }

    for (let i = 0; i < n; i++) {
      denominator += (values[i] - mean) * (values[i] - mean);
    }

    correlations.push(denominator === 0 ? 0 : numerator / denominator);
  }

  return correlations;
}

function forecastNextValues(
  data: Array<{ time: number; value: number }>,
  steps: number
): Array<{ time: number; value: number; confidence: number }> {
  if (data.length < 3) return [];

  // Simple linear extrapolation
  const values = data.map(d => d.value);
  const times = data.map(d => d.time);
  const trend = calculateTrend(values, times);
  const lastTime = times[times.length - 1];
  const lastValue = values[values.length - 1];
  const timeStep = times.length > 1 ? times[times.length - 1] - times[times.length - 2] : 1;

  const forecast: Array<{ time: number; value: number; confidence: number }> = [];

  for (let i = 1; i <= steps; i++) {
    const time = lastTime + i * timeStep;
    const value = lastValue + trend * i * timeStep;
    const confidence = Math.max(0, 1 - (i * 0.15)); // Decreasing confidence

    forecast.push({ time, value, confidence });
  }

  return forecast;
}

// Simple compression utilities
function lzCompress(data: string): string {
  // Simplified LZ compression (not production-ready)
  const dict: Record<string, number> = {};
  let dictSize = 256;
  const result: number[] = [];
  let w = '';

  for (let i = 0; i < 256; i++) {
    dict[String.fromCharCode(i)] = i;
  }

  for (const c of data) {
    const wc = w + c;
    if (dict[wc]) {
      w = wc;
    } else {
      result.push(dict[w]);
      dict[wc] = dictSize++;
      w = c;
    }
  }

  if (w) {
    result.push(dict[w]);
  }

  return result.join(',');
}

function lzDecompress(compressed: string): string {
  const data = compressed.split(',').map(Number);
  const dict: Record<number, string> = {};
  let dictSize = 256;
  let w = String.fromCharCode(data[0]);
  const result = [w];

  for (let i = 0; i < 256; i++) {
    dict[i] = String.fromCharCode(i);
  }

  for (let i = 1; i < data.length; i++) {
    const k = data[i];
    let entry: string;

    if (dict[k]) {
      entry = dict[k];
    } else if (k === dictSize) {
      entry = w + w.charAt(0);
    } else {
      throw new Error('Invalid compressed data');
    }

    result.push(entry);
    dict[dictSize++] = w + entry.charAt(0);
    w = entry;
  }

  return result.join('');
}

function runLengthEncode(data: string): string {
  let encoded = '';
  let count = 1;
  let current = data[0];

  for (let i = 1; i < data.length; i++) {
    if (data[i] === current) {
      count++;
    } else {
      encoded += count > 1 ? count + current : current;
      current = data[i];
      count = 1;
    }
  }

  encoded += count > 1 ? count + current : current;
  return encoded;
}

function runLengthDecode(encoded: string): string {
  let decoded = '';
  let i = 0;

  while (i < encoded.length) {
    let count = '';
    while (i < encoded.length && /\d/.test(encoded[i])) {
      count += encoded[i++];
    }

    const char = encoded[i++];
    const repeatCount = count ? parseInt(count) : 1;
    decoded += char.repeat(repeatCount);
  }

  return decoded;
}

function validateItem(item: any, schema: any, options: Record<string, any>): void {
  // Basic validation implementation
  if (schema.required && schema.required.some((field: string) => !(field in item))) {
    throw new Error('Missing required fields');
  }

  Object.entries(schema.properties || {}).forEach(([field, rules]: [string, any]) => {
    const value = item[field];

    if (value !== undefined && rules.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== rules.type) {
        throw new Error(`Field ${field} must be of type ${rules.type}`);
      }
    }
  });
}

export {};