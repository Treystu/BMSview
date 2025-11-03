// Centralized telemetry gate. Telemetry is opt-in and off by default.

export const isTelemetryEnabled = (): boolean => {
  try {
    // Developer can opt-in by setting window.__ENABLE_TELEMETRY__ = true in the browser console
    if ((window as any).__ENABLE_TELEMETRY__ === true) return true;
    // Or set localStorage key 'enableTelemetry' = '1'
    if (typeof localStorage !== 'undefined' && localStorage.getItem('enableTelemetry') === '1') return true;
    return false;
  } catch (e) {
    return false;
  }
};

export const storeMetric = (key: string, metric: any) => {
  if (!isTelemetryEnabled()) return;
  try {
    const raw = localStorage.getItem(key) || '[]';
    const arr = JSON.parse(raw);
    arr.push(metric);
    localStorage.setItem(key, JSON.stringify(arr.slice(-100)));
  } catch (e) {
    // swallow
  }
};

export const getMetrics = (key: string) => {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (e) {
    return [];
  }
};

export const clearMetrics = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch (e) {}
};
