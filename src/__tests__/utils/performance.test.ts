import {
  PerformanceMonitor,
  useDebounce,
  useThrottle,
  useVirtualScroll,
  useOptimizedState,
  useBatchedState,
  withPerformanceMonitoring,
} from '../../utils/performance';
import { renderHook, act } from '@testing-library/react';
import { waitForNextUpdate } from './testUtils';

// Mock performance API
const mockPerformance = {
  now: jest.fn(() => Date.now()),
  mark: jest.fn(),
  measure: jest.fn(),
  memory: {
    usedJSHeapSize: 1000000,
  },
};

Object.defineProperty(global, 'performance', {
  value: mockPerformance,
  writable: true,
});

describe('Performance Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('PerformanceMonitor', () => {
    beforeEach(() => {
      PerformanceMonitor.clearMetrics();
    });

    describe('startMeasurement', () => {
      it('should track render times', () => {
        const endMeasurement = PerformanceMonitor.startMeasurement('TestComponent', 'props123');

        // Simulate some work
        jest.advanceTimersByTime(50);

        endMeasurement();

        const metrics = PerformanceMonitor.getMetrics('TestComponent');
        expect(metrics).toHaveLength(1);
        expect(metrics[0].componentName).toBe('TestComponent');
        expect(metrics[0].propsHash).toBe('props123');
      });

      it('should warn about slow renders in development', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        mockPerformance.now
          .mockReturnValueOnce(0)
          .mockReturnValueOnce(20); // 20ms render time

        const endMeasurement = PerformanceMonitor.startMeasurement('SlowComponent', 'props');
        endMeasurement();

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Slow render detected in SlowComponent')
        );

        process.env.NODE_ENV = originalEnv;
        consoleSpy.mockRestore();
      });
    });

    describe('getAverageRenderTime', () => {
      it('should calculate average render time', () => {
        // Add multiple metrics
        PerformanceMonitor.addMetric({
          renderTime: 10,
          componentName: 'TestComponent',
          timestamp: new Date().toISOString(),
          propsHash: 'props1',
        });
        PerformanceMonitor.addMetric({
          renderTime: 20,
          componentName: 'TestComponent',
          timestamp: new Date().toISOString(),
          propsHash: 'props2',
        });
        PerformanceMonitor.addMetric({
          renderTime: 30,
          componentName: 'TestComponent',
          timestamp: new Date().toISOString(),
          propsHash: 'props3',
        });

        const average = PerformanceMonitor.getAverageRenderTime('TestComponent');
        expect(average).toBe(20); // (10 + 20 + 30) / 3
      });

      it('should return 0 for components with no metrics', () => {
        const average = PerformanceMonitor.getAverageRenderTime('NonExistentComponent');
        expect(average).toBe(0);
      });
    });

    describe('getSlowestComponents', () => {
      it('should return components sorted by average render time', () => {
        // Add metrics for different components
        const components = [
          { name: 'FastComponent', times: [1, 2, 3] },
          { name: 'SlowComponent', times: [50, 60, 70] },
          { name: 'MediumComponent', times: [10, 15, 20] },
        ];

        components.forEach(({ name, times }) => {
          times.forEach(time => {
            PerformanceMonitor.addMetric({
              renderTime: time,
              componentName: name,
              timestamp: new Date().toISOString(),
              propsHash: 'props',
            });
          });
        });

        const slowest = PerformanceMonitor.getSlowestComponents(2);

        expect(slowest).toHaveLength(2);
        expect(slowest[0].component).toBe('SlowComponent');
        expect(slowest[0].avgTime).toBe(60);
        expect(slowest[1].component).toBe('MediumComponent');
        expect(slowest[1].avgTime).toBe(15);
      });
    });
  });

  describe('useDebounce', () => {
    it('should debounce value changes', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: 'initial', delay: 500 } }
      );

      expect(result.current).toBe('initial');

      // Change value
      rerender({ value: 'updated', delay: 500 });
      expect(result.current).toBe('initial'); // Should still be initial

      // Wait for debounce
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(result.current).toBe('updated');
    });

    it('should reset timer on rapid changes', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: 'initial', delay: 500 } }
      );

      // Rapid changes
      rerender({ value: 'change1', delay: 500 });
      act(() => jest.advanceTimersByTime(250));

      rerender({ value: 'change2', delay: 500 });
      act(() => jest.advanceTimersByTime(250));

      expect(result.current).toBe('initial'); // Should still be initial

      // Complete the debounce
      act(() => jest.advanceTimersByTime(250));
      expect(result.current).toBe('change2');
    });
  });

  describe('useThrottle', () => {
    it('should throttle value changes', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useThrottle(value, delay),
        { initialProps: { value: 'initial', delay: 500 } }
      );

      expect(result.current).toBe('initial');

      // First change should be immediate
      rerender({ value: 'change1', delay: 500 });
      expect(result.current).toBe('change1');

      // Subsequent changes should be throttled
      rerender({ value: 'change2', delay: 500 });
      expect(result.current).toBe('change1'); // Should still be change1

      // Wait for throttle period
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(result.current).toBe('change2');
    });
  });

  describe('useVirtualScroll', () => {
    it('should calculate visible items correctly', () => {
      const items = Array.from({ length: 1000 }, (_, i) => `Item ${i}`);

      const { result } = renderHook(() =>
        useVirtualScroll(items, {
          itemHeight: 50,
          containerHeight: 300,
          buffer: 2,
        })
      );

      expect(result.current.totalHeight).toBe(50000); // 1000 * 50
      expect(result.current.visibleItems.length).toBeGreaterThan(0);
      expect(result.current.startIndex).toBe(0);
      expect(result.current.endIndex).toBeGreaterThan(0);
    });

    it('should update visible items when scrolling', () => {
      const items = Array.from({ length: 1000 }, (_, i) => `Item ${i}`);

      const { result } = renderHook(() =>
        useVirtualScroll(items, {
          itemHeight: 50,
          containerHeight: 300,
          buffer: 2,
        })
      );

      // Simulate scroll
      act(() => {
        const mockEvent = {
          currentTarget: { scrollTop: 500 }
        } as React.UIEvent<HTMLDivElement>;

        result.current.onScroll(mockEvent);
      });

      expect(result.current.startIndex).toBeGreaterThan(0);
    });
  });

  describe('useOptimizedState', () => {
    it('should prevent unnecessary updates with custom equality', () => {
      const isEqual = jest.fn((a, b) => a.id === b.id);

      const { result } = renderHook(() =>
        useOptimizedState({ id: 1, name: 'test' }, isEqual)
      );

      const [state, setState] = result.current;
      expect(state).toEqual({ id: 1, name: 'test' });

      // Update with same ID should be ignored
      act(() => {
        setState({ id: 1, name: 'updated' });
      });

      expect(isEqual).toHaveBeenCalled();
      expect(result.current[0]).toEqual({ id: 1, name: 'test' }); // Should not update

      // Update with different ID should work
      act(() => {
        setState({ id: 2, name: 'updated' });
      });

      expect(result.current[0]).toEqual({ id: 2, name: 'updated' });
    });
  });

  describe('useBatchedState', () => {
    it('should batch multiple updates', () => {
      const { result } = renderHook(() =>
        useBatchedState({ count: 0 }, 100)
      );

      const [state, batchedSetState] = result.current;
      expect(state.count).toBe(0);

      // Multiple rapid updates
      act(() => {
        batchedSetState(prev => ({ count: prev.count + 1 }));
        batchedSetState(prev => ({ count: prev.count + 1 }));
        batchedSetState(prev => ({ count: prev.count + 1 }));
      });

      // Should still be 0 until batch is flushed
      expect(result.current[0].count).toBe(0);

      // Flush the batch
      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(result.current[0].count).toBe(3);
    });

    it('should allow manual flush', () => {
      const { result } = renderHook(() =>
        useBatchedState({ count: 0 }, 1000)
      );

      const [state, batchedSetState, flushUpdates] = result.current;

      act(() => {
        batchedSetState(prev => ({ count: prev.count + 1 }));
        batchedSetState(prev => ({ count: prev.count + 1 }));
      });

      // Manually flush
      act(() => {
        flushUpdates();
      });

      expect(result.current[0].count).toBe(2);
    });
  });

  describe('withPerformanceMonitoring', () => {
    it('should wrap component with performance monitoring', () => {
      const TestComponent = ({ name }: { name: string }) => <div>{name}</div>;
      const MonitoredComponent = withPerformanceMonitoring(TestComponent, 'TestComponent');

      expect(MonitoredComponent.displayName).toBe('withPerformanceMonitoring(TestComponent)');
    });
  });
});