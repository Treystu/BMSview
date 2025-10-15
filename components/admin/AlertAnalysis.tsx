import React from 'react';
import { AlertAnalysis as AlertAnalysisData } from '../../services/clientService';

interface AlertAnalysisProps {
    data: AlertAnalysisData;
}

const AlertAnalysis: React.FC<AlertAnalysisProps> = ({ data }) => {
    const topAlerts = data.alertCounts.slice(0, 10);
    const maxCount = topAlerts.length > 0 ? topAlerts[0].count : 0;

    const getAlertSeverity = (alertText: string): 'critical' | 'warning' | 'info' => {
        const upperText = alertText.toUpperCase();
        if (upperText.startsWith('CRITICAL:')) return 'critical';
        if (upperText.startsWith('WARNING:')) return 'warning';
        return 'info';
    };

    return (
        <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
            <h3 className="font-semibold text-lg text-white mb-2">Recurring Alert Analysis</h3>
            <p className="text-sm text-gray-400 mb-4">
                Top {topAlerts.length} recurring alerts out of a total of <strong className="text-white">{data.totalAlerts}</strong> found in this system's history.
            </p>
            <div className="space-y-4">
                {topAlerts.map(({ alert, count }) => {
                    const severity = getAlertSeverity(alert);
                    const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;

                    let severityColor = 'bg-blue-500';
                    if (severity === 'critical') severityColor = 'bg-red-500';
                    else if (severity === 'warning') severityColor = 'bg-yellow-500';

                    return (
                        <div key={alert}>
                            <div className="flex justify-between items-center text-xs mb-1">
                                <span className="text-gray-300 truncate pr-4" title={alert}>
                                    {alert.replace(/^(CRITICAL:|WARNING:)\s*/i, '')}
                                </span>
                                <span className="font-bold text-white">{count}</span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-2.5">
                                <div 
                                    className={`h-2.5 rounded-full ${severityColor}`} 
                                    style={{ width: `${barWidth}%` }}
                                ></div>
                            </div>
                        </div>
                    );
                })}
                 {data.alertCounts.length === 0 && (
                    <p className="text-center text-gray-500 text-sm p-4">No alerts found in this system's history.</p>
                )}
            </div>
        </div>
    );
};

export default AlertAnalysis;