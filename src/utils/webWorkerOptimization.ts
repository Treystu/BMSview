/**
 * Web Worker optimization utilities
 * Provides background processing for CPU-intensive tasks
 */

export interface WorkerTask<T = any, R = any> {
  id: string;
  type: string;
  data: T;
  resolve: (result: R) => void;
  reject: (error: Error) => void;
  timestamp: number;
  timeout?: number;
}

export interface WorkerMessage<T = any> {
  id: string;
  type: string;
  data: T;
  error?: string;
}

// Generic worker pool manager
export class WorkerPool {
  private workers: Worker[] = [];
  private taskQueue: WorkerTask[] = [];
  private activeTasks = new Map<string, WorkerTask>();
  private workerIndex = 0;
  private maxWorkers: number;

  constructor(
    workerScript: string | (() => Worker),
    maxWorkers: number = navigator.hardwareConcurrency || 4
  ) {
    this.maxWorkers = Math.min(maxWorkers, 8); // Cap at 8 workers
    this.initializeWorkers(workerScript);
  }

  private initializeWorkers(workerScript: string | (() => Worker)): void {
    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = typeof workerScript === 'function'
        ? workerScript()
        : new Worker(workerScript);

      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        this.handleWorkerMessage(event.data);
      };

      worker.onerror = (error) => {
        console.error('[WorkerPool] Worker error:', error);
        this.handleWorkerError(error);
      };

      this.workers.push(worker);
    }
  }

  private handleWorkerMessage(message: WorkerMessage): void {
    const task = this.activeTasks.get(message.id);
    if (!task) {
      console.warn('[WorkerPool] Received message for unknown task:', message.id);
      return;
    }

    this.activeTasks.delete(message.id);

    if (message.error) {
      task.reject(new Error(message.error));
    } else {
      task.resolve(message.data);
    }

    // Process next task in queue
    this.processNextTask();
  }

  private handleWorkerError(error: ErrorEvent): void {
    // Find and reject all active tasks for this worker
    for (const [id, task] of this.activeTasks) {
      task.reject(new Error(`Worker error: ${error.message}`));
    }
    this.activeTasks.clear();
  }

  private processNextTask(): void {
    if (this.taskQueue.length === 0) {
      return;
    }

    const task = this.taskQueue.shift()!;
    const worker = this.getNextWorker();

    this.activeTasks.set(task.id, task);

    // Set up timeout if specified
    if (task.timeout) {
      setTimeout(() => {
        if (this.activeTasks.has(task.id)) {
          this.activeTasks.delete(task.id);
          task.reject(new Error(`Task ${task.id} timed out after ${task.timeout}ms`));
        }
      }, task.timeout);
    }

    worker.postMessage({
      id: task.id,
      type: task.type,
      data: task.data,
    });
  }

  private getNextWorker(): Worker {
    const worker = this.workers[this.workerIndex];
    this.workerIndex = (this.workerIndex + 1) % this.workers.length;
    return worker;
  }

  public async execute<T, R>(
    type: string,
    data: T,
    timeout?: number
  ): Promise<R> {
    return new Promise((resolve, reject) => {
      const task: WorkerTask<T, R> = {
        id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type,
        data,
        resolve,
        reject,
        timestamp: Date.now(),
        timeout,
      };

      this.taskQueue.push(task);

      // Try to process immediately if workers are available
      if (this.activeTasks.size < this.maxWorkers) {
        this.processNextTask();
      }
    });
  }

  public getStats(): {
    activeWorkers: number;
    queuedTasks: number;
    activeTasks: number;
  } {
    return {
      activeWorkers: this.workers.length,
      queuedTasks: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
    };
  }

  public terminate(): void {
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];
    this.activeTasks.clear();
    this.taskQueue = [];
  }
}

// Specific worker implementations
export const DataProcessingWorker = () => new Worker(
  new URL('../workers/dataProcessingWorker.ts', import.meta.url),
  { type: 'module' }
);

export const ImageAnalysisWorker = () => new Worker(
  new URL('../workers/imageAnalysisWorker.ts', import.meta.url),
  { type: 'module' }
);

export const CalculationWorker = () => new Worker(
  new URL('../workers/calculationWorker.ts', import.meta.url),
  { type: 'module' }
);

// Pre-configured worker pools
class WorkerPoolManager {
  private static instance: WorkerPoolManager;
  private pools = new Map<string, WorkerPool>();

  static getInstance(): WorkerPoolManager {
    if (!this.instance) {
      this.instance = new WorkerPoolManager();
    }
    return this.instance;
  }

  getPool(name: string, workerFactory?: () => Worker, maxWorkers?: number): WorkerPool {
    if (!this.pools.has(name)) {
      if (!workerFactory) {
        throw new Error(`Worker factory required for new pool: ${name}`);
      }
      this.pools.set(name, new WorkerPool(workerFactory, maxWorkers));
    }
    return this.pools.get(name)!;
  }

  terminatePool(name: string): void {
    const pool = this.pools.get(name);
    if (pool) {
      pool.terminate();
      this.pools.delete(name);
    }
  }

  terminateAllPools(): void {
    for (const [name, pool] of this.pools) {
      pool.terminate();
    }
    this.pools.clear();
  }

  getPoolStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    for (const [name, pool] of this.pools) {
      stats[name] = pool.getStats();
    }
    return stats;
  }
}

export const workerPoolManager = WorkerPoolManager.getInstance();

