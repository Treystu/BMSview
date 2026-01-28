import { lazy, ComponentType, Suspense, memo, useMemo, useCallback } from 'react';
import { ErrorBoundary } from './errorBoundary';

/**
 * Bundle optimization utilities
 * Provides code splitting, lazy loading, and bundle size optimization
 */

export interface BundleAnalysis {
  totalSize: number;
  chunks: Array<{
    name: string;
    size: number;
    isLazy: boolean;
    dependencies: string[];
  }>;
  duplicateModules: string[];
  unusedExports: string[];
  optimizationSuggestions: string[];
}

export interface LazyComponentOptions {
  fallback?: React.ComponentType | React.ReactElement | null;
  errorBoundary?: boolean;
  preload?: boolean;
  retries?: number;
}

// Enhanced lazy loading with error handling and preloading
export function createLazyComponent<P = {}>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
  options: LazyComponentOptions = {}
): ComponentType<P> {
  const {
    fallback = null,
    errorBoundary = true,
    preload = false,
    retries = 3
  } = options;

  // Create lazy component with retry logic
  const LazyComponent = lazy(() => {
    let attempts = 0;

    const loadWithRetry = async (): Promise<{ default: ComponentType<P> }> => {
      try {
        return await importFn();
      } catch (error) {
        attempts++;
        if (attempts < retries) {
          console.warn(`[LazyComponent] Load attempt ${attempts} failed, retrying...`, error);
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 100));
          return loadWithRetry();
        }
        throw error;
      }
    };

    return loadWithRetry();
  });

  // Preload component if requested
  if (preload) {
    // Preload after a short delay to not block initial render
    setTimeout(() => {
      importFn().catch(console.warn);
    }, 100);
  }

  const WrappedComponent = memo((props: P) => {
    const fallbackElement = useMemo(() => {
      if (typeof fallback === 'function') {
        const FallbackComponent = fallback;
        return <FallbackComponent />;
      }
      return fallback;
    }, []);

    const lazyComponent = (
      <Suspense fallback={fallbackElement}>
        <LazyComponent {...props} />
      </Suspense>
    );

    if (errorBoundary) {
      return (
        <ErrorBoundary
          fallback={<div>Failed to load component. Please refresh the page.</div>}
        >
          {lazyComponent}
        </ErrorBoundary>
      );
    }

    return lazyComponent;
  });

  WrappedComponent.displayName = `LazyComponent(${LazyComponent.displayName || 'Anonymous'})`;

  // Add preload method to component
  (WrappedComponent as any).preload = () => importFn().catch(console.warn);

  return WrappedComponent;
}

// Component registry for dynamic imports
class ComponentRegistry {
  private components = new Map<string, () => Promise<any>>();
  private loadedComponents = new Set<string>();
  private loadingComponents = new Set<string>();

  register(name: string, importFn: () => Promise<any>): void {
    this.components.set(name, importFn);
  }

  async load(name: string): Promise<ComponentType<any> | null> {
    const importFn = this.components.get(name);
    if (!importFn) {
      console.warn(`[ComponentRegistry] Component "${name}" not found`);
      return null;
    }

    if (this.loadedComponents.has(name)) {
      return (await importFn()).default;
    }

    if (this.loadingComponents.has(name)) {
      // Wait for existing load to complete
      while (this.loadingComponents.has(name)) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return this.loadedComponents.has(name) ? (await importFn()).default : null;
    }

    try {
      this.loadingComponents.add(name);
      const module = await importFn();
      this.loadedComponents.add(name);
      return module.default;
    } catch (error) {
      console.error(`[ComponentRegistry] Failed to load component "${name}":`, error);
      return null;
    } finally {
      this.loadingComponents.delete(name);
    }
  }

  preload(names: string[]): Promise<void[]> {
    return Promise.all(
      names.map(name => this.load(name).catch(console.warn))
    );
  }

  getLoadedComponents(): string[] {
    return Array.from(this.loadedComponents);
  }
}

export const componentRegistry = new ComponentRegistry();

// Bundle size analyzer
export class BundleAnalyzer {
  private static resourceCache = new Map<string, PerformanceResourceTiming>();

