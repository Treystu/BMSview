import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { BmsSystem, AnalysisRecord, AnalysisData, WeatherData } from '../types';

type MetricKey = 'stateOfCharge' | 'overallVoltage' | 'current' | 'temperature' | 'power' | 'cellVoltageDifference' | 'clouds' | 'uvi' | 'temp';
type Axis = 'left' | 'right';

const METRICS: Record<MetricKey, { 
    label: string; 
    unit: string; 
    color: string; 
    multiplier?: number; 
    source: 'analysis' | 'weather'; 
    group: 'Battery' | 'Weather';
    anomaly?: (value: number) => { type: 'critical' | 'warning', message: string } | null;
}> = {
  stateOfCharge: { label: 'SOC', unit: '%', color: '#34d399', source: 'analysis', group: 'Battery', anomaly: (val) => val < 20 ? { type: 'warning', message: `Warning: SOC is low (${val.toFixed(1)}%)` } : null },
  overallVoltage: { label: 'Voltage', unit: 'V', color: '#fbbf24', source: 'analysis', group: 'Battery' },
  current: { label: 'Current', unit: 'A', color: '#60a5fa', source: 'analysis', group: 'Battery' },
  power: { label: 'Power', unit: 'W', color: '#c084fc', source: 'analysis', group: 'Battery' },
  temperature: { label: 'Batt Temp', unit: '°C', color: '#f87171', source: 'analysis', group: 'Battery', anomaly: (val) => val > 45 ? { type: 'critical', message: `CRITICAL: Battery temp is high (${val.toFixed(1)}°C)` } : null },
  cellVoltageDifference: { label: 'Cell Diff', unit: 'mV', color: '#a3a3a3', multiplier: 1000, source: 'analysis', group: 'Battery', anomaly: (val) => val > 0.1 ? { type: 'critical', message: `CRITICAL: Cell difference is high (${(val * 1000).toFixed(0)}mV)` } : null },
  clouds: { label: 'Clouds', unit: '%', color: '#94a3b8', source: 'weather', group: 'Weather' },
  uvi: { label: 'UV Index', unit: '', color: '#fde047', source: 'weather', group: 'Weather' },
  temp: { label: 'Air Temp', unit: '°C', color: '#a78bfa', source: 'weather', group: 'Weather' },
};

const METRIC_GROUPS = Object.entries(METRICS).reduce((acc, [key, metric]) => {
    if (!acc[metric.group]) acc[metric.group] = [];
    acc[metric.group].push(key as MetricKey);
    return acc;
}, {} as Record<string, MetricKey[]>);

const mapRecordToPoint = (r: AnalysisRecord) => {
    const point: { [key: string]: any } = { timestamp: r.timestamp, recordCount: 1, anomalies: [] };
    Object.keys(METRICS).forEach(m => {
        const metric = m as MetricKey;
        const { source, multiplier = 1, anomaly } = METRICS[metric];
        const value = source === 'analysis' ? r.analysis?.[metric as keyof AnalysisData] : r.weather?.[metric as keyof WeatherData];
        if (value != null && typeof value === 'number') {
            const finalValue = value * multiplier;
            point[metric] = finalValue;
            if (anomaly) {
                const anomalyResult = anomaly(value); // Anomaly check on original value
                if (anomalyResult) point.anomalies.push({ ...anomalyResult, key: metric });
            }
        } else {
            point[metric] = null;
        }
    });
    return point;
};

