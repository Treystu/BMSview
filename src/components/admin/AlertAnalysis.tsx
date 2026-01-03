import React from 'react';
import { AlertAnalysis as AlertAnalysisData } from '../../services/clientService';

interface AlertAnalysisProps {
    data: AlertAnalysisData;
}

const AlertAnalysis: React.FC<AlertAnalysisProps> = ({ data }) => {
    // Sort by duration (descending) and take top 10
    const topEvents = data.events.sort((a, b) => b.totalDurationMinutes - a.totalDurationMinutes).slice(0, 10);
    const maxDuration = topEvents.length > 0 ? topEvents[0].totalDurationMinutes : 0;

    const getAlertSeverity = (alertText: string): 'critical' | 'warning' | 'info' => {
        const upperText = alertText.toUpperCase();
        if (upperText.startsWith('CRITICAL:')) return 'critical';
        if (upperText.startsWith('WARNING:')) return 'warning';
        return 'info';
    };

    const formatDuration = (minutes: number) => {
        if (minutes < 1) return '< 1m';
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    };

    return (
        <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
            <h3 className="font-semibold text-lg text-white mb-2">Recurring Alert Analysis</h3>
            <p className="text-sm text-gray-400 mb-4">
                Top {topEvents.length} alerts by duration. Total downtime: <strong className="text-white">{formatDuration(data.totalDurationMinutes)}</strong> across <strong className="text-white">{data.totalEvents}</strong> events.
            </p>
            <div className="space-y-4">
                {topEvents.map((event) => {
                    const severity = getAlertSeverity(event.alert);
                    const barWidth = maxDuration > 0 ? (event.totalDurationMinutes / maxDuration) * 100 : 0;

                    let severityColor = 'bg-blue-500';
                    if (severity === 'critical') severityColor = 'bg-red-500';
                    else if (severity === 'warning') severityColor = 'bg-yellow-500';

                    return (
                        <div key={event.alert}>
                            <div className="flex justify-between items-center text-xs mb-1">
                                <span className="text-gray-300 truncate pr-4" title={`Average duration: ${formatDuration(event.avgDurationMinutes)}`}>
                                    {event.alert.replace(/^(CRITICAL:|WARNING:)\s*/i, '')}
                                </span>
                                <div className="text-right">
                                    <span className="font-bold text-white block">{formatDuration(event.totalDurationMinutes)}</span>
                                    <span className="text-gray-500 text-[10px]">{event.count} events</span>
                                </div>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-2.5 mt-1">
                                <div
                                    className={`h-2.5 rounded-full ${severityColor}`}
                                    style={{ width: `${barWidth}%` }}
                                ></div>
                            </div>
                        </div>
                    );
                })}
                 {data.events.length === 0 && (
                    <p className="text-center text-gray-500 text-sm p-4">No alerts found in this system history.</p>
                )}
            </div>
        </div>
    );
};

export default AlertAnalysis;