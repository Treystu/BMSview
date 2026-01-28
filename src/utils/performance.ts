import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Performance optimization utilities
 * Provides memoization, debouncing, throttling, and virtual scrolling helpers
 */

export interface PerformanceMetrics {
  renderTime: number;
  componentName: string;
  timestamp: string;
  propsHash: string;
  memoryUsage?: number;
}

export class PerformanceMonitor {
  private static metrics: PerformanceMetrics[] = [];
  private static maxMetrics = 1000;

  static startMeasurement(componentName: string, propsHash: string): () => void {
    const startTime = performance.now();
    const startMemory = this.getMemoryUsage();

    return () => {
      const renderTime = performance.now() - startTime;
      const endMemory = this.getMemoryUsage();

      const metric: PerformanceMetrics = {
        renderTime,
        componentName,
        timestamp: new Date().toISOString(),
        propsHash,
        memoryUsage: endMemory ? endMemory - (startMemory || 0) : undefined,
      };

      this.addMetric(metric);

      // Warn about slow renders in development
      if (process.env.NODE_ENV === 'development' && renderTime > 16) {
        console.warn(`[Performance] Slow render detected in ${componentName}: ${renderTime.toFixed(2)}ms`);
      }
    };
  }

  static addMetric(metric: PerformanceMetrics): void {
    this.metrics.push(metric);

    // Keep only the most recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  static getMetrics(componentName?: string): PerformanceMetrics[] {
    return componentName
      ? this.metrics.filter(m => m.componentName === componentName)
      : [...this.metrics];
  }

  static getAverageRenderTime(componentName: string): number {
    const componentMetrics = this.getMetrics(componentName);
    if (componentMetrics.length === 0) return 0;

    const totalTime = componentMetrics.reduce((sum, m) => sum + m.renderTime, 0);
    return totalTime / componentMetrics.length;
  }

  static getSlowestComponents(limit = 10): Array<{ component: string; avgTime: number; count: number }> {
    const componentStats = new Map<string, { totalTime: number; count: number }>();

    this.metrics.forEach(metric => {
      const existing = componentStats.get(metric.componentName) || { totalTime: 0, count: 0 };
      componentStats.set(metric.componentName, {
        totalTime: existing.totalTime + metric.renderTime,
        count: existing.count + 1,
      });
    });

    return Array.from(componentStats.entries())
      .map(([component, stats]) => ({
        component,
        avgTime: stats.totalTime / stats.count,
        count: stats.count,
      }))
      .sort((a, b) => b.avgTime - a.avgTime)
      .slice(0, limit);
  }

  static clearMetrics(): void {
    this.metrics = [];
  }

  private static getMemoryUsage(): number | undefined {
    if ('memory' in performance) {
      // @ts-ignore - performance.memory is not in all browsers
      return performance.memory?.usedJSHeapSize;
    }
    return undefined;
  }
}

// Higher-order component for performance monitoring
export function withPerformanceMonitoring<P extends object>(
  Component: React.ComponentType<P>,
  componentName?: string
) {
  const WrappedComponent = (props: P) => {
    const name = componentName || Component.displayName || Component.name || 'Unknown';
    const propsHash = useMemo(() => createPropsHash(props), [props]);

    const endMeasurement = useRef<(() => void) | null>(null);

    // Start measurement before render
    endMeasurement.current = PerformanceMonitor.startMeasurement(name, propsHash);

    useEffect(() => {
      // End measurement after render
      return () => {
        if (endMeasurement.current) {
          endMeasurement.current();
        }
      };
    });

    return <Component {...props} />;
  };

  WrappedComponent.displayName = `withPerformanceMonitoring(${Component.displayName || Component.name})`;
  return WrappedComponent;
}

function createPropsHash(props: unknown): string {
  try {
    // Simple hash of props for change detection
    const str = JSON.stringify(props, (key, value) => {
      if (typeof value === 'function') return '[Function]';
      if (value instanceof Date) return value.toISOString();
      return value;
    });

    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  } catch {
    return 'hash_error';
  }
}

// Debounce hook
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Throttle hook
export function useThrottle<T>(value: T, delay: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastUpdated = useRef<number>(0);

  useEffect(() => {
    const now = Date.now();
    if (now - lastUpdated.current >= delay) {
      setThrottledValue(value);
      lastUpdated.current = now;
    } else {
      const timeoutId = setTimeout(() => {
        setThrottledValue(value);
        lastUpdated.current = Date.now();
      }, delay - (now - lastUpdated.current));

      return () => clearTimeout(timeoutId);
    }
  }, [value, delay]);

  return throttledValue;
}