const aggregateData = (data: AnalysisRecord[], bucketMinutes: number): any[] => {
    if (bucketMinutes <= 0) return data.map(mapRecordToPoint);
    
    const bucketMillis = bucketMinutes * 60 * 1000;
    const buckets = new Map<number, AnalysisRecord[]>();
    data.forEach(r => {
        const key = Math.floor(new Date(r.timestamp).getTime() / bucketMillis) * bucketMillis;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(r);
    });

    return Array.from(buckets.entries()).map(([key, bucket]) => {
        const avgPoint: { [key: string]: any } = { timestamp: new Date(key).toISOString(), recordCount: bucket.length, anomalies: [] };
        Object.keys(METRICS).forEach(m => {
            const metric = m as MetricKey;
            const { source, multiplier = 1, anomaly } = METRICS[metric];
            const values = bucket.map(r => source === 'analysis' ? r.analysis?.[metric as keyof AnalysisData] : r.weather?.[metric as keyof WeatherData]).filter((v): v is number => v != null && typeof v === 'number');
            if (values.length > 0) {
                const avgValue = values.reduce((a, v) => a + v, 0) / values.length;
                avgPoint[metric] = avgValue * multiplier;
                if (anomaly) {
                    const anomalyResult = anomaly(avgValue);
                    if (anomalyResult) avgPoint.anomalies.push({ ...anomalyResult, key: metric });
                }
            } else {
                avgPoint[metric] = null;
            }
        });
        return avgPoint;
    });
};

