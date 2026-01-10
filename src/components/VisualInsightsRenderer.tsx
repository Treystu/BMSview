import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Chart configuration interface for Visual Guru Expert mode
 * Supports responsive charts with optional dimension constraints
 */
export interface ChartConfig {
  chartType: 'line' | 'bar' | 'area' | 'gauge' | 'stacked_bar';
  title: string;
  description?: string;
  // Dimension constraints - charts are responsive by default
  // These provide hints for optimal rendering
  dimensions?: {
    aspectRatio?: '16:9' | '4:3' | '1:1' | '2:1' | '3:2'; // Common aspect ratios
    minHeight?: number; // Minimum height in pixels (default: 200)
    maxHeight?: number; // Maximum height in pixels (default: 400)
    preferredWidth?: 'full' | 'half' | 'third'; // Width relative to container
  };
  xAxis?: {
    label: string;
    type?: 'datetime' | 'category';
  };
  yAxis?: {
    label: string;
    min?: number;
    max?: number;
  };
  series?: Array<{
    name: string;
    data: Array<[string | number, number]>;
    color?: string;
  }>;
  // For gauge charts
  value?: number;
  min?: number;
  max?: number;
  thresholds?: Array<{
    value: number;
    color: string;
    label?: string;
  }>;
  insights?: string;
}

interface VisualInsightsRendererProps {
  content: string;
  className?: string;
}

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
  console.log(JSON.stringify({
    level: level.toUpperCase(),
    timestamp: new Date().toISOString(),
    component: 'VisualInsightsRenderer',
    message,
    context
  }));
};

/**
 * Parse chart configurations from markdown content
 * Looks for ```chart code blocks with JSON configuration
 */
const parseChartConfigs = (content: string): { charts: ChartConfig[]; cleanContent: string } => {
  const charts: ChartConfig[] = [];
  const chartBlockRegex = /```chart\s*\n([\s\S]*?)```/g;

  let cleanContent = content;
  let match;
  let chartIndex = 0;

  while ((match = chartBlockRegex.exec(content)) !== null) {
    try {
      const jsonStr = match[1].trim();
      const chartConfig = JSON.parse(jsonStr) as ChartConfig;

      // Validate chart config has required fields
      if (chartConfig.chartType && chartConfig.title) {
        charts.push(chartConfig);
        log('info', 'Parsed chart configuration', {
          chartType: chartConfig.chartType,
          title: chartConfig.title,
          hasData: chartConfig.series ? chartConfig.series.length > 0 : !!chartConfig.value
        });

        // Replace chart block with placeholder
        cleanContent = cleanContent.replace(match[0], `\n[CHART_PLACEHOLDER_${chartIndex}]\n`);
        chartIndex++;
      } else {
        log('warn', 'Invalid chart config - missing required fields', { chartConfig });
      }
    } catch (e) {
      log('warn', 'Failed to parse chart configuration', {
        error: e instanceof Error ? e.message : String(e),
        rawContent: match[1].substring(0, 100)
      });
    }
  }

  return { charts, cleanContent };
};

/**
 * Simple gauge chart component
 */
const GaugeChart: React.FC<{ config: ChartConfig }> = ({ config }) => {
  const { value = 0, min = 0, max = 100, title, thresholds = [], insights } = config;
  const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  // Determine color based on thresholds
  let color = '#3B82F6'; // Default blue
  for (const threshold of thresholds.sort((a, b) => b.value - a.value)) {
    if (value >= threshold.value) {
      color = threshold.color === 'green' ? '#22C55E' :
        threshold.color === 'yellow' ? '#EAB308' :
          threshold.color === 'red' ? '#EF4444' : threshold.color;
      break;
    }
  }

  // Get status label
  let statusLabel = 'Normal';
  for (const threshold of thresholds.sort((a, b) => b.value - a.value)) {
    if (value >= threshold.value) {
      statusLabel = threshold.label || statusLabel;
      break;
    }
  }

  return (
    <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 shadow-lg border border-gray-200">
      <h4 className="text-lg font-bold text-gray-800 mb-4 text-center">{title}</h4>
      <div className="relative w-40 h-40 mx-auto">
        {/* Background circle */}
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx="80"
            cy="80"
            r="70"
            fill="none"
            stroke="#E5E7EB"
            strokeWidth="12"
          />
          {/* Value arc */}
          <circle
            cx="80"
            cy="80"
            r="70"
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeDasharray={`${percentage * 4.4} 440`}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold" style={{ color }}>{value}</span>
          <span className="text-sm text-gray-500">{statusLabel}</span>
        </div>
      </div>
      {insights && (
        <p className="text-sm text-gray-600 mt-4 text-center italic">✨ {insights}</p>
      )}
    </div>
  );
};

/**
 * Helper to calculate chart height based on aspect ratio and container width
 */