// Memoization with deep comparison
export function useDeepMemo<T>(factory: () => T, deps: React.DependencyList): T {
  const ref = useRef<{ deps: React.DependencyList; value: T }>();

  if (!ref.current || !deepEqual(deps, ref.current.deps)) {
    ref.current = {
      deps,
      value: factory(),
    };
  }

  return ref.current.value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

// Intersection Observer hook for lazy loading
export function useIntersectionObserver(
  options: IntersectionObserverInit = {}
): [React.RefCallback<Element>, boolean] {
  const [isIntersecting, setIsIntersecting] = useState(false);
  const [node, setNode] = useState<Element | null>(null);

  const observer = useMemo(() => {
    return new IntersectionObserver(([entry]) => {
      setIsIntersecting(entry.isIntersecting);
    }, options);
  }, [options]);

  useEffect(() => {
    if (node) {
      observer.observe(node);
      return () => observer.unobserve(node);
    }
  }, [observer, node]);

  const ref = useCallback((node: Element | null) => {
    setNode(node);
  }, []);

  return [ref, isIntersecting];
}

// Virtual scrolling hook
export interface VirtualScrollOptions {
  itemHeight: number;
  containerHeight: number;
  buffer?: number;
}

export function useVirtualScroll<T>(
  items: T[],
  options: VirtualScrollOptions
) {
  const { itemHeight, containerHeight, buffer = 5 } = options;
  const [scrollTop, setScrollTop] = useState(0);

  const visibleItemCount = Math.ceil(containerHeight / itemHeight);
  const totalHeight = items.length * itemHeight;

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
  const endIndex = Math.min(
    items.length - 1,
    startIndex + visibleItemCount + buffer * 2
  );

  const visibleItems = useMemo(() => {
    return items.slice(startIndex, endIndex + 1).map((item, index) => ({
      item,
      index: startIndex + index,
      top: (startIndex + index) * itemHeight,
    }));
  }, [items, startIndex, endIndex, itemHeight]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  return {
    visibleItems,
    totalHeight,
    onScroll,
    startIndex,
    endIndex,
  };
}

// Optimized state updater
export function useOptimizedState<T>(
  initialState: T | (() => T),
  isEqual: (a: T, b: T) => boolean = Object.is
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState(initialState);

  const optimizedSetState = useCallback((newState: React.SetStateAction<T>) => {
    setState(prevState => {
      const nextState = typeof newState === 'function'
        ? (newState as (prev: T) => T)(prevState)
        : newState;

      return isEqual(prevState, nextState) ? prevState : nextState;
    });
  }, [isEqual]);

  return [state, optimizedSetState];
}

// Batch state updates
export function useBatchedState<T>(
  initialState: T,
  batchDelay = 0
): [T, (updater: (prev: T) => T) => void, () => void] {
  const [state, setState] = useState(initialState);
  const pendingUpdates = useRef<Array<(prev: T) => T>>([]);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const flushUpdates = useCallback(() => {
    if (pendingUpdates.current.length > 0) {
      const updates = pendingUpdates.current;
      pendingUpdates.current = [];

      setState(prevState => {
        return updates.reduce((state, updater) => updater(state), prevState);
      });
    }
    timeoutRef.current = null;
  }, []);

  const batchedSetState = useCallback((updater: (prev: T) => T) => {
    pendingUpdates.current.push(updater);

    if (batchDelay === 0) {
      // Batch in the next tick
      if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(flushUpdates, 0);
      }
    } else {
      // Batch after delay
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(flushUpdates, batchDelay);
    }
  }, [flushUpdates, batchDelay]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [state, batchedSetState, flushUpdates];
}

// Memory usage monitoring hook
export function useMemoryMonitor(componentName: string, interval = 5000) {
  const [memoryUsage, setMemoryUsage] = useState<number | null>(null);

  useEffect(() => {
    if (!('memory' in performance)) {
      return;
    }

    const checkMemory = () => {
      // @ts-ignore - performance.memory is not standard
      const memory = performance.memory;
      if (memory) {
        const usedMB = Math.round(memory.usedJSHeapSize / 1024 / 1024);
        setMemoryUsage(usedMB);

        if (process.env.NODE_ENV === 'development' && usedMB > 100) {
          console.warn(`[Memory] High memory usage in ${componentName}: ${usedMB}MB`);
        }
      }
    };

    checkMemory();
    const intervalId = setInterval(checkMemory, interval);

    return () => clearInterval(intervalId);
  }, [componentName, interval]);

  return memoryUsage;
}

// Bundle size analyzer (development only)
export function analyzeBundleSize() {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  const getResourceTiming = () => {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return resources
      .filter(resource => resource.name.includes('.js') || resource.name.includes('.css'))
      .map(resource => ({
        name: resource.name.split('/').pop() || resource.name,
        size: resource.transferSize,
        loadTime: resource.responseEnd - resource.requestStart,
      }))
      .sort((a, b) => b.size - a.size);
  };

  console.group('📦 Bundle Analysis');
  console.table(getResourceTiming());
  console.groupEnd();
}

export default {
  PerformanceMonitor,
  withPerformanceMonitoring,
  useDebounce,
  useThrottle,
  useDeepMemo,
  useIntersectionObserver,
  useVirtualScroll,
  useOptimizedState,
  useBatchedState,
  useMemoryMonitor,
  analyzeBundleSize,
};