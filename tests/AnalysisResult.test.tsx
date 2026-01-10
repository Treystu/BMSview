
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AnalysisResult from '../src/components/AnalysisResult';
import { useAppState } from '../src/state/appState';
import { InsightMode } from '../src/types';

// Mock dependencies
jest.mock('../src/state/appState', () => ({
  useAppState: jest.fn(),
}));

jest.mock('../src/components/CostEstimateBadge', () => ({
  CostEstimateBadge: () => <div data-testid="cost-estimate">Cost Estimate</div>,
  estimateInsightsCost: jest.fn().mockReturnValue({ totalCost: 0.01 }),
}));

jest.mock('../src/components/VisualInsightsRenderer', () => {
  return function DummyVisualRenderer({ content }) {
    return <div data-testid="visual-renderer">{content}</div>;
  };
});

jest.mock('../src/components/TypewriterMarkdown', () => {
  return function DummyTypewriter({ content }) {
    return <div data-testid="typewriter">{content}</div>;
  };
});

// Mock Icons
jest.mock('../src/components/icons/SpinnerIcon', () => function SpinnerIcon() { return <svg data-testid="spinner" />; });
jest.mock('../src/components/icons/CloudIcon', () => function CloudIcon() { return <svg />; });
jest.mock('../src/components/icons/SunIcon', () => function SunIcon() { return <svg />; });
jest.mock('../src/components/icons/ThermometerIcon', () => function ThermometerIcon() { return <svg />; });

describe('AnalysisResult Component', () => {
  const mockDispatch = jest.fn();
  const mockOnLinkRecord = jest.fn();
  const mockOnReprocess = jest.fn();
  const mockOnRegisterNewSystem = jest.fn();

  const defaultProps = {
    registeredSystems: [],
    onLinkRecord: mockOnLinkRecord,
    onReprocess: mockOnReprocess,
    onRegisterNewSystem: mockOnRegisterNewSystem,
  };

  const defaultResult = {
    fileName: 'test-bms.png',
    data: null, // explicit null
    error: undefined,
    weather: undefined,
    isDuplicate: false,
    isBatchDuplicate: false,
    file: new File([''], 'test-bms.png'),
    saveError: null,
    recordId: undefined, // undefined
  };

  const mockAnalysisData = {
    voltage: 52.4,
    current: 10.5,
    soc: 85,
    overallVoltage: 52.4,
    stateOfCharge: 85,
    temperature: 25,
    mosTemperature: 30,
    cellVoltageDifference: 0.01,
    cellVoltages: [3.2, 3.2, 3.2, 3.2],
    summary: 'System is healthy',
    alerts: [],
    hardwareSystemId: 'SYS123',
    dlNumber: 'DL123'
  };

  beforeEach(() => {
    (useAppState as jest.Mock).mockReturnValue({
      state: { selectedInsightMode: InsightMode.WITH_TOOLS },
      dispatch: mockDispatch,
    });
    jest.clearAllMocks();
  });

  it('renders processing state when data is missing and no error', () => {
    const props = {
      ...defaultProps,
      result: { ...defaultResult, error: 'Processing...' },
    };

    render(<AnalysisResult {...props} />);
    const processingElements = screen.getAllByText('Processing...');
    expect(processingElements.length).toBeGreaterThan(0);
    expect(processingElements[0]).toBeInTheDocument();
    
    const spinners = screen.getAllByTestId('spinner');
    expect(spinners.length).toBeGreaterThan(0);
    expect(spinners[0]).toBeInTheDocument();
  });

  it('renders queued state correctly', () => {
    const props = {
      ...defaultProps,
      result: { ...defaultResult, error: 'Queued for Analysis' },
    };

    render(<AnalysisResult {...props} />);
    expect(screen.getByText('Queued for Analysis')).toBeInTheDocument();
    expect(screen.getByText('⏳')).toBeInTheDocument();
  });

  it('renders completed state with data', () => {
    const props = {
      ...defaultProps,
      result: {
        ...defaultResult,
        data: mockAnalysisData,
      },
    };

    render(<AnalysisResult {...props} />);
    expect(screen.getByText('test-bms.png')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('52.4')).toBeInTheDocument(); // Metric card
  });

  it('renders error state correctly', () => {
    const props = {
      ...defaultProps,
      result: { ...defaultResult, error: 'Failed to extract data' },
    };

    render(<AnalysisResult {...props} />);
    const errorElements = screen.getAllByText('Failed to extract data');
    expect(errorElements.length).toBeGreaterThan(0);
    expect(errorElements[0]).toBeInTheDocument();
    // Use getAllByText for the X icon as well if needed, though getByText might work if unique
    // But since it failed before, let's be safe
    const xIcons = screen.getAllByText('❌'); 
    expect(xIcons[0]).toBeInTheDocument();
  });

  it('handles duplicate detection', () => {
    const props = {
      ...defaultProps,
      result: {
        ...defaultResult,
        isDuplicate: true,
        data: mockAnalysisData, // Has data (duplicate cache hit)
      },
    };

    render(<AnalysisResult {...props} />);
    expect(screen.getByText('Duplicate (from cache)')).toBeInTheDocument();
    expect(screen.getByText('Duplicate Detected')).toBeInTheDocument();
    expect(screen.getByText('Re-analyze Anyway')).toBeInTheDocument();
  });

  it('calls onReprocess when re-analyze button clicked', () => {
    const props = {
      ...defaultProps,
      result: {
        ...defaultResult,
        isDuplicate: true,
        data: mockAnalysisData,
      },
    };

    render(<AnalysisResult {...props} />);
    const button = screen.getByText('Re-analyze Anyway');
    fireEvent.click(button);
    expect(mockOnReprocess).toHaveBeenCalledWith(props.result.file);
  });
});