const getChartDimensions = (dimensions?: ChartConfig['dimensions']) => {
  const aspectRatioMap: Record<string, number> = {
    '16:9': 16 / 9,
    '4:3': 4 / 3,
    '1:1': 1,
    '2:1': 2,
    '3:2': 3 / 2
  };

  const aspectRatio = dimensions?.aspectRatio ? aspectRatioMap[dimensions.aspectRatio] : 16 / 9;
  const minHeight = dimensions?.minHeight || 200;
  const maxHeight = dimensions?.maxHeight || 400;
  const preferredWidth = dimensions?.preferredWidth || 'full';

  // Calculate height class based on aspect ratio (approximate for CSS)
  let heightClass = 'h-48'; // Default ~192px
  if (aspectRatio <= 1) {
    heightClass = 'h-64'; // Square-ish, taller
  } else if (aspectRatio >= 2) {
    heightClass = 'h-40'; // Wide, shorter
  }

  // Width class based on preferred width
  const widthClass = preferredWidth === 'half' ? 'w-full md:w-1/2' :
    preferredWidth === 'third' ? 'w-full md:w-1/3' : 'w-full';

  return { heightClass, widthClass, minHeight, maxHeight, aspectRatio };
};

/**
 * Simple line/bar chart component using CSS
 * For production, this would integrate with a charting library like Recharts
 */
const SimpleChart: React.FC<{ config: ChartConfig }> = ({ config }) => {
  const { chartType, title, description, series = [], xAxis, yAxis, insights, dimensions } = config;

  // Memoize dimension settings to avoid recalculating on every render
  const { heightClass, widthClass, minHeight, maxHeight } = useMemo(
    () => getChartDimensions(dimensions),
    [dimensions]
  );

  // Get all data points
  const allData = series.flatMap(s => s.data);
  const values = allData.map(d => d[1]);
  const minValue = yAxis?.min ?? Math.min(...values, 0);
  const maxValue = yAxis?.max ?? Math.max(...values);
  const range = maxValue - minValue || 1;

  // Limit to first 20 points for display
  const displayData = series[0]?.data.slice(-20) || [];

  const getBarHeight = (value: number) => {
    return Math.max(5, ((value - minValue) / range) * 100);
  };

  const colors = ['#3B82F6', '#22C55E', '#EAB308', '#EF4444', '#8B5CF6'];

  return (
    <div className={`bg-white rounded-xl p-6 shadow-lg border border-gray-200 ${widthClass}`}>
      <h4 className="text-lg font-bold text-gray-800 mb-2">{title}</h4>
      {description && <p className="text-sm text-gray-600 mb-4">{description}</p>}

      <div
        className={`relative ${heightClass} bg-gray-50 rounded-lg p-4`}
        style={{ minHeight: `${minHeight}px`, maxHeight: `${maxHeight}px` }}
      >
        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between text-xs text-gray-500 py-2">
          <span>{maxValue.toFixed(1)}</span>
          <span>{((maxValue + minValue) / 2).toFixed(1)}</span>
          <span>{minValue.toFixed(1)}</span>
        </div>

        {/* Chart area */}
        <div className="ml-14 h-full flex items-end space-x-1">
          {chartType === 'bar' || chartType === 'stacked_bar' ? (
            // Bar chart
            displayData.map((point, idx) => (
              <div
                key={idx}
                className="flex-1 flex flex-col justify-end"
                title={`${point[0]}: ${point[1]}`}
              >
                <div
                  className="rounded-t transition-all duration-500 ease-out"
                  style={{
                    height: `${getBarHeight(point[1])}%`,
                    backgroundColor: colors[0],
                    minHeight: '4px'
                  }}
                />
              </div>
            ))
          ) : (
            // Line chart - simplified as connected bars
            displayData.map((point, idx) => (
              <div
                key={idx}
                className="flex-1 flex flex-col justify-end"
                title={`${point[0]}: ${point[1]}`}
              >
                <div
                  className="w-2 h-2 rounded-full mx-auto transition-all duration-500 ease-out"
                  style={{
                    marginBottom: `${getBarHeight(point[1])}%`,
                    backgroundColor: colors[0]
                  }}
                />
              </div>
            ))
          )}
        </div>

        {/* X-axis label */}
        {xAxis?.label && (
          <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 text-xs text-gray-500 mt-2">
            {xAxis.label}
          </div>
        )}
      </div>

      {/* Legend */}
      {series.length > 0 && (
        <div className="flex flex-wrap gap-4 mt-4 justify-center">
          {series.map((s, idx) => (
            <div key={idx} className="flex items-center space-x-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: s.color || colors[idx % colors.length] }}
              />
              <span className="text-sm text-gray-600">{s.name}</span>
            </div>
          ))}
        </div>
      )}

      {insights && (
        <p className="text-sm text-gray-600 mt-4 text-center italic border-t border-gray-200 pt-3">
          ✨ {insights}
        </p>
      )}
    </div>
  );
};

/**
 * Chart renderer component that dispatches to appropriate chart type
 */
