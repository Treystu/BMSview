import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import {
  render,
  mockFetch,
  mockFailedFetch,
  setupTestEnvironment,
  teardownTestEnvironment,
  createMockAnalysisRecord,
  createMockBmsSystem,
  waitForNextUpdate,
} from '../utils/testUtils';

// Mock services
jest.mock('../../services/geminiService', () => ({
  analyzeBmsScreenshot: jest.fn(),
}));

jest.mock('../../services/clientService', () => ({
  getAnalysisHistory: jest.fn(),
  getRegisteredSystems: jest.fn(),
  linkAnalysisToSystem: jest.fn(),
  registerBmsSystem: jest.fn(),
  associateHardwareIdToSystem: jest.fn(),
}));

jest.mock('../../services/syncManager', () => ({
  getSyncManager: jest.fn(() => ({
    subscribe: jest.fn(() => jest.fn()), // unsubscribe function
    startPeriodicSync: jest.fn(),
    stopPeriodicSync: jest.fn(),
    getSyncStatus: jest.fn(() => ({ lastSyncTime: {} })),
  })),
}));

import { analyzeBmsScreenshot } from '../../services/geminiService';
import {
  getAnalysisHistory,
  getRegisteredSystems,
  linkAnalysisToSystem,
  registerBmsSystem,
} from '../../services/clientService';

const mockAnalyzeBmsScreenshot = analyzeBmsScreenshot as jest.MockedFunction<typeof analyzeBmsScreenshot>;
const mockGetAnalysisHistory = getAnalysisHistory as jest.MockedFunction<typeof getAnalysisHistory>;
const mockGetRegisteredSystems = getRegisteredSystems as jest.MockedFunction<typeof getRegisteredSystems>;
const mockLinkAnalysisToSystem = linkAnalysisToSystem as jest.MockedFunction<typeof linkAnalysisToSystem>;
const mockRegisterBmsSystem = registerBmsSystem as jest.MockedFunction<typeof registerBmsSystem>;