  static async analyzeBundleSize(): Promise<BundleAnalysis> {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

    const jsResources = resources.filter(resource =>
      resource.name.includes('.js') || resource.name.includes('.mjs')
    );

    const chunks = jsResources.map(resource => ({
      name: this.extractFileName(resource.name),
      size: resource.transferSize || resource.decodedBodySize || 0,
      isLazy: this.isLazyChunk(resource.name),
      dependencies: this.extractDependencies(resource.name),
    }));

    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.size, 0);

    return {
      totalSize,
      chunks: chunks.sort((a, b) => b.size - a.size),
      duplicateModules: await this.findDuplicateModules(),
      unusedExports: await this.findUnusedExports(),
      optimizationSuggestions: this.generateOptimizationSuggestions(chunks, totalSize),
    };
  }

  private static extractFileName(url: string): string {
    return url.split('/').pop()?.split('?')[0] || url;
  }

  private static isLazyChunk(url: string): boolean {
    const fileName = this.extractFileName(url);
    return /\d+\.[a-f0-9]+\.js$/.test(fileName) || fileName.includes('chunk');
  }

  private static extractDependencies(url: string): string[] {
    // This would require build-time analysis in practice
    // For now, return common dependencies based on filename patterns
    const fileName = this.extractFileName(url);
    const dependencies: string[] = [];

    if (fileName.includes('vendor') || fileName.includes('react')) {
      dependencies.push('react', 'react-dom');
    }
    if (fileName.includes('chart')) {
      dependencies.push('chart.js');
    }

    return dependencies;
  }

  private static async findDuplicateModules(): Promise<string[]> {
    // In a real implementation, this would analyze the module graph
    // For now, return common duplicate patterns
    return [
      'moment', // Often duplicated, should use date-fns instead
      'lodash', // If both lodash and lodash-es are used
    ];
  }

  private static async findUnusedExports(): Promise<string[]> {
    // This would require static analysis of the codebase
    // For now, return common unused patterns
    return [];
  }

  private static generateOptimizationSuggestions(
    chunks: Array<{ name: string; size: number; isLazy: boolean }>,
    totalSize: number
  ): string[] {
    const suggestions: string[] = [];

    // Large bundle warning
    if (totalSize > 1024 * 1024) { // 1MB
      suggestions.push('Bundle size is large (>1MB). Consider code splitting.');
    }

    // Large chunks
    const largeChunks = chunks.filter(chunk => chunk.size > 500 * 1024); // 500KB
    if (largeChunks.length > 0) {
      suggestions.push(`Large chunks detected: ${largeChunks.map(c => c.name).join(', ')}`);
    }

    // Few lazy chunks
    const lazyChunks = chunks.filter(chunk => chunk.isLazy);
    if (lazyChunks.length < 3) {
      suggestions.push('Consider implementing more lazy loading for routes and components.');
    }

    // Vendor chunk optimization
    const vendorChunk = chunks.find(chunk => chunk.name.includes('vendor'));
    if (!vendorChunk) {
      suggestions.push('Consider separating vendor dependencies into a separate chunk.');
    } else if (vendorChunk.size > 800 * 1024) { // 800KB
      suggestions.push('Vendor chunk is large. Consider splitting by vendor or usage frequency.');
    }

    return suggestions;
  }

  static logAnalysis(): void {
    if (process.env.NODE_ENV !== 'development') {
      return;
    }

    this.analyzeBundleSize().then(analysis => {
      console.group('📦 Bundle Analysis');
      console.log(`Total Size: ${(analysis.totalSize / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Chunks: ${analysis.chunks.length}`);
      console.log(`Lazy Chunks: ${analysis.chunks.filter(c => c.isLazy).length}`);

      if (analysis.chunks.length > 0) {
        console.table(analysis.chunks.map(chunk => ({
          name: chunk.name,
          size: `${(chunk.size / 1024).toFixed(1)}KB`,
          lazy: chunk.isLazy,
        })));
      }

      if (analysis.duplicateModules.length > 0) {
        console.warn('Duplicate Modules:', analysis.duplicateModules);
      }

      if (analysis.optimizationSuggestions.length > 0) {
        console.group('💡 Optimization Suggestions');
        analysis.optimizationSuggestions.forEach(suggestion => console.log(suggestion));
        console.groupEnd();
      }

      console.groupEnd();
    }).catch(console.error);
  }
}