const ChartControls: React.FC<{
    systems: BmsSystem[];
    selectedSystemId: string;
    setSelectedSystemId: (id: string) => void;
    startDate: string;
    setStartDate: (date: string) => void;
    endDate: string;
    setEndDate: (date: string) => void;
    metricConfig: Partial<Record<MetricKey, { axis: Axis }>>;
    setMetricConfig: React.Dispatch<React.SetStateAction<Partial<Record<MetricKey, { axis: Axis }>>>>;
    onGenerate: () => void;
    onResetView: () => void;
    hasChartData: boolean;
}> = ({ systems, selectedSystemId, setSelectedSystemId, startDate, setStartDate, endDate, setEndDate, metricConfig, setMetricConfig, onGenerate, onResetView, hasChartData }) => {
    const [isMetricConfigOpen, setIsMetricConfigOpen] = useState(false);
    const metricConfigRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (metricConfigRef.current && !metricConfigRef.current.contains(event.target as Node)) {
                setIsMetricConfigOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleMetricConfigChange = (metric: MetricKey, config?: { axis: Axis }) => {
        setMetricConfig(prev => {
            const next = {...prev};
            if (config) next[metric] = config;
            else delete next[metric];
            return next;
        });
    };
    
    return (
        <div className="flex flex-col gap-4 mb-6 p-4 bg-gray-900/50 rounded-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                {/* System Select */}
                <div className="lg:col-span-1">
                    <label htmlFor="system-select-chart" className="block text-sm font-medium text-gray-300 mb-1">System</label>
                    <select id="system-select-chart" value={selectedSystemId} onChange={(e) => setSelectedSystemId(e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-secondary focus:border-secondary">
                        <option value="">-- Select a System --</option>
                        {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </div>
                {/* Date Pickers */}
                <div className="lg:col-span-2 grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="start-date" className="block text-sm font-medium text-gray-300 mb-1">Start Time</label>
                        <input type="datetime-local" id="start-date" value={startDate} onChange={e => setStartDate(e.target.value)}
                            className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-secondary focus:border-secondary"/>
                    </div>
                    <div>
                        <label htmlFor="end-date" className="block text-sm font-medium text-gray-300 mb-1">End Time</label>
                        <input type="datetime-local" id="end-date" value={endDate} onChange={e => setEndDate(e.target.value)}
                            className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-secondary focus:border-secondary"/>
                    </div>
                </div>
                {/* Action Buttons */}
                <div className="flex items-end space-x-2">
                    <div className="relative" ref={metricConfigRef}>
                        <button onClick={() => setIsMetricConfigOpen(o => !o)} className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-md transition-colors">Configure Metrics</button>
                        {isMetricConfigOpen && (
                             <div className="absolute top-full right-0 mt-2 w-96 rounded-md shadow-lg bg-gray-800 ring-1 ring-black ring-opacity-5 z-20 p-4 max-h-96 overflow-y-auto">
                                <div className="space-y-3">
                                {Object.entries(METRIC_GROUPS).map(([groupName, metrics]) => (
                                    <div key={groupName}>
                                        <h4 className="font-semibold text-gray-300 text-sm mb-2">{groupName}</h4>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                            {metrics.map(key => {
                                                const config = metricConfig[key];
                                                return (
                                                    <div key={key}>
                                                        <label className="flex items-center space-x-2 text-sm text-white cursor-pointer select-none">
                                                            <input type="checkbox" checked={!!config} onChange={(e) => handleMetricConfigChange(key, e.target.checked ? { axis: 'left' } : undefined)}
                                                                className="form-checkbox h-4 w-4 bg-gray-800 border-gray-600 text-secondary focus:ring-secondary focus:ring-offset-gray-800"
                                                                style={{ color: METRICS[key].color }} />
                                                            <span style={{ color: METRICS[key].color }}>{METRICS[key].label}</span>
                                                        </label>
                                                        {config && (
                                                            <div className="text-xs flex items-center space-x-3 mt-1 pl-6">
                                                                <label className="flex items-center space-x-1 cursor-pointer text-gray-400"><input type="radio" name={`${key}-axis`} value="left" checked={config.axis === 'left'} onChange={() => handleMetricConfigChange(key, { axis: 'left' })} className="form-radio h-3 w-3 bg-gray-900 border-gray-600 text-secondary focus:ring-secondary" /><span>Left</span></label>
                                                                <label className="flex items-center space-x-1 cursor-pointer text-gray-400"><input type="radio" name={`${key}-axis`} value="right" checked={config.axis === 'right'} onChange={() => handleMetricConfigChange(key, { axis: 'right' })} className="form-radio h-3 w-3 bg-gray-900 border-gray-600 text-secondary focus:ring-secondary" /><span>Right</span></label>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <div className="flex justify-end items-center gap-4">
                 {hasChartData && <button onClick={onResetView} className="text-sm text-secondary hover:underline">Reset View</button>}
                 <button onClick={onGenerate} className="bg-secondary hover:bg-primary text-white font-bold py-2 px-6 rounded-md transition-colors">Generate Chart</button>
            </div>
        </div>
    );
};

const SvgChart: React.FC<{
    chartData: any;
    metricConfig: Partial<Record<MetricKey, { axis: Axis }>>;
    hiddenMetrics: Set<MetricKey>;
    viewBox: { x: number; width: number };
    setViewBox: React.Dispatch<React.SetStateAction<{ x: number, width: number }>>;
    chartDimensions: any;
}> = ({ chartData, metricConfig, hiddenMetrics, viewBox, setViewBox, chartDimensions }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [tooltip, setTooltip] = useState<{ x: number; y: number; point: any } | null>(null);
    
    const interactionState = useRef({
        isPanning: false,
        isBrushPanning: false,
        isBrushResizing: null as 'left' | 'right' | null,
        panStart: { x: 0, y: 0 },
        viewBoxStart: { x: 0, width: 0 }
    }).current;
    
    const {
        dataLODs, xScale, xMin, xMax
    } = chartData;
    const {
        WIDTH, CHART_HEIGHT, BRUSH_HEIGHT, MARGIN, chartWidth, chartHeight, totalHeight
    } = chartDimensions;

    const dataToRender = useMemo(() => {
        const zoomRatio = chartWidth / viewBox.width;
        let bucketKey: string = 'raw';
        if (zoomRatio < 2) bucketKey = '1440';    // < 2x zoom: 1-day buckets
        else if (zoomRatio < 5) bucketKey = '240';  // < 5x zoom: 4-hour buckets
        else if (zoomRatio < 15) bucketKey = '60';   // < 15x zoom: 1-hour buckets
        else if (zoomRatio < 50) bucketKey = '15';   // < 50x zoom: 15-min buckets
        else if (zoomRatio < 100) bucketKey = '5';    // < 100x zoom: 5-min buckets
        return dataLODs[bucketKey] || dataLODs['raw'];
    }, [dataLODs, viewBox.width, chartWidth]);

    const zoomRatio = chartWidth / viewBox.width;
    const showDataPoints = zoomRatio > 100; // Show points when very zoomed in

    const {
        paths, anomalies,
        yScaleLeft, yTicksLeft, yAxisLabelLeft,
        yScaleRight, yTicksRight, yAxisLabelRight
    } = useMemo(() => {
        const activeMetrics = Object.entries(metricConfig).map(([key, config]) => ({ key: key as MetricKey, axis: config!.axis }));
        const leftMetrics = activeMetrics.filter(m => m.axis === 'left').map(m => m.key);
        const rightMetrics = activeMetrics.filter(m => m.axis === 'right').map(m => m.key);

        const calculateYAxis = (keys: MetricKey[]) => {
            if (keys.length === 0) return { scale: () => 0, ticks: [], label: '' };
            let yMin = Infinity, yMax = -Infinity;
            keys.forEach(key => dataToRender.forEach((d:any) => { if (d[key] !== null) { yMin = Math.min(yMin, d[key]); yMax = Math.max(yMax, d[key]); } }));
            if (yMin === Infinity) return { scale: () => 0, ticks: [], label: '' };
            const buffer = (yMax - yMin) * 0.1 || 1;
            const scaleMin = yMin - buffer, scaleMax = yMax + buffer;
            const scale = (val: number) => chartHeight - (((val - scaleMin) / (scaleMax - scaleMin)) * chartHeight);
            const ticks = Array.from({length: 6}, (_,i) => scaleMin + i * (scaleMax-scaleMin)/5).map(v=>({value:v, y:scale(v)}));
            return { scale, ticks, label: [...new Set(keys.map(k => METRICS[k].unit))].join(' / ') };
        };

        const { scale: yScaleLeft, ticks: yTicksLeft, label: yAxisLabelLeft } = calculateYAxis(leftMetrics);
        const { scale: yScaleRight, ticks: yTicksRight, label: yAxisLabelRight } = calculateYAxis(rightMetrics);
        
        const paths = activeMetrics.map(({ key, axis }) => {
            const yScale = axis === 'left' ? yScaleLeft : yScaleRight;
            if (!yScale) return null;
            const pathData = dataToRender.filter((d:any) => d[key] !== null).map((d:any, i:number) => `${i === 0 ? 'M' : 'L'} ${xScale(d.timestamp).toFixed(2)} ${yScale(d[key]).toFixed(2)}`).join(' ');
            return { key, d: pathData, color: METRICS[key].color };
        }).filter(Boolean);

        const anomalies = dataToRender.flatMap((d:any) => d.anomalies.map((a:any) => {
            const metricConf = metricConfig[a.key as MetricKey];
            if (!metricConf) return null;
            const yScale = metricConf.axis === 'left' ? yScaleLeft : yScaleRight;
            return { ...a, timestamp: d.timestamp, y: yScale(d[a.key]) };
        })).filter(Boolean);
        
        return { paths, anomalies, yScaleLeft, yTicksLeft, yAxisLabelLeft, yScaleRight, yTicksRight, yAxisLabelRight };

    }, [dataToRender, metricConfig, chartHeight, xScale]);
    
    const activeMetrics = useMemo(() => Object.entries(metricConfig).map(([key, config]) => ({ key: key as MetricKey, axis: config!.axis })), [metricConfig]);

    const { xTicks, brushPaths } = useMemo(() => {
        const xTicks = Array.from({length:10}, (_,i) => i*chartWidth/9).map(px => {
            const time = xScale.invert(px * (viewBox.width/chartWidth) + viewBox.x);
            const date = new Date(time);
            return { x: px, label: date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) , dateLabel: date.toLocaleDateString([], {month:'short', day:'numeric'})};
        });

        const { scale: brushYLeft } = { scale: (v:number) => BRUSH_HEIGHT - ((v - 0) / (100 - 0)) * BRUSH_HEIGHT };
        const brushPaths = Object.keys(metricConfig).map(key => {
            const pathData = dataLODs['60'].filter((d:any) => d[key] !== null).map((d:any, i:number) => `${i === 0 ? 'M' : 'L'} ${xScale(d.timestamp).toFixed(2)} ${brushYLeft(50).toFixed(2)}`).join(' ');
            return { key, d: pathData, color: METRICS[key as MetricKey].color };
        });

        return { xTicks, brushPaths };
    }, [viewBox.width, viewBox.x, chartWidth, xScale, metricConfig, dataLODs]);

    const getSvgCoords = (e: MouseEvent) => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const pt = svgRef.current.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        return pt.matrixTransform(svgRef.current.getScreenCTM()?.inverse());
    };

    const handleWindowMouseMove = useCallback((e: MouseEvent) => {
        const { isPanning, isBrushPanning, isBrushResizing, panStart, viewBoxStart } = interactionState;
        if (!isPanning && !isBrushPanning && !isBrushResizing) return;
        
        const svgPoint = getSvgCoords(e);
        const dx = svgPoint.x - panStart.x;

        if (isPanning) {
            let newX = viewBoxStart.x - dx * (viewBoxStart.width / chartWidth);
            if (newX < 0) newX = 0;
            if (newX + viewBoxStart.width > chartWidth) newX = chartWidth - viewBoxStart.width;
            setViewBox(vb => ({ ...vb, x: newX }));
        }
        if (isBrushPanning) {
            let newX = viewBoxStart.x + dx;
            if (newX < 0) newX = 0;
            if (newX + viewBoxStart.width > chartWidth) newX = chartWidth - viewBoxStart.width;
            setViewBox(vb => ({ ...vb, x: newX }));
        }
        if (isBrushResizing) {
            if (isBrushResizing === 'left') {
                let newX = viewBoxStart.x + dx;
                let newWidth = viewBoxStart.width - dx;
                if (newX < 0) { newWidth += newX; newX = 0; }
                if (newWidth < 10) { newX -= (10 - newWidth); newWidth = 10; }
                setViewBox({ x: newX, width: newWidth });
            } else if (isBrushResizing === 'right') {
                let newWidth = viewBoxStart.width + dx;
                if (viewBoxStart.x + newWidth > chartWidth) newWidth = chartWidth - viewBoxStart.x;
                if (newWidth < 10) newWidth = 10;
                setViewBox(vb => ({ ...vb, width: newWidth }));
            }
        }
    }, [chartWidth, setViewBox, interactionState]);

    const handleWindowMouseUp = useCallback(() => {
        interactionState.isPanning = false;
        interactionState.isBrushPanning = false;
        interactionState.isBrushResizing = null;
    }, [interactionState]);
    
    useEffect(() => {
        window.addEventListener('mousemove', handleWindowMouseMove);
        window.addEventListener('mouseup', handleWindowMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('mouseup', handleWindowMouseUp);
        };
    }, [handleWindowMouseMove, handleWindowMouseUp]);

    const handleMouseDown = (e: React.MouseEvent) => {
        const svgPoint = getSvgCoords(e.nativeEvent);
        interactionState.isPanning = true;
        interactionState.panStart = svgPoint;
        interactionState.viewBoxStart = { ...viewBox };
    };
    
    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const svgPoint = getSvgCoords(e.nativeEvent);
        const zoomFactor = e.deltaY < 0 ? 0.8 : 1.25;
        setViewBox(prev => {
            const chartMouseX = svgPoint.x - MARGIN.left;
            const mouseXAsFrac = (chartMouseX - prev.x) / prev.width;
            let newWidth = prev.width * zoomFactor;
            if (newWidth > chartWidth) newWidth = chartWidth;
            if (newWidth < 10) newWidth = 10;
            let newX = prev.x - (newWidth - prev.width) * mouseXAsFrac;
            if (newX < 0) newX = 0;
            if (newX + newWidth > chartWidth) newX = chartWidth - newWidth;
            return { ...prev, x: newX, width: newWidth };
        });
    };
    
    const handleMouseMove = (e: React.MouseEvent) => {
        if (interactionState.isPanning || interactionState.isBrushPanning || interactionState.isBrushResizing || !dataToRender || dataToRender.length === 0) {
            setTooltip(null);
            return;
        }
        const svgPoint = getSvgCoords(e.nativeEvent);
        const chartMouseX = svgPoint.x - MARGIN.left;
        const timeValue = xScale.invert(chartMouseX * (viewBox.width / chartWidth) + viewBox.x);

        const closestPoint = dataToRender.reduce((prev: any, curr: any) =>
            Math.abs(new Date(curr.timestamp).getTime() - timeValue) < Math.abs(new Date(prev.timestamp).getTime() - timeValue)
                ? curr
                : prev
        );

        const timeDiff = Math.abs(new Date(closestPoint.timestamp).getTime() - timeValue);
        const visibleTimeSpan = (xMax - xMin) * (viewBox.width / chartWidth);
        const threshold = visibleTimeSpan * 0.05; // 5% of visible time span

        if (timeDiff < threshold) {
            setTooltip({
                x: (xScale(closestPoint.timestamp) - viewBox.x) * (chartWidth / viewBox.width),
                y: svgPoint.y,
                point: closestPoint
            });
        } else {
            setTooltip(null);
        }
    };

    const handleBrushPanStart = (e: React.MouseEvent) => {
        e.stopPropagation();
        const svgPoint = getSvgCoords(e.nativeEvent);
        interactionState.isBrushPanning = true;
        interactionState.panStart = { x: svgPoint.x - MARGIN.left, y: 0 };
        interactionState.viewBoxStart = { ...viewBox };
    };
    
    const handleBrushResizeStart = (e: React.MouseEvent, handle: 'left' | 'right') => {
        e.stopPropagation();
        const svgPoint = getSvgCoords(e.nativeEvent);
        interactionState.isBrushResizing = handle;
        interactionState.panStart = { x: svgPoint.x - MARGIN.left, y: 0 };
        interactionState.viewBoxStart = { ...viewBox };
    };

    return (
        <div className="relative select-none">
            <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${totalHeight}`} className="w-full h-auto bg-gray-900 rounded-md">
                <defs>
                    <clipPath id="chart-area"><rect x="0" y="0" width={chartWidth} height={chartHeight} /></clipPath>
                    {paths.map((p: any) => p && <linearGradient key={`grad-${p.key}`} id={`grad-${p.key}`} x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor={p.color} stopOpacity="0.8"/><stop offset="100%" stopColor={p.color} stopOpacity="0.5"/></linearGradient>)}
                </defs>

                {/* Main Chart Area */}
                <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
                    {yTicksLeft.map((tick:any, i:number) => <line key={`gl-l-${i}`} x1="0" y1={tick.y} x2={chartWidth} y2={tick.y} stroke="#4b5563" strokeWidth="0.5" strokeDasharray="3 3"/>)}
                    {xTicks.map((tick:any, i:number) => <line key={`gl-x-${i}`} x1={tick.x} y1="0" x2={tick.x} y2={chartHeight} stroke="#4b5563" strokeWidth="0.5" strokeDasharray="3 3"/>)}
                    <g clipPath="url(#chart-area)">
                       <g transform={`translate(${-viewBox.x * (chartWidth / viewBox.width)}, 0) scale(${chartWidth/viewBox.width}, 1)`}>
                          {paths.map((p: any) => p && !hiddenMetrics.has(p.key) && <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />)}
                          
                          {showDataPoints && activeMetrics.flatMap(({ key, axis }) => {
                              if (hiddenMetrics.has(key)) return [];
                              const yScale = axis === 'left' ? yScaleLeft : yScaleRight;
                              if (!yScale) return [];
                              return dataToRender.filter((d: any) => d[key] !== null).map((d: any) => (
                                  <ellipse
                                      key={`${key}-${d.timestamp}`}
                                      cx={xScale(d.timestamp).toFixed(2)}
                                      cy={yScale(d[key]).toFixed(2)}
                                      rx={3 / zoomRatio}
                                      ry={3}
                                      fill={METRICS[key].color}
                                      stroke="white"
                                      strokeWidth="1"
                                      vectorEffect="non-scaling-stroke"
                                  />
                              ));
                          })}

                          {anomalies.map((a:any, i:number) => !hiddenMetrics.has(a.key) && 
                            <ellipse 
                                key={`anomaly-${i}`} 
                                cx={xScale(a.timestamp).toFixed(2)} 
                                cy={a.y.toFixed(2)} 
                                rx={5 / zoomRatio} 
                                ry={5}
                                fill={a.type === 'critical' ? '#ef4444' : '#f97316'}
                                stroke="white" 
                                strokeWidth="1.5"
                                vectorEffect="non-scaling-stroke"
                            />
                          )}
                       </g>
                    </g>
                    <g>{yTicksLeft.map((tick:any, i:number) => <text key={`tl-l-${i}`} x={-8} y={tick.y} textAnchor='end' dy="0.32em" fill="#d1d5db" fontSize="12">{tick.value.toFixed(1)}</text>)}<text transform={`translate(-55, ${chartHeight / 2}) rotate(-90)`} textAnchor="middle" fill="#d1d5db" fontSize="14" fontWeight="bold">{yAxisLabelLeft}</text></g>
                    <g transform={`translate(${chartWidth}, 0)`}>{yTicksRight.map((tick:any, i:number) => <text key={`tl-r-${i}`} x={8} y={tick.y} textAnchor='start' dy="0.32em" fill="#d1d5db" fontSize="12">{tick.value.toFixed(1)}</text>)}<text transform={`translate(55, ${chartHeight / 2}) rotate(-90)`} textAnchor="middle" fill="#d1d5db" fontSize="14" fontWeight="bold">{yAxisLabelRight}</text></g>
                    <g transform={`translate(0, ${chartHeight})`}>{xTicks.map((tick:any, i:number) => <g key={`tx-${i}`} transform={`translate(${tick.x}, 0)`}><text y="20" textAnchor="middle" fill="#d1d5db" fontSize="12">{tick.label}<tspan x={0} dy="1.2em">{tick.dateLabel}</tspan></text></g>)}</g>
                    <rect width={chartWidth} height={chartHeight} fill="transparent" cursor="grab" onMouseDown={handleMouseDown} onWheel={handleWheel} onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)} />
                    {tooltip && <line x1={tooltip.x} y1="0" x2={tooltip.x} y2={chartHeight} stroke="#a3a3a3" strokeWidth="1" strokeDasharray="4 4" pointerEvents="none" />}
                </g>

                {/* Brush/Minimap Area */}
                <g transform={`translate(${MARGIN.left}, ${CHART_HEIGHT + MARGIN.bottom})`}>
                    <rect width={chartWidth} height={BRUSH_HEIGHT} fill="#27272a" />
                    {dataLODs['240']?.map((p:any, i:number) => <rect key={i} x={xScale(p.timestamp)} y={0} width="1" height={BRUSH_HEIGHT} fill="#404040" />)}
                    <rect x={viewBox.x} y="0" width={viewBox.width} height={BRUSH_HEIGHT} fill="white" fillOpacity="0.1" stroke="white" strokeOpacity="0.5" cursor="move" onMouseDown={handleBrushPanStart} />
                    <rect x={viewBox.x-4} y={0} width="8" height={BRUSH_HEIGHT} fill="white" fillOpacity={0.3} cursor="ew-resize" onMouseDown={(e) => handleBrushResizeStart(e, 'left')} />
                    <rect x={viewBox.x+viewBox.width-4} y={0} width="8" height={BRUSH_HEIGHT} fill="white" fillOpacity={0.3} cursor="ew-resize" onMouseDown={(e) => handleBrushResizeStart(e, 'right')} />
                </g>
            </svg>
            
            {tooltip && (
                <div className="absolute p-3 bg-gray-900 border border-gray-600 rounded-lg shadow-lg text-sm text-white pointer-events-none" style={{ left: tooltip.x + MARGIN.left, top: tooltip.y, transform: `translate(15px, 15px)`}}>
                    <p className="font-bold mb-2">{new Date(tooltip.point.timestamp).toLocaleString()}</p>
                    {tooltip.point.recordCount > 1 && <p className="text-xs text-gray-400 mb-2 italic">Averaged over {tooltip.point.recordCount} records</p>}
                    <table className="min-w-full text-left"><tbody>
                        {Object.keys(METRICS).filter(k => metricConfig[k as MetricKey] && !hiddenMetrics.has(k as MetricKey)).map(key => (
                            <tr key={key}><td className="pr-4 py-1 flex items-center"><div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: METRICS[key as MetricKey].color }} />{METRICS[key as MetricKey].label}</td><td className="font-mono text-right">{tooltip.point[key] !== null ? tooltip.point[key].toFixed(2) : 'N/A'} {METRICS[key as MetricKey].unit}</td></tr>
                        ))}
                    </tbody></table>
                    {tooltip.point.anomalies.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-gray-700 space-y-1">
                            {tooltip.point.anomalies.map((a:any) => <p key={a.message} className={`text-xs ${a.type === 'critical' ? 'text-red-400' : 'text-yellow-400'}`}>{a.message}</p>)}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const HistoricalChart: React.FC<{ systems: BmsSystem[], history: AnalysisRecord[] }> = ({ systems, history }) => {
    const [selectedSystemId, setSelectedSystemId] = useState<string>('');
    const [metricConfig, setMetricConfig] = useState<Partial<Record<MetricKey, { axis: Axis }>>>({ stateOfCharge: { axis: 'left' }, current: { axis: 'right' } });
    const [hiddenMetrics] = useState<Set<MetricKey>>(new Set());
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [chartData, setChartData] = useState<any | null>(null);

    const chartDimensions = useMemo(() => ({
        WIDTH: 1200, CHART_HEIGHT: 450, BRUSH_HEIGHT: 80,
        MARGIN: {top:20,right:80,bottom:80,left:80},
        get chartWidth() { return this.WIDTH - this.MARGIN.left - this.MARGIN.right },
        get chartHeight() { return this.CHART_HEIGHT - this.MARGIN.top - this.MARGIN.bottom },
        get totalHeight() { return this.CHART_HEIGHT + this.BRUSH_HEIGHT + this.MARGIN.bottom },
    }), []);
    
    const [viewBox, setViewBox] = useState({ x: 0, width: chartDimensions.chartWidth });

    const prepareChartData = useCallback(() => {
        if (!selectedSystemId) return;

        const systemHistory = history.filter(r => r.systemId === selectedSystemId).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const filteredHistory = systemHistory.filter(r => (!startDate || new Date(r.timestamp) >= new Date(startDate)) && (!endDate || new Date(r.timestamp) <= new Date(endDate)));

        if (filteredHistory.length < 2) { setChartData(null); return; }
        
        const dataLODs: Record<string, any[]> = {
            'raw': filteredHistory.map(mapRecordToPoint),
            '5': aggregateData(filteredHistory, 5),
            '15': aggregateData(filteredHistory, 15),
            '60': aggregateData(filteredHistory, 60),
            '240': aggregateData(filteredHistory, 240),
            '1440': aggregateData(filteredHistory, 1440),
        };

        const xMin=new Date(filteredHistory[0].timestamp).getTime(), xMax=new Date(filteredHistory[filteredHistory.length-1].timestamp).getTime();
        const xScale = (time:string|number) => ((new Date(time).getTime() - xMin) / (xMax - xMin || 1)) * chartDimensions.chartWidth;
        xScale.invert = (px:number) => xMin + (px / chartDimensions.chartWidth) * (xMax - xMin || 1);
        
        setChartData({ dataLODs, xScale, xMin, xMax });
        setViewBox({ x: 0, width: chartDimensions.chartWidth });

    }, [selectedSystemId, history, startDate, endDate, chartDimensions]);

    return (
        <div>
            <ChartControls 
                systems={systems} 
                selectedSystemId={selectedSystemId} setSelectedSystemId={setSelectedSystemId}
                startDate={startDate} setStartDate={setStartDate}
                endDate={endDate} setEndDate={setEndDate}
                metricConfig={metricConfig} setMetricConfig={setMetricConfig}
                onGenerate={prepareChartData}
                onResetView={() => setViewBox({ x: 0, width: chartDimensions.chartWidth })}
                hasChartData={!!chartData}
            />
            <div className="mt-4 min-h-[600px]">
                {chartData ? (
                    <SvgChart 
                        chartData={chartData}
                        metricConfig={metricConfig}
                        hiddenMetrics={hiddenMetrics}
                        viewBox={viewBox} 
                        setViewBox={setViewBox}
                        chartDimensions={chartDimensions}
                    />
                ) : (
                    <div className="flex items-center justify-center h-full text-gray-400 bg-gray-900/50 rounded-lg p-8">Select a system and generate a chart to view data.</div>
                )}
            </div>
        </div>
    );
};

export default HistoricalChart;