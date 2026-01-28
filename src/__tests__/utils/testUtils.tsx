import React, { ReactElement } from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppStateProvider } from '../../state/enhancedAppState';
import type { AppState } from '../../state/enhancedAppState';
import { initialState } from '../../state/enhancedAppState';
import { ErrorBoundary } from '../../utils/errorBoundary';

/**
 * Test utilities for React Testing Library with proper providers
 */

// Mock console methods for cleaner test output
const originalError = console.error;
const originalWarn = console.warn;

export const suppressConsoleErrors = () => {
  console.error = jest.fn();
  console.warn = jest.fn();
};

export const restoreConsole = () => {
  console.error = originalError;
  console.warn = originalWarn;
};

// Create a test query client
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        cacheTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

// Custom render function with all providers
interface CustomRenderOptions extends Omit<RenderOptions, 'queries'> {
  initialState?: Partial<AppState>;
  queryClient?: QueryClient;
  withErrorBoundary?: boolean;
}

function AllTheProviders({
  children,
  queryClient,
  initialAppState,
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
  initialAppState?: Partial<AppState>;
}) {
  // If we have initial state, we'd need to mock the context provider
  // For now, we'll use the default state and update via actions if needed
  return (
    <QueryClientProvider client={queryClient}>
      <AppStateProvider>
        <ErrorBoundary>{children}</ErrorBoundary>
      </AppStateProvider>
    </QueryClientProvider>
  );
}

const customRender = (
  ui: ReactElement,
  options: CustomRenderOptions = {}
): RenderResult => {
  const {
    initialState: initialAppState,
    queryClient = createTestQueryClient(),
    withErrorBoundary = true,
    ...renderOptions
  } = options;

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <AllTheProviders queryClient={queryClient} initialAppState={initialAppState}>
      {children}
    </AllTheProviders>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
};

// Re-export everything from testing-library
export * from '@testing-library/react';
export { customRender as render };

// Test data factories
export const createMockAnalysisData = (overrides = {}) => ({
  systemId: 'test-system-1',
  hardwareSystemId: 'hw-123',
  timestampFromImage: '2024-01-15T10:30:00Z',
  status: 'OK',
  overallVoltage: 25.6,
  power: 150.5,
  current: 5.8,
  stateOfCharge: 85,
  remainingCapacity: 95.5,
  fullCapacity: 100,
  cycleCount: 45,
  temperature: 22.5,
  temperatures: [22.5, 23.1, 21.8],
  mosTemperature: 28.3,
  chargeMosOn: true,
  dischargeMosOn: true,
  balanceOn: false,
  serialNumber: 'BMS001234',
  softwareVersion: 'v1.2.3',
  hardwareVersion: 'v2.1',
  snCode: 'SN123456',
  numTempSensors: 3,
  cellVoltages: [3.20, 3.21, 3.19, 3.22, 3.18, 3.23, 3.17, 3.24],
  highestCellVoltage: 3.24,
  lowestCellVoltage: 3.17,
  cellVoltageDifference: 0.07,
  averageCellVoltage: 3.205,
  alerts: ['Cell voltage difference high'],
  summary: 'Battery system operating normally with minor cell imbalance.',
  ...overrides,
});

export const createMockBmsSystem = (overrides = {}) => ({
  id: 'test-system-1',
  name: 'Test BMS System',
  chemistry: 'LiFePO4',
  voltage: 24,
  capacity: 100,
  latitude: 37.7749,
  longitude: -122.4194,
  associatedHardwareIds: ['hw-123', 'hw-456'],
  maxAmpsSolarCharging: 50,
  maxAmpsGeneratorCharging: 80,
  ...overrides,
});

export const createMockAnalysisRecord = (overrides = {}) => ({
  id: 'record-123',
  timestamp: '2024-01-15T10:30:00Z',
  systemId: 'test-system-1',
  systemName: 'Test BMS System',
  analysis: createMockAnalysisData(),
  weather: {
    temp: 22,
    clouds: 25,
    uvi: 6.5,
    weather_main: 'Clear',
    weather_icon: '01d',
    estimated_irradiance_w_m2: 850,
  },
  hardwareSystemId: 'hw-123',
  fileName: 'test-screenshot.jpg',
  needsReview: false,
  validationWarnings: [],
  validationScore: 95,
  extractionAttempts: 1,
  wasUpgraded: false,
  updatedAt: '2024-01-15T10:30:00Z',
  ...overrides,
});

export const createMockDisplayableAnalysisResult = (overrides = {}) => ({
  fileName: 'test-screenshot.jpg',
  data: createMockAnalysisData(),
  error: null,
  saveError: null,
  weather: {
    temp: 22,
    clouds: 25,
    uvi: 6.5,
    weather_main: 'Clear',
    weather_icon: '01d',
    estimated_irradiance_w_m2: 850,
  },
  isDuplicate: false,
  isBatchDuplicate: false,
  recordId: 'record-123',
  submittedAt: Date.now(),
  needsReview: false,
  validationWarnings: [],
  ...overrides,
});