// High-level worker utilities
export const WorkerUtils = {
  // Process large datasets in chunks
  processLargeDataset: async <T, R>(
    data: T[],
    processor: (chunk: T[]) => R[],
    chunkSize = 1000,
    workerType = 'dataProcessing'
  ): Promise<R[]> => {
    const pool = workerPoolManager.getPool(workerType, DataProcessingWorker, 2);
    const chunks: T[][] = [];

    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }

    const results = await Promise.all(
      chunks.map((chunk, index) =>
        pool.execute('processChunk', {
          chunk,
          processor: processor.toString(),
          chunkIndex: index,
        })
      )
    );

    return results.flat();
  },

  // Perform heavy calculations
  calculate: async <T>(
    operation: string,
    data: T,
    timeout = 30000
  ): Promise<any> => {
    const pool = workerPoolManager.getPool('calculation', CalculationWorker, 1);
    return pool.execute('calculate', { operation, data }, timeout);
  },

  // Analyze images
  analyzeImage: async (
    imageData: ImageData | ArrayBuffer,
    analysisType: string,
    options: Record<string, any> = {}
  ): Promise<any> => {
    const pool = workerPoolManager.getPool('imageAnalysis', ImageAnalysisWorker, 2);
    return pool.execute('analyzeImage', {
      imageData,
      analysisType,
      options,
    }, 60000); // 1 minute timeout for image analysis
  },

  // Sort large arrays
  sortLargeArray: async <T>(
    data: T[],
    compareFn?: (a: T, b: T) => number,
    algorithm = 'quicksort'
  ): Promise<T[]> => {
    const pool = workerPoolManager.getPool('dataProcessing', DataProcessingWorker, 1);
    return pool.execute('sortArray', {
      data,
      compareFn: compareFn?.toString(),
      algorithm,
    }, 120000); // 2 minute timeout for large sorts
  },

  // Filter large datasets
  filterLargeDataset: async <T>(
    data: T[],
    filterFn: (item: T) => boolean,
    chunkSize = 10000
  ): Promise<T[]> => {
    return WorkerUtils.processLargeDataset(
      data,
      (chunk) => chunk.filter(filterFn),
      chunkSize,
      'dataProcessing'
    );
  },

  // Map over large datasets
  mapLargeDataset: async <T, R>(
    data: T[],
    mapFn: (item: T, index: number) => R,
    chunkSize = 10000
  ): Promise<R[]> => {
    return WorkerUtils.processLargeDataset(
      data,
      (chunk) => chunk.map(mapFn),
      chunkSize,
      'dataProcessing'
    );
  },
};

// Background task scheduler
export class BackgroundTaskScheduler {
  private static instance: BackgroundTaskScheduler;
  private queue: Array<() => Promise<void>> = [];
  private isProcessing = false;
  private maxConcurrent = 2;
  private activeTasks = 0;

  static getInstance(): BackgroundTaskScheduler {
    if (!this.instance) {
      this.instance = new BackgroundTaskScheduler();
    }
    return this.instance;
  }

  schedule(task: () => Promise<void>, priority = 0): void {
    this.queue.push(task);
    this.queue.sort((a, b) => b.priority - a.priority); // Higher priority first
    this.processQueue();
  }

  private async processQueue(): void {
    if (this.isProcessing || this.activeTasks >= this.maxConcurrent) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0 && this.activeTasks < this.maxConcurrent) {
      const task = this.queue.shift()!;
      this.activeTasks++;

      this.executeTask(task).finally(() => {
        this.activeTasks--;
        this.processQueue();
      });
    }

    this.isProcessing = false;
  }

  private async executeTask(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (error) {
      console.error('[BackgroundTaskScheduler] Task failed:', error);
    }
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getActiveTasks(): number {
    return this.activeTasks;
  }
}

export const backgroundScheduler = BackgroundTaskScheduler.getInstance();

// React hooks for worker integration
import { useEffect, useRef, useState } from 'react';

export function useWorkerTask<T, R>(
  workerType: string,
  workerFactory: () => Worker
) {
  const poolRef = useRef<WorkerPool>();

  useEffect(() => {
    poolRef.current = workerPoolManager.getPool(workerType, workerFactory, 1);

    return () => {
      if (poolRef.current) {
        workerPoolManager.terminatePool(workerType);
      }
    };
  }, [workerType, workerFactory]);

  const executeTask = async (type: string, data: T, timeout?: number): Promise<R> => {
    if (!poolRef.current) {
      throw new Error('Worker pool not initialized');
    }
    return poolRef.current.execute<T, R>(type, data, timeout);
  };

  return { executeTask };
}

export function useBackgroundTask() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [queueSize, setQueueSize] = useState(0);

  const scheduleTask = (task: () => Promise<void>, priority = 0) => {
    backgroundScheduler.schedule(async () => {
      setIsProcessing(true);
      try {
        await task();
      } finally {
        setIsProcessing(false);
        setQueueSize(backgroundScheduler.getQueueSize());
      }
    }, priority);
    setQueueSize(backgroundScheduler.getQueueSize());
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setQueueSize(backgroundScheduler.getQueueSize());
      setIsProcessing(backgroundScheduler.getActiveTasks() > 0);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return {
    scheduleTask,
    isProcessing,
    queueSize,
  };
}

export default {
  WorkerPool,
  workerPoolManager,
  WorkerUtils,
  backgroundScheduler,
  DataProcessingWorker,
  ImageAnalysisWorker,
  CalculationWorker,
  useWorkerTask,
  useBackgroundTask,
};