const ChartRenderer: React.FC<{ config: ChartConfig; index: number }> = ({ config, index: _index }) => {
  if (config.chartType === 'gauge') {
    return <GaugeChart config={config} />;
  }
  return <SimpleChart config={config} />;
};

/**
 * Visual Insights Renderer
 * Parses Visual Guru Expert output and renders charts alongside markdown content
 */
export const VisualInsightsRenderer: React.FC<VisualInsightsRendererProps> = ({
  content,
  className = ''
}) => {
  const { charts, cleanContent } = useMemo(() => parseChartConfigs(content), [content]);

  // Split content by chart placeholders
  const contentParts = useMemo(() => {
    const parts: Array<{ type: 'text' | 'chart'; content: string; chartIndex?: number }> = [];

    const placeholderRegex = /\[CHART_PLACEHOLDER_(\d+)\]/g;
    let lastIndex = 0;
    let match;

    while ((match = placeholderRegex.exec(cleanContent)) !== null) {
      // Add text before placeholder
      if (match.index > lastIndex) {
        const textContent = cleanContent.substring(lastIndex, match.index).trim();
        if (textContent) {
          parts.push({ type: 'text', content: textContent });
        }
      }

      // Add chart placeholder
      const chartIndex = parseInt(match[1], 10);
      if (charts[chartIndex]) {
        parts.push({ type: 'chart', content: '', chartIndex });
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < cleanContent.length) {
      const remainingText = cleanContent.substring(lastIndex).trim();
      if (remainingText) {
        parts.push({ type: 'text', content: remainingText });
      }
    }

    // If no parts, treat entire content as text
    if (parts.length === 0) {
      parts.push({ type: 'text', content: cleanContent });
    }

    return parts;
  }, [cleanContent, charts]);

  log('info', 'Rendering visual insights', {
    chartsFound: charts.length,
    contentParts: contentParts.length
  });

  return (
    <div className={`visual-insights-renderer ${className}`}>
      {contentParts.map((part, idx) => (
        <div key={idx} className="mb-6">
          {part.type === 'text' ? (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ node: _node, ...props }) => <h1 className="text-2xl font-bold text-gray-900 mb-4 mt-6 break-words" {...props} />,
                  h2: ({ node: _node, ...props }) => <h2 className="text-xl font-bold text-gray-900 mb-3 mt-5 break-words" {...props} />,
                  h3: ({ node: _node, ...props }) => <h3 className="text-lg font-semibold text-gray-800 mb-2 mt-4 break-words" {...props} />,
                  h4: ({ node: _node, ...props }) => <h4 className="text-base font-semibold text-gray-800 mb-2 mt-3 break-words" {...props} />,
                  p: ({ node: _node, ...props }) => <p className="text-gray-700 mb-3 leading-relaxed break-words" {...props} />,
                  ul: ({ node: _node, ...props }) => <ul className="list-disc list-inside mb-3 space-y-1.5" {...props} />,
                  ol: ({ node: _node, ...props }) => <ol className="list-decimal list-inside mb-3 space-y-1.5" {...props} />,
                  li: ({ node: _node, ...props }) => <li className="text-gray-700 ml-2 leading-relaxed break-words" {...props} />,
                  strong: ({ node: _node, ...props }) => <strong className="font-bold text-gray-900" {...props} />,
                  em: ({ node: _node, ...props }) => <em className="italic text-gray-700" {...props} />,
                  code: ({ node: _node, className, ...props }) => {
                    const baseClassName = className ? String(className) : '';
                    const isInline = baseClassName.length === 0;
                    const mergedClassName = isInline
                      ? `bg-gray-100 text-pink-600 px-1.5 py-0.5 rounded text-sm break-words${baseClassName ? ` ${baseClassName}` : ''}`
                      : `block bg-gray-900 text-green-400 p-3 rounded-lg text-sm overflow-x-auto mb-3${baseClassName ? ` ${baseClassName}` : ''}`;
                    return <code className={mergedClassName} {...props} />;
                  },
                  blockquote: ({ node: _node, ...props }) => (
                    <blockquote className="border-l-4 border-blue-500 pl-4 py-2 mb-3 italic text-gray-600 bg-blue-50 rounded-r break-words" {...props} />
                  ),
                }}
              >
                {part.content}
              </ReactMarkdown>
            </div>
          ) : (
            <ChartRenderer
              config={charts[part.chartIndex!]}
              index={part.chartIndex!}
            />
          )}
        </div>
      ))}

      {/* Show warning if Visual Guru mode but no charts found */}
      {charts.length === 0 && content.includes('📊') && (
        <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-700">
            <span className="font-semibold">📊 Visual Note:</span> No chart configurations were found in this response.
            The AI may not have detected time-series data suitable for visualization, or the chart format may need adjustment.
          </p>
        </div>
      )}
    </div>
  );
};

export default VisualInsightsRenderer;