// Tree shaking utilities
export const TreeShakingUtils = {
  // Helper to create tree-shakeable exports
  createSelectiveExport<T extends Record<string, any>>(
    source: T,
    whitelist: (keyof T)[]
  ): Pick<T, keyof T> {
    const result = {} as Pick<T, keyof T>;
    whitelist.forEach(key => {
      if (key in source) {
        result[key] = source[key];
      }
    });
    return result;
  },

  // Mark functions for tree shaking
  markForTreeShaking: (exportName: string) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[TreeShaking] Export "${exportName}" marked for potential removal`);
    }
  },
};

// Module preloader for critical resources
export class ModulePreloader {
  private static preloadedModules = new Set<string>();
  private static preloadPromises = new Map<string, Promise<any>>();

  static preloadModule(importFn: () => Promise<any>, name?: string): Promise<any> {
    const moduleName = name || importFn.toString();

    if (this.preloadPromises.has(moduleName)) {
      return this.preloadPromises.get(moduleName)!;
    }

    const promise = importFn()
      .then(module => {
        this.preloadedModules.add(moduleName);
        return module;
      })
      .catch(error => {
        console.warn(`[ModulePreloader] Failed to preload module ${moduleName}:`, error);
        throw error;
      });

    this.preloadPromises.set(moduleName, promise);
    return promise;
  }

  static preloadCriticalModules(): void {
    // Preload modules that are likely to be needed soon
    const criticalModules = [
      () => import('../components/AnalysisResults/AnalysisResults'),
      () => import('../components/FileUpload/FileUpload'),
    ];

    criticalModules.forEach((importFn, index) => {
      // Stagger preloading to avoid blocking
      setTimeout(() => {
        this.preloadModule(importFn, `critical-${index}`).catch(() => {});
      }, index * 100);
    });
  }

  static isPreloaded(name: string): boolean {
    return this.preloadedModules.has(name);
  }

  static getPreloadedModules(): string[] {
    return Array.from(this.preloadedModules);
  }
}

// Code splitting helpers
export const CodeSplittingHelpers = {
  // Create route-based lazy component
  createRouteComponent<P = {}>(
    importFn: () => Promise<{ default: ComponentType<P> }>,
    options: LazyComponentOptions = {}
  ): ComponentType<P> {
    return createLazyComponent(importFn, {
      fallback: <div className="loading-route">Loading page...</div>,
      errorBoundary: true,
      preload: false,
      retries: 2,
      ...options,
    });
  },

  // Create feature-based lazy component
  createFeatureComponent<P = {}>(
    importFn: () => Promise<{ default: ComponentType<P> }>,
    options: LazyComponentOptions = {}
  ): ComponentType<P> {
    return createLazyComponent(importFn, {
      fallback: <div className="loading-feature">Loading feature...</div>,
      errorBoundary: true,
      preload: true, // Preload features for better UX
      retries: 3,
      ...options,
    });
  },

  // Dynamic import with caching
  dynamicImport: <T = any>(
    importFn: () => Promise<T>,
    cacheKey?: string
  ): Promise<T> => {
    const key = cacheKey || importFn.toString();
    return ModulePreloader.preloadModule(importFn, key);
  },
};

// Performance monitoring for lazy loading
export const LazyLoadingMonitor = {
  trackLazyLoad: (componentName: string, startTime: number) => {
    const loadTime = performance.now() - startTime;

    if (process.env.NODE_ENV === 'development') {
      if (loadTime > 1000) {
        console.warn(`[LazyLoading] Slow load for ${componentName}: ${loadTime.toFixed(2)}ms`);
      } else {
        console.debug(`[LazyLoading] Loaded ${componentName} in ${loadTime.toFixed(2)}ms`);
      }
    }

    // Could send to analytics in production
    return loadTime;
  },

  measureLazyLoadSuccess: (componentName: string) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[LazyLoading] Successfully loaded ${componentName}`);
    }
  },

  measureLazyLoadFailure: (componentName: string, error: Error) => {
    console.error(`[LazyLoading] Failed to load ${componentName}:`, error);
    // Could send to error tracking service
  },
};

// Initialize bundle analysis in development
if (process.env.NODE_ENV === 'development') {
  // Run analysis after page load
  window.addEventListener('load', () => {
    setTimeout(() => {
      BundleAnalyzer.logAnalysis();
    }, 2000); // Wait for all resources to load
  });
}

export default {
  createLazyComponent,
  componentRegistry,
  BundleAnalyzer,
  TreeShakingUtils,
  ModulePreloader,
  CodeSplittingHelpers,
  LazyLoadingMonitor,
};