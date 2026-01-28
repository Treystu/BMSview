import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce, useThrottle, useVirtualScroll, VirtualScrollOptions } from '@/utils/performance';
import { LazyLoadingMonitor } from '@/utils/bundleOptimization';

/**
 * Performance optimization hooks
 * Provides hooks for memoization, virtualization, and performance monitoring
 */

export interface PerformanceOptions {
  enableLogging?: boolean;
  trackMemory?: boolean;
  warnThreshold?: number; // ms
}

// Enhanced useMemo with performance tracking
export function useTrackedMemo<T>(
  factory: () => T,
  deps: React.DependencyList,
  name?: string,
  options: PerformanceOptions = {}
): T {
  const { enableLogging = false, warnThreshold = 10 } = options;
  const startTimeRef = useRef<number>();

  return useMemo(() => {
    if (enableLogging) {
      startTimeRef.current = performance.now();
    }

    const result = factory();

    if (enableLogging && startTimeRef.current) {
      const duration = performance.now() - startTimeRef.current;
      const memoName = name || 'Anonymous';

      if (duration > warnThreshold) {
        console.warn(`[useMemo] Slow computation in ${memoName}: ${duration.toFixed(2)}ms`);
      } else if (process.env.NODE_ENV === 'development') {
        console.debug(`[useMemo] ${memoName}: ${duration.toFixed(2)}ms`);
      }
    }

    return result;
  }, deps);
}

// Enhanced useCallback with performance tracking
export function useTrackedCallback<T extends (...args: any[]) => any>(
  callback: T,
  deps: React.DependencyList,
  name?: string,
  options: PerformanceOptions = {}
): T {
  const { enableLogging = false, warnThreshold = 5 } = options;

  return useCallback((...args: Parameters<T>) => {
    const startTime = enableLogging ? performance.now() : 0;
    const result = callback(...args);

    if (enableLogging) {
      const duration = performance.now() - startTime;
      const callbackName = name || 'Anonymous';

      if (duration > warnThreshold) {
        console.warn(`[useCallback] Slow execution in ${callbackName}: ${duration.toFixed(2)}ms`);
      }
    }

    return result;
  }, deps) as T;
}

// Optimized list rendering hook
export interface OptimizedListOptions<T> extends VirtualScrollOptions {
  data: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  getItemKey?: (item: T, index: number) => string | number;
  overscan?: number;
  enableVirtualization?: boolean;
  threshold?: number; // Items count threshold to enable virtualization
}

export function useOptimizedList<T>(options: OptimizedListOptions<T>) {
  const {
    data,
    renderItem,
    getItemKey = (_, index) => index,
    enableVirtualization = true,
    threshold = 100,
    overscan = 5,
    ...virtualScrollOptions
  } = options;

  const shouldVirtualize = enableVirtualization && data.length > threshold;

  const virtualScroll = useVirtualScroll(data, {
    ...virtualScrollOptions,
    buffer: overscan,
  });

  const renderedItems = useMemo(() => {
    if (!shouldVirtualize) {
      return data.map((item, index) => ({
        key: getItemKey(item, index),
        content: renderItem(item, index),
        index,
      }));
    }

    return virtualScroll.visibleItems.map(({ item, index, top }) => ({
      key: getItemKey(item, index),
      content: renderItem(item, index),
      index,
      style: { transform: `translateY(${top}px)` },
    }));
  }, [shouldVirtualize, data, renderItem, getItemKey, virtualScroll.visibleItems]);

  return {
    renderedItems,
    containerProps: shouldVirtualize ? {
      style: { height: virtualScroll.totalHeight, position: 'relative' as const },
      onScroll: virtualScroll.onScroll,
    } : {},
    isVirtualized: shouldVirtualize,
    totalHeight: virtualScroll.totalHeight,
    visibleRange: shouldVirtualize ? {
      start: virtualScroll.startIndex,
      end: virtualScroll.endIndex,
    } : { start: 0, end: data.length - 1 },
  };
}

// Intersection observer hook for lazy loading
export interface LazyLoadOptions {
  threshold?: number;
  rootMargin?: string;
  triggerOnce?: boolean;
  onIntersect?: () => void;
  onLeave?: () => void;
}

export function useLazyLoad(options: LazyLoadOptions = {}) {
  const {
    threshold = 0.1,
    rootMargin = '50px',
    triggerOnce = true,
    onIntersect,
    onLeave,
  } = options;

  const [isVisible, setIsVisible] = useState(false);
  const [hasTriggered, setHasTriggered] = useState(false);
  const elementRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const setRef = useCallback((element: HTMLElement | null) => {
    elementRef.current = element;

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    if (element) {
      observerRef.current = new IntersectionObserver(
        ([entry]) => {
          const isIntersecting = entry.isIntersecting;

          if (isIntersecting && (!triggerOnce || !hasTriggered)) {
            setIsVisible(true);
            setHasTriggered(true);
            onIntersect?.();
          } else if (!isIntersecting && !triggerOnce) {
            setIsVisible(false);
            onLeave?.();
          }
        },
        { threshold, rootMargin }
      );

      observerRef.current.observe(element);
    }
  }, [threshold, rootMargin, triggerOnce, hasTriggered, onIntersect, onLeave]);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  return { ref: setRef, isVisible, hasTriggered };
}

// Image lazy loading hook
export function useLazyImage(src: string, options: LazyLoadOptions = {}) {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [isError, setIsError] = useState(false);

  const { ref, isVisible } = useLazyLoad(options);

  useEffect(() => {
    if (isVisible && src && !imageSrc) {
      setImageSrc(src);
    }
  }, [isVisible, src, imageSrc]);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
    setIsError(false);
  }, []);

  const handleError = useCallback(() => {
    setIsError(true);
    setIsLoaded(false);
  }, []);

  return {
    ref,
    src: imageSrc,
    isLoaded,
    isError,
    isVisible,
    onLoad: handleLoad,
    onError: handleError,
  };
}