export const createMockError = (overrides = {}) => ({
  message: 'Test error message',
  type: 'CLIENT',
  severity: 'MEDIUM',
  code: 400,
  timestamp: new Date().toISOString(),
  retryable: false,
  userMessage: 'A test error occurred',
  ...overrides,
});

// Test helpers for async operations
export const waitForNextUpdate = () => new Promise((resolve) => setTimeout(resolve, 0));

export const mockFetch = (response: unknown, options: { status?: number; ok?: boolean } = {}) => {
  const { status = 200, ok = true } = options;

  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
    headers: new Headers(),
    statusText: ok ? 'OK' : 'Error',
    url: 'http://test.com',
    type: 'basic',
    redirected: false,
    body: null,
    bodyUsed: false,
    clone: jest.fn(),
  });
};

export const mockFailedFetch = (error: Error) => {
  global.fetch = jest.fn().mockRejectedValue(error);
};

// Custom matchers
export const customMatchers = {
  toHaveValidationError: (received: unknown, fieldName: string) => {
    const pass = Array.isArray(received) &&
                  received.some((error) => error.field === fieldName);

    return {
      pass,
      message: () => pass
        ? `Expected validation errors to not contain field "${fieldName}"`
        : `Expected validation errors to contain field "${fieldName}"`,
    };
  },

  toBeWithinPercentage: (received: number, expected: number, percentage: number) => {
    const diff = Math.abs(received - expected);
    const tolerance = Math.abs(expected * (percentage / 100));
    const pass = diff <= tolerance;

    return {
      pass,
      message: () => pass
        ? `Expected ${received} not to be within ${percentage}% of ${expected}`
        : `Expected ${received} to be within ${percentage}% of ${expected}`,
    };
  },
};

// Setup and teardown helpers
export const setupTestEnvironment = () => {
  // Mock window.location
  delete (window as any).location;
  window.location = {
    ...window.location,
    pathname: '/',
    href: 'http://localhost:3000/',
    search: '',
    hash: '',
  };

  // Mock performance API
  global.performance = {
    ...global.performance,
    now: jest.fn(() => Date.now()),
    mark: jest.fn(),
    measure: jest.fn(),
  };

  // Mock ResizeObserver
  global.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));

  // Mock IntersectionObserver
  global.IntersectionObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));

  // Suppress console warnings in tests
  suppressConsoleErrors();
};

export const teardownTestEnvironment = () => {
  restoreConsole();
  jest.clearAllMocks();
  jest.restoreAllMocks();
};

// Test data generators
export const generateMockData = {
  analysisRecords: (count: number) =>
    Array.from({ length: count }, (_, i) =>
      createMockAnalysisRecord({
        id: `record-${i}`,
        timestamp: new Date(Date.now() - i * 60000).toISOString(),
      })
    ),

  bmsSystems: (count: number) =>
    Array.from({ length: count }, (_, i) =>
      createMockBmsSystem({
        id: `system-${i}`,
        name: `Test System ${i + 1}`,
      })
    ),

  cellVoltages: (count: number, baseVoltage = 3.2) =>
    Array.from({ length: count }, (_, i) =>
      baseVoltage + (Math.random() - 0.5) * 0.1
    ),

  timeSeriesData: (count: number, startTime = Date.now()) =>
    Array.from({ length: count }, (_, i) => ({
      timestamp: new Date(startTime - i * 60000).toISOString(),
      value: 50 + Math.sin(i * 0.1) * 20 + (Math.random() - 0.5) * 10,
    })),
};

// Performance testing helpers
export const measureRenderTime = async (renderFn: () => void): Promise<number> => {
  const start = performance.now();
  renderFn();
  await waitForNextUpdate();
  return performance.now() - start;
};

export const expectRenderTimeUnder = async (
  renderFn: () => void,
  maxTimeMs: number
): Promise<void> => {
  const renderTime = await measureRenderTime(renderFn);
  expect(renderTime).toBeLessThan(maxTimeMs);
};

// Accessibility testing helpers
export const checkA11y = async (container: HTMLElement): Promise<void> => {
  const { axe, toHaveNoViolations } = await import('jest-axe');
  expect.extend(toHaveNoViolations);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
};

export default {
  render: customRender,
  createTestQueryClient,
  customMatchers,
  setupTestEnvironment,
  teardownTestEnvironment,
  mockFetch,
  mockFailedFetch,
  waitForNextUpdate,
  measureRenderTime,
  expectRenderTimeUnder,
  checkA11y,
  generateMockData,
  createMockAnalysisData,
  createMockBmsSystem,
  createMockAnalysisRecord,
  createMockDisplayableAnalysisResult,
  createMockError,
};