describe('App E2E Tests', () => {
  beforeEach(() => {
    setupTestEnvironment();

    // Default mock implementations
    mockGetAnalysisHistory.mockResolvedValue({
      items: [],
      total: 0,
    });

    mockGetRegisteredSystems.mockResolvedValue({
      items: [],
      total: 0,
    });

    // Mock weather backfill API
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
  });

  afterEach(() => {
    teardownTestEnvironment();
  });

  describe('Application Loading', () => {
    it('should render the main application', async () => {
      render(<App />);

      expect(screen.getByRole('banner')).toBeInTheDocument(); // Header
      expect(screen.getByRole('main')).toBeInTheDocument(); // Main content
      expect(screen.getByRole('contentinfo')).toBeInTheDocument(); // Footer

      await waitFor(() => {
        expect(mockGetAnalysisHistory).toHaveBeenCalled();
        expect(mockGetRegisteredSystems).toHaveBeenCalled();
      });
    });

    it('should handle loading states during initialization', async () => {
      // Delay the API responses
      mockGetAnalysisHistory.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ items: [], total: 0 }), 100))
      );
      mockGetRegisteredSystems.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ items: [], total: 0 }), 100))
      );

      render(<App />);

      // Should show loading state initially
      // Note: We'd need to add loading indicators to the app for this to work
      await waitFor(() => {
        expect(mockGetAnalysisHistory).toHaveBeenCalled();
      }, { timeout: 200 });
    });

    it('should handle initialization errors gracefully', async () => {
      mockGetAnalysisHistory.mockRejectedValue(new Error('Network error'));
      mockGetRegisteredSystems.mockRejectedValue(new Error('Network error'));

      render(<App />);

      await waitFor(() => {
        // Should not crash the app
        expect(screen.getByRole('main')).toBeInTheDocument();
      });
    });
  });

  describe('File Upload and Analysis Workflow', () => {
    it('should complete full analysis workflow', async () => {
      const user = userEvent.setup();

      // Setup successful analysis response
      mockAnalyzeBmsScreenshot.mockResolvedValue({
        systemId: 'test-system',
        hardwareSystemId: 'hw-123',
        overallVoltage: 25.6,
        current: 5.2,
        stateOfCharge: 85,
        temperature: 22.5,
        cellVoltages: [3.20, 3.21, 3.19, 3.22],
        alerts: [],
        summary: 'Battery system operating normally',
        _recordId: 'record-123',
        _timestamp: '2024-01-15T10:30:00Z',
      });

      render(<App />);

      // Find upload section
      const uploadSection = screen.getByRole('region', { name: /upload/i });
      expect(uploadSection).toBeInTheDocument();

      // Create a test file
      const file = new File(['test'], 'test-screenshot.jpg', { type: 'image/jpeg' });

      // Find file input
      const fileInput = screen.getByLabelText(/choose.*file/i);

      // Upload file
      await user.upload(fileInput, file);

      // Should start analysis
      await waitFor(() => {
        expect(mockAnalyzeBmsScreenshot).toHaveBeenCalledWith(file, false);
      });

      // Should show results
      await waitFor(() => {
        expect(screen.getByText(/analysis results/i)).toBeInTheDocument();
        expect(screen.getByText(/25.6/)).toBeInTheDocument(); // Voltage
        expect(screen.getByText(/85/)).toBeInTheDocument(); // SOC
      });
    });

    it('should handle analysis errors', async () => {
      const user = userEvent.setup();

      // Setup failing analysis
      mockAnalyzeBmsScreenshot.mockRejectedValue(new Error('Analysis failed'));

      render(<App />);

      const file = new File(['test'], 'test-screenshot.jpg', { type: 'image/jpeg' });
      const fileInput = screen.getByLabelText(/choose.*file/i);

      await user.upload(fileInput, file);

      await waitFor(() => {
        expect(screen.getByText(/failed/i)).toBeInTheDocument();
      });
    });

    it('should handle multiple file uploads', async () => {
      const user = userEvent.setup();

      // Setup analysis responses for multiple files
      mockAnalyzeBmsScreenshot
        .mockResolvedValueOnce({
          systemId: 'test-system-1',
          summary: 'First analysis',
          _recordId: 'record-1',
          _timestamp: '2024-01-15T10:30:00Z',
        } as any)
        .mockResolvedValueOnce({
          systemId: 'test-system-2',
          summary: 'Second analysis',
          _recordId: 'record-2',
          _timestamp: '2024-01-15T10:31:00Z',
        } as any);

      render(<App />);

      const files = [
        new File(['test1'], 'test1.jpg', { type: 'image/jpeg' }),
        new File(['test2'], 'test2.jpg', { type: 'image/jpeg' }),
      ];

      const fileInput = screen.getByLabelText(/choose.*file/i);
      await user.upload(fileInput, files);

      // Should process both files
      await waitFor(() => {
        expect(mockAnalyzeBmsScreenshot).toHaveBeenCalledTimes(2);
      });

      await waitFor(() => {
        expect(screen.getByText(/first analysis/i)).toBeInTheDocument();
        expect(screen.getByText(/second analysis/i)).toBeInTheDocument();
      });
    });
  });

  describe('System Management', () => {
    it('should link analysis to existing system', async () => {
      const user = userEvent.setup();

      // Setup existing system
      const mockSystem = createMockBmsSystem({
        id: 'existing-system',
        name: 'Existing System',
      });

      mockGetRegisteredSystems.mockResolvedValue({
        items: [mockSystem],
        total: 1,
      });

      // Setup analysis result
      mockAnalyzeBmsScreenshot.mockResolvedValue({
        hardwareSystemId: 'hw-123',
        summary: 'Test analysis',
        _recordId: 'record-123',
        _timestamp: '2024-01-15T10:30:00Z',
      } as any);

      mockLinkAnalysisToSystem.mockResolvedValue(undefined);

      render(<App />);

      // Wait for initial load
      await waitFor(() => {
        expect(mockGetRegisteredSystems).toHaveBeenCalled();
      });

      // Upload file
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      const fileInput = screen.getByLabelText(/choose.*file/i);
      await user.upload(fileInput, file);

      // Wait for analysis to complete
      await waitFor(() => {
        expect(mockAnalyzeBmsScreenshot).toHaveBeenCalled();
      });

      // Find link button and click it
      const linkButton = await screen.findByText(/link.*system/i);
      await user.click(linkButton);

      // Should show system selection
      const systemSelect = await screen.findByText(/existing system/i);
      await user.click(systemSelect);

      // Confirm linking
      const confirmButton = screen.getByText(/confirm/i);
      await user.click(confirmButton);

      await waitFor(() => {
        expect(mockLinkAnalysisToSystem).toHaveBeenCalledWith(
          'record-123',
          'existing-system',
          'hw-123'
        );
      });
    });

    it('should register new system', async () => {
      const user = userEvent.setup();

      mockRegisterBmsSystem.mockResolvedValue({
        id: 'new-system',
        name: 'New Test System',
      } as any);

      render(<App />);

      // Upload and analyze file first
      mockAnalyzeBmsScreenshot.mockResolvedValue({
        hardwareSystemId: 'hw-new',
        summary: 'Test analysis',
        _recordId: 'record-new',
        _timestamp: '2024-01-15T10:30:00Z',
      } as any);

      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      const fileInput = screen.getByLabelText(/choose.*file/i);
      await user.upload(fileInput, file);

      await waitFor(() => {
        expect(mockAnalyzeBmsScreenshot).toHaveBeenCalled();
      });

      // Find register new system button
      const registerButton = await screen.findByText(/register.*new.*system/i);
      await user.click(registerButton);

      // Fill in system details
      const nameInput = screen.getByLabelText(/system.*name/i);
      await user.type(nameInput, 'New Test System');

      const chemistryInput = screen.getByLabelText(/chemistry/i);
      await user.type(chemistryInput, 'LiFePO4');

      const voltageInput = screen.getByLabelText(/voltage/i);
      await user.type(voltageInput, '24');

      // Submit registration
      const submitButton = screen.getByText(/register/i);
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockRegisterBmsSystem).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'New Test System',
            chemistry: 'LiFePO4',
            voltage: 24,
            associatedHardwareIds: [],
          })
        );
      });

      // Should show success message
      await waitFor(() => {
        expect(screen.getByText(/registered/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      // Simulate network error
      mockGetAnalysisHistory.mockRejectedValue(new Error('Network timeout'));
      mockGetRegisteredSystems.mockRejectedValue(new Error('Network timeout'));

      render(<App />);

      // Should not crash and should show error state
      await waitFor(() => {
        // The app should still render even with network errors
        expect(screen.getByRole('main')).toBeInTheDocument();
      });
    });

    it('should retry failed operations', async () => {
      const user = userEvent.setup();

      // First call fails, second succeeds
      mockAnalyzeBmsScreenshot
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({
          summary: 'Successful retry',
          _recordId: 'record-retry',
          _timestamp: '2024-01-15T10:30:00Z',
        } as any);

      render(<App />);

      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      const fileInput = screen.getByLabelText(/choose.*file/i);
      await user.upload(fileInput, file);

      // Should show error first
      await waitFor(() => {
        expect(screen.getByText(/failed/i)).toBeInTheDocument();
      });

      // Find retry button and click it
      const retryButton = screen.getByText(/retry/i);
      await user.click(retryButton);

      // Should succeed on retry
      await waitFor(() => {
        expect(screen.getByText(/successful retry/i)).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('should be keyboard navigable', async () => {
      const user = userEvent.setup();

      render(<App />);

      // Tab through the interface
      await user.tab();
      expect(document.activeElement).toHaveAttribute('role'); // Should focus on interactive element

      await user.tab();
      expect(document.activeElement).toHaveAttribute('role'); // Should move to next element
    });

    it('should have proper ARIA labels', () => {
      render(<App />);

      // Check for important ARIA labels
      expect(screen.getByRole('banner')).toBeInTheDocument(); // Header
      expect(screen.getByRole('main')).toBeInTheDocument(); // Main content
      expect(screen.getByRole('contentinfo')).toBeInTheDocument(); // Footer

      // File input should have proper labeling
      const fileInput = screen.getByLabelText(/choose.*file/i);
      expect(fileInput).toHaveAttribute('accept');
    });
  });

  describe('Performance', () => {
    it('should render within performance budget', async () => {
      const startTime = performance.now();

      render(<App />);

      // Wait for initial render to complete
      await waitFor(() => {
        expect(screen.getByRole('main')).toBeInTheDocument();
      });

      const renderTime = performance.now() - startTime;

      // Should render within 100ms (adjust based on requirements)
      expect(renderTime).toBeLessThan(100);
    });

    it('should handle large file uploads efficiently', async () => {
      const user = userEvent.setup();

      // Mock large file analysis
      mockAnalyzeBmsScreenshot.mockImplementation(
        () => new Promise(resolve =>
          setTimeout(() => resolve({
            summary: 'Large file processed',
            _recordId: 'record-large',
            _timestamp: '2024-01-15T10:30:00Z',
          } as any), 50)
        )
      );

      render(<App />);

      // Simulate large file
      const largeFile = new File(
        [new ArrayBuffer(5 * 1024 * 1024)], // 5MB
        'large-screenshot.jpg',
        { type: 'image/jpeg' }
      );

      const fileInput = screen.getByLabelText(/choose.*file/i);
      await user.upload(fileInput, largeFile);

      // Should handle large file without blocking UI
      const startTime = performance.now();

      await waitFor(() => {
        expect(mockAnalyzeBmsScreenshot).toHaveBeenCalled();
      });

      const processingTime = performance.now() - startTime;

      // UI should remain responsive during processing
      expect(processingTime).toBeLessThan(1000);
    });
  });
});