// Performance monitoring hook
export function usePerformanceMonitor(componentName: string, options: PerformanceOptions = {}) {
  const { enableLogging = process.env.NODE_ENV === 'development', trackMemory = false } = options;
  const renderCountRef = useRef(0);
  const lastRenderTimeRef = useRef<number>(performance.now());
  const mountTimeRef = useRef<number>(performance.now());

  useEffect(() => {
    renderCountRef.current += 1;
    const now = performance.now();
    const renderTime = now - lastRenderTimeRef.current;
    lastRenderTimeRef.current = now;

    if (enableLogging) {
      if (renderCountRef.current === 1) {
        // First render
        const mountTime = now - mountTimeRef.current;
        LazyLoadingMonitor.trackLazyLoad(componentName, mountTimeRef.current);
        console.debug(`[Performance] ${componentName} mounted in ${mountTime.toFixed(2)}ms`);
      } else {
        // Re-render
        if (renderTime > 16) { // > 1 frame at 60fps
          console.warn(`[Performance] ${componentName} slow re-render: ${renderTime.toFixed(2)}ms`);
        }
      }
    }

    if (trackMemory && 'memory' in performance) {
      // @ts-ignore - performance.memory is not standard
      const memoryInfo = performance.memory;
      if (memoryInfo.usedJSHeapSize > 50 * 1024 * 1024) { // > 50MB
        console.warn(`[Performance] High memory usage in ${componentName}: ${Math.round(memoryInfo.usedJSHeapSize / 1024 / 1024)}MB`);
      }
    }
  });

  return {
    renderCount: renderCountRef.current,
    componentName,
  };
}

// Bundle preloading hook
export function useBundlePreloader() {
  const [loadedBundles, setLoadedBundles] = useState<Set<string>>(new Set());
  const [loadingBundles, setLoadingBundles] = useState<Set<string>>(new Set());

  const preloadBundle = useCallback(async (bundleName: string, importFn: () => Promise<any>) => {
    if (loadedBundles.has(bundleName) || loadingBundles.has(bundleName)) {
      return;
    }

    setLoadingBundles(prev => new Set(prev).add(bundleName));

    try {
      await importFn();
      setLoadedBundles(prev => new Set(prev).add(bundleName));
      console.debug(`[BundlePreloader] Successfully preloaded ${bundleName}`);
    } catch (error) {
      console.error(`[BundlePreloader] Failed to preload ${bundleName}:`, error);
    } finally {
      setLoadingBundles(prev => {
        const next = new Set(prev);
        next.delete(bundleName);
        return next;
      });
    }
  }, [loadedBundles, loadingBundles]);

  const preloadOnInteraction = useCallback((
    bundleName: string,
    importFn: () => Promise<any>,
    events: string[] = ['mouseenter', 'focus']
  ) => {
    const element = document.documentElement;

    const handleInteraction = () => {
      preloadBundle(bundleName, importFn);
      // Remove listeners after first interaction
      events.forEach(event => {
        element.removeEventListener(event, handleInteraction);
      });
    };

    events.forEach(event => {
      element.addEventListener(event, handleInteraction, { once: true, passive: true });
    });

    return () => {
      events.forEach(event => {
        element.removeEventListener(event, handleInteraction);
      });
    };
  }, [preloadBundle]);

  const preloadOnIdle = useCallback((bundleName: string, importFn: () => Promise<any>, timeout = 2000) => {
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(() => {
        preloadBundle(bundleName, importFn);
      }, { timeout });
      return () => window.cancelIdleCallback(handle);
    } else {
      // Fallback for browsers without requestIdleCallback
      const timeoutId = setTimeout(() => {
        preloadBundle(bundleName, importFn);
      }, timeout);
      return () => clearTimeout(timeoutId);
    }
  }, [preloadBundle]);

  return {
    preloadBundle,
    preloadOnInteraction,
    preloadOnIdle,
    loadedBundles: Array.from(loadedBundles),
    loadingBundles: Array.from(loadingBundles),
    isLoaded: (bundleName: string) => loadedBundles.has(bundleName),
    isLoading: (bundleName: string) => loadingBundles.has(bundleName),
  };
}

// Optimized search hook with debouncing
export interface SearchOptions<T> {
  data: T[];
  searchKey?: keyof T | ((item: T) => string);
  debounceMs?: number;
  caseSensitive?: boolean;
  minLength?: number;
}

export function useOptimizedSearch<T>(options: SearchOptions<T>) {
  const {
    data,
    searchKey,
    debounceMs = 300,
    caseSensitive = false,
    minLength = 1,
  } = options;

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, debounceMs);

  const searchResults = useMemo(() => {
    if (!debouncedQuery || debouncedQuery.length < minLength) {
      return data;
    }

    const searchTerm = caseSensitive ? debouncedQuery : debouncedQuery.toLowerCase();

    return data.filter(item => {
      const searchValue = searchKey
        ? typeof searchKey === 'function'
          ? searchKey(item)
          : String(item[searchKey] || '')
        : String(item);

      const value = caseSensitive ? searchValue : searchValue.toLowerCase();
      return value.includes(searchTerm);
    });
  }, [data, debouncedQuery, searchKey, caseSensitive, minLength]);

  return {
    query,
    setQuery,
    searchResults,
    isSearching: query !== debouncedQuery,
    resultCount: searchResults.length,
  };
}

export default {
  useTrackedMemo,
  useTrackedCallback,
  useOptimizedList,
  useLazyLoad,
  useLazyImage,
  usePerformanceMonitor,
  useBundlePreloader,
  useOptimizedSearch,
};