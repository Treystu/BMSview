import React, { useEffect, useState } from 'react';
import type { DisplayableAnalysisResult, BmsSystem, WeatherData, AnalysisData } from '../types';
import ThermometerIcon from './icons/ThermometerIcon';
import CloudIcon from './icons/CloudIcon';
import SunIcon from './icons/SunIcon';
import { streamInsights } from '../services/clientService';
import SpinnerIcon from './icons/SpinnerIcon';
import { formatError, getIsActualError } from '../utils';

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        component: 'AnalysisResult',
        message,
        context
    }));
};

interface AnalysisResultProps {
  result: DisplayableAnalysisResult;
  registeredSystems: BmsSystem[];
  onLinkRecord: (recordId: string, systemId: string, dlNumber?: string | null) => void;
  onReprocess: (file: File) => void;
  onRegisterNewSystem: (dlNumber: string) => void;
}

const DeeperInsightsSection: React.FC<{ analysisData: AnalysisData, systemId?: string, systemName?: string }> = ({ analysisData, systemId, systemName }) => {
    const [insights, setInsights] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [customPrompt, setCustomPrompt] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleGenerateInsights = async (prompt?: string) => {
        setIsLoading(true);
        setError(null);
        setInsights('');
        
        try {
            await streamInsights(
                { analysisData, systemId, customPrompt: prompt },
                (chunk) => { setInsights(prev => prev + chunk); },
                () => { setIsLoading(false); },
                (err) => {
                    setError(err.message);
                    setIsLoading(false);
                }
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred.';
            setError(errorMessage);
            setIsLoading(false);
            log('error', 'Deeper insights stream initiation failed.', { error: errorMessage });
        }
    };

    return (
        <div className="mb-8">
            <h4 className="text-xl font-semibold text-neutral-dark mb-4">Deeper AI Insights</h4>
            {insights && (
                <div className="mb-4 p-4 bg-blue-50 border-l-4 border-secondary rounded-r-lg prose max-w-none">
                     {/* Using a <pre> tag to render markdown-like text with simple formatting */}
                    <pre className="text-neutral whitespace-pre-wrap font-sans bg-transparent p-0 m-0">{insights}</pre>
                </div>
            )}
            {isLoading && (
                <div className="flex items-center justify-center p-8 bg-gray-100 rounded-lg">
                    <SpinnerIcon className="h-6 w-6 text-secondary" />
                    <span className="ml-3 text-neutral-dark font-medium">AI is analyzing, this may take a moment...</span>
                </div>
            )}
            {error && (
                <div className="mb-4 p-4 bg-red-100 border-l-4 border-red-500 rounded-r-lg">
                    <h5 className="font-bold text-red-800">Error Generating Insights</h5>
                    <p className="text-red-700 mt-1">{error}</p>
                </div>
            )}
            {!isLoading && (
                <div className="p-4 bg-gray-100 rounded-lg space-y-4">
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                         <button
                            onClick={() => handleGenerateInsights()}
                            className="w-full sm:w-auto bg-secondary hover:bg-primary text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors"
                        >
                            Generate Standard Insights
                        </button>
                        <p className="text-sm text-gray-600 text-center sm:text-left">Get a summary, runtime estimates, and generator recommendations.</p>
                    </div>
                    <div className="border-t border-gray-300 pt-4 space-y-2">
                        <label htmlFor={`custom-prompt-${analysisData.dlNumber || 'new'}`} className="block text-sm font-medium text-gray-700">
                            Or ask a custom question about your system
                            {systemName && <span className="text-xs text-gray-500"> (context from '{systemName}' will be used)</span>}
                        </label>
                        <textarea
                            id={`custom-prompt-${analysisData.dlNumber || 'new'}`}
                            rows={3}
                            value={customPrompt}
                            onChange={e => setCustomPrompt(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                            placeholder="e.g., I want to run an extra 5A load all night. Will I have enough power until sunrise?"
                        />
                         <button
                            onClick={() => handleGenerateInsights(customPrompt)}
                            disabled={!customPrompt.trim()}
                            className="w-full sm:w-auto bg-primary hover:bg-secondary text-white font-bold py-2 px-4 rounded-lg shadow-md disabled:bg-gray-400 transition-colors"
                        >
                            Submit Custom Query
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const MetricCard: React.FC<{
  title: string;
  value: string | number | null;
  unit: string;
  cardClassName?: string;
  valueClassName?: string;
}> = ({ title, value, unit, cardClassName = 'bg-white', valueClassName = 'text-secondary' }) => (
    <div className={`p-4 rounded-lg shadow-md text-center transition-colors duration-300 ${cardClassName}`}>
        <h4 className="text-sm font-medium text-gray-500">{title}</h4>
        <p className={`text-2xl font-bold transition-colors duration-300 ${valueClassName}`}>
            {value !== null && value !== undefined ? value : 'N/A'}
            <span className="text-lg text-neutral-dark ml-1">{unit}</span>
        </p>
    </div>
);


const WeatherCard: React.FC<{ icon: React.ReactNode; title: string; value: string | number | null; unit: string; }> = ({ icon, title, value, unit }) => (
    <div className="flex items-center space-x-3 bg-white p-3 rounded-lg shadow-sm">
        <div className="text-secondary">
            {icon}
        </div>
        <div>
            <h4 className="text-xs font-medium text-gray-500">{title}</h4>
            <p className="text-md font-bold text-neutral-dark">
                {value ?? 'N/A'}
                <span className="text-sm font-normal ml-1">{unit}</span>
            </p>
        </div>
    </div>
);

const WeatherSection: React.FC<{ weather: WeatherData }> = ({ weather }) => (
    <div className="mb-8">
        <h4 className="text-xl font-semibold text-neutral-dark mb-4">Weather Conditions at Time of Analysis</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <WeatherCard icon={<ThermometerIcon className="h-6 w-6"/>} title="Temperature" value={weather.temp.toFixed(1)} unit="°C" />
            <WeatherCard icon={<CloudIcon className="h-6 w-6"/>} title="Cloud Cover" value={weather.clouds} unit="%" />
            <WeatherCard icon={<SunIcon className="h-6 w-6"/>} title="UV Index" value={weather.uvi} unit="" />
        </div>
    </div>
);


const AdoptionSection: React.FC<{
  dlNumber: string;
  systems: BmsSystem[];
  onAdopt: (systemId: string) => void;
  onRegisterNew: () => void;
  disabled?: boolean;
}> = ({ dlNumber, systems, onAdopt, onRegisterNew, disabled }) => {
  const [selectedSystemId, setSelectedSystemId] = React.useState('');

  const handleAdoptClick = () => {
    if (selectedSystemId) {
      log('info', 'Adoption "Adopt" button clicked.', { dlNumber, selectedSystemId });
      onAdopt(selectedSystemId);
    }
  };
  
  const handleRegisterClick = () => {
    log('info', 'Adoption "Register New System" button clicked.', { dlNumber });
    onRegisterNew();
  };

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSystemId = e.target.value;
    log('info', 'User changed system selection for adoption.', { dlNumber, newSystemId });
    setSelectedSystemId(newSystemId);
  };
  
  return (
    <div className={`mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
      <p className="font-semibold text-yellow-800">This DL Number is unassigned.</p>
      <p className="text-sm text-yellow-700 mb-2">You can adopt it into one of your registered systems, or register a new one.</p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <select
          value={selectedSystemId}
          onChange={handleSelectChange}
          disabled={disabled}
          className="block w-full sm:w-auto px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-secondary focus:border-secondary sm:text-sm disabled:bg-gray-200"
        >
          <option value="">Select a system...</option>
          {systems.map(system => (
            <option key={system.id} value={system.id}>{system.name}</option>
          ))}
        </select>
        <button
          onClick={handleAdoptClick}
          disabled={!selectedSystemId || disabled}
          className="bg-secondary hover:bg-primary text-white font-bold py-2 px-4 rounded-lg shadow-md disabled:bg-gray-400 transition-colors"
        >
          Adopt
        </button>
        <span className="text-sm text-gray-500 mx-2 hidden sm:inline">or</span>
        <button onClick={handleRegisterClick} disabled={disabled} className="text-secondary hover:underline text-sm font-semibold disabled:text-gray-500 disabled:no-underline">
          Register New System
        </button>
      </div>
       {disabled && <p className="text-xs text-yellow-600 mt-2">Adoption is disabled because the analysis could not be saved. Please resolve the save error shown above.</p>}
    </div>
  );
};

const ActionableInsights: React.FC<{ analysis: AnalysisData }> = ({ analysis }) => {
  const criticalAlerts = analysis.alerts?.filter(a => a.toUpperCase().startsWith('CRITICAL:')) || [];
  const warningAlerts = analysis.alerts?.filter(a => a.toUpperCase().startsWith('WARNING:')) || [];
  
  const infoAlerts = analysis.alerts?.filter(a => 
      !a.toUpperCase().startsWith('CRITICAL:') && 
      !a.toUpperCase().startsWith('WARNING:')
  ) || [];

  if (criticalAlerts.length === 0 && warningAlerts.length === 0 && infoAlerts.length === 0) {
    return null;
  }

  return (
    <div className="mb-8">
      <h4 className="text-xl font-semibold text-neutral-dark mb-4">Immediate Alerts</h4>
      
      {criticalAlerts.length > 0 && (
          <div className="mb-4 p-4 bg-red-100 border-l-4 border-red-500 rounded-r-lg">
            <div className="flex items-center">
              <svg className="h-6 w-6 text-red-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
              <h5 className="text-lg font-bold text-red-800">Immediate Action Required</h5>
            </div>
            <ul className="mt-2 list-disc list-inside space-y-1 text-red-700">
                {criticalAlerts.map((alert, index) => (
                    <li key={index}>{alert.replace(/^CRITICAL: /i, '')}</li>
                ))}
            </ul>
          </div>
      )}
      
      {warningAlerts.length > 0 && (
          <div className="mb-4 p-4 bg-yellow-100 border-l-4 border-yellow-500 rounded-r-lg">
            <div className="flex items-center">
              <svg className="h-6 w-6 text-yellow-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <h5 className="text-lg font-bold text-yellow-800">Warnings &amp; Recommendations</h5>
            </div>
            <ul className="mt-2 list-disc list-inside space-y-1 text-yellow-700">
                {warningAlerts.map((alert, index) => (
                    <li key={index}>{alert.replace(/^WARNING: /i, '')}</li>
                ))}
            </ul>
          </div>
      )}
      
      {infoAlerts.length > 0 && (
           <div className="mb-4 p-4 bg-blue-100 border-l-4 border-blue-500 rounded-r-lg">
            <div className="flex items-center">
               <svg className="h-6 w-6 text-blue-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <h5 className="text-lg font-bold text-blue-800">Information</h5>
            </div>
            <ul className="mt-2 list-disc list-inside space-y-1 text-blue-700">
                {infoAlerts.map((alert, index) => (
                    <li key={index}>{alert}</li>
                ))}
            </ul>
          </div>
      )}
    </div>
  );
};

// Helper function to determine Tailwind classes for health-based color coding
const getHealthStyles = (type: 'diff' | 'temp' | 'mos', value: number | null | undefined): { card: string; value: string } => {
    if (value == null) return { card: 'bg-white', value: 'text-secondary' };

    switch (type) {
        case 'diff': // value is in Volts
            if (value > 0.1) return { card: 'bg-red-100 border border-red-200', value: 'text-red-600' };
            if (value > 0.05) return { card: 'bg-yellow-100 border border-yellow-200', value: 'text-yellow-600' };
            break;
        case 'temp': // value is in Celsius
            if (value > 50) return { card: 'bg-red-100 border border-red-200', value: 'text-red-600' };
            if (value > 40) return { card: 'bg-yellow-100 border border-yellow-200', value: 'text-yellow-600' };
            if (value < 0) return { card: 'bg-blue-100 border border-blue-200', value: 'text-blue-600' };
            break;
        case 'mos': // value is in Celsius
            if (value > 80) return { card: 'bg-red-100 border border-red-200', value: 'text-red-600' };
            if (value > 65) return { card: 'bg-yellow-100 border border-yellow-200', value: 'text-yellow-600' };
            break;
    }
    return { card: 'bg-white', value: 'text-secondary' };
};


const AnalysisResult: React.FC<AnalysisResultProps> = ({ result, registeredSystems, onLinkRecord, onReprocess, onRegisterNewSystem }) => {
  const { fileName, data, error, weather, isDuplicate, isBatchDuplicate, file, saveError, recordId } = result;

  useEffect(() => {
    const statusContext = { fileName, error, hasData: !!data, isDuplicate, recordId };
    log('info', 'AnalysisResult component rendered/updated.', statusContext);
  }, [fileName, data, error, isDuplicate, recordId]);
  
  const isPending = !!error && !getIsActualError(result);
  const isActualError = error && getIsActualError(result);

  // Determine the actual status for display
  const getDisplayStatus = () => {
    if (data) return { key: 'completed', text: 'Completed', color: 'green' };
    const lowerError = error?.toLowerCase() || '';
    if (isActualError) return { key: 'error', text: formatError(error!), color: 'red' };
    if (isPending) {
        if (lowerError.includes('extracting')) return { key: 'processing', text: 'Extracting Data', color: 'blue' };
        if (lowerError.includes('matching')) return { key: 'processing', text: 'Matching System', color: 'blue' };
        if (lowerError.includes('fetching')) return { key: 'processing', text: 'Fetching Weather', color: 'blue' };
        if (lowerError.includes('saving')) return { key: 'processing', text: 'Saving Result', color: 'blue' };
        if (lowerError.includes('queued')) return { key: 'queued', text: 'Queued for Analysis', color: 'yellow' };
        if (lowerError.includes('submitted')) return { key: 'submitted', text: 'Submitted', color: 'gray' };
        return { key: 'processing', text: error!, color: 'blue' };
    }
    return { key: 'unknown', text: 'Unknown Status', color: 'gray' };
  };

  const displayStatus = getDisplayStatus();

  const tempStyles = getHealthStyles('temp', data?.temperature);
  const mosTempStyles = getHealthStyles('mos', data?.mosTemperature);
  const diffStyles = getHealthStyles('diff', data?.cellVoltageDifference);


  const handleReprocessClick = () => {
    if (file) {
      log('info', 'Reprocess button clicked.', { fileName });
      onReprocess(file);
    }
  };

  if (isPending) {
    return (
      <div className="bg-neutral-light p-8 rounded-xl shadow-lg max-w-4xl mx-auto">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-bold text-neutral-dark break-all flex-1">{fileName}</h3>
          <div className="ml-4">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-${displayStatus.color}-100 text-${displayStatus.color}-800 border-${displayStatus.color}-200`}>
              {displayStatus.key === 'processing' && <SpinnerIcon className={`h-3 w-3 mr-1 text-${displayStatus.color}-500`} />}
              {displayStatus.key === 'queued' && <span className="mr-1">⏳</span>}
              {displayStatus.key === 'submitted' && <span className="mr-1">📤</span>}
              {displayStatus.text}
            </span>
          </div>
        </div>
        
        <div className="flex items-center justify-center py-4">
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <SpinnerIcon className="h-6 w-6 text-secondary" />
            </div>
            <p className="text-neutral text-sm">{displayStatus.text}...</p>
            {result.submittedAt && (
              <p className="text-neutral text-xs mt-1">
                Submitted {new Date(result.submittedAt).toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const dlNumber = data?.dlNumber;
  let associatedSystemName: string | null = null;
  let adoptionNeeded = false;
  let associatedSystem: BmsSystem | undefined;

  if (dlNumber) {
    associatedSystem = registeredSystems.find(system => system.associatedDLs?.includes(dlNumber));
    if (associatedSystem) {
      associatedSystemName = associatedSystem.name;
    } else {
      adoptionNeeded = true;
    }
  }

  return (
    <div className="bg-neutral-light p-8 rounded-xl shadow-lg max-w-4xl mx-auto">
      <div className="flex justify-between items-start mb-6">
          <h3 className="text-2xl font-bold text-neutral-dark break-all flex-1">{fileName}</h3>
          <div className="ml-4">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-${displayStatus.color}-100 text-${displayStatus.color}-800 border-${displayStatus.color}-200`}>
              {displayStatus.key === 'completed' && <span className="mr-1">✅</span>}
              {displayStatus.key === 'error' && <span className="mr-1">❌</span>}
              {displayStatus.text}
            </span>
          </div>
      </div>

      {isDuplicate && (
        <div className="mb-6 p-4 bg-blue-50 border-l-4 border-blue-400 rounded-r-lg text-center">
          <p className="text-blue-800">
            {data
              ? 'This appears to be a duplicate. Showing existing analysis.'
              : isBatchDuplicate
                ? 'Skipped: A file with the same name exists in this upload batch.'
                : 'Skipped: A file with this name already exists in your history.'}
            <button
              onClick={handleReprocessClick}
              className="ml-2 font-semibold text-secondary hover:underline focus:outline-none"
              disabled={!file}
            >
              Click here to {data ? 're-process' : 'process'} anyway.
            </button>
          </p>
        </div>
      )}

      {saveError && (
        <div className="mb-6 p-4 bg-yellow-50 border-l-4 border-yellow-500 rounded-r-lg">
          <h4 className="text-lg font-semibold text-yellow-800 mb-2">Warning: Not Saved</h4>
          <p className="text-yellow-700">The analysis was successful, but the result could not be saved to your history. The data below is displayed temporarily.</p>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer font-medium text-yellow-800 hover:underline">Show error details</summary>
            <p className="mt-1 text-yellow-600 bg-yellow-100 p-2 rounded-md font-mono text-xs break-all">{saveError}</p>
          </details>
        </div>
      )}

      {isActualError && !isDuplicate && (
        <div className="p-4 bg-red-50 border-l-4 border-red-500 rounded-r-lg">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-red-500 mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <h4 className="text-lg font-semibold text-red-800 mb-2">Analysis Failed</h4>
              <p className="text-red-700 mb-3">{formatError(error)}</p>
              {error?.includes('backend_error') && (
                <div className="bg-red-100 p-3 rounded-md text-sm text-red-700 mb-3">
                  <strong>Backend Issue:</strong> We're experiencing connection problems. Please try again in a few minutes.
                </div>
              )}
              {error?.includes('timeout') && (
                <div className="bg-red-100 p-3 rounded-md text-sm text-red-700 mb-3">
                  <strong>Timeout:</strong> The analysis is taking longer than expected. You can try uploading a smaller image or wait a few minutes and try again.
                </div>
              )}
              {file && (
                <button
                  onClick={handleReprocessClick}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
                >
                  Try Again
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {data && (
        <>
           {dlNumber && (
            <div className="mb-4 text-center p-2 bg-gray-100 rounded-md">
                <span className="text-sm font-medium text-gray-600">DL Number: </span>
                <span className="font-bold text-neutral-dark tracking-wider">{dlNumber}</span>
                {associatedSystemName && (
                    <p className="text-xs text-green-700">✓ Associated with: <span className="font-semibold">{associatedSystemName}</span></p>
                )}
            </div>
          )}
          {adoptionNeeded && dlNumber && (
              <AdoptionSection
                dlNumber={dlNumber}
                systems={registeredSystems}
                onAdopt={(systemId) => {
                    if (recordId) {
                        onLinkRecord(recordId, systemId, dlNumber);
                    }
                }}
                onRegisterNew={() => onRegisterNewSystem(dlNumber)}
                disabled={!recordId}
              />
          )}

          <ActionableInsights analysis={data} />

          <DeeperInsightsSection 
            analysisData={data} 
            systemId={associatedSystem?.id}
            systemName={associatedSystem?.name}
          />

          {weather && <WeatherSection weather={weather} />}

          <div className="mb-8">
            <h4 className="text-xl font-semibold text-neutral-dark mb-4">Core Vitals</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard title="Voltage" value={data.overallVoltage != null ? data.overallVoltage.toFixed(1) : null} unit="V" />
              <MetricCard title="Current" value={data.current != null ? data.current.toFixed(1) : null} unit="A" />
              {data.power != null && <MetricCard title="Power" value={data.power.toFixed(1)} unit="W" />}
              <MetricCard title="State of Charge" value={data.stateOfCharge != null ? data.stateOfCharge.toFixed(1) : null} unit="%" />
            </div>
          </div>
          
           <div className="mb-8">
            <h4 className="text-xl font-semibold text-neutral-dark mb-4">Capacity & Cycles</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {(() => {
                  const remainingCapacity = data.remainingCapacity;
                  let fullCapacity = associatedSystem?.capacity;
                  
                  if (fullCapacity == null || fullCapacity <= 0) {
                      if (data.fullCapacity != null && data.fullCapacity > 0) {
                          fullCapacity = data.fullCapacity;
                      } else {
                          fullCapacity = null;
                      }
                  }

                  if (remainingCapacity != null || fullCapacity != null) {
                      const remainingStr = remainingCapacity != null ? remainingCapacity.toFixed(1) : '?';
                      const fullStr = fullCapacity != null ? fullCapacity.toFixed(1) : null;
                      
                      const capacityValue = fullStr ? `${remainingStr} / ${fullStr}` : remainingStr;
                      return <MetricCard title="Capacity" value={capacityValue} unit="Ah" />;
                  }
                  return <div className="hidden md:block"></div>;
              })()}
              {data.cycleCount != null && <MetricCard title="Cycles" value={data.cycleCount} unit="" />}
            </div>
          </div>
          
           <div className="mb-8">
            <h4 className="text-xl font-semibold text-neutral-dark mb-4">System Status</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {data.status && <MetricCard title="Status" value={data.status} unit="" />}
              {data.chargeMosOn != null && <MetricCard title="Charge MOS" value={data.chargeMosOn ? 'ON' : 'OFF'} unit="" />}
              {data.dischargeMosOn != null && <MetricCard title="Discharge MOS" value={data.dischargeMosOn ? 'ON' : 'OFF'} unit="" />}
              {data.balanceOn != null && <MetricCard title="Balancing" value={data.balanceOn ? 'ON' : 'OFF'} unit="" />}
            </div>
          </div>
          
           {(data.temperature != null || data.mosTemperature != null || (data.temperatures && data.temperatures.length > 1)) && (
            <div className="mb-8">
              <h4 className="text-xl font-semibold text-neutral-dark mb-4">Temperatures</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {data.temperature != null && (
                  <MetricCard title="Battery Temp" value={data.temperature.toFixed(1)} unit="°C" cardClassName={tempStyles.card} valueClassName={tempStyles.value} />
                )}
                {data.mosTemperature != null && (
                  <MetricCard title="MOS Temp" value={data.mosTemperature.toFixed(1)} unit="°C" cardClassName={mosTempStyles.card} valueClassName={mosTempStyles.value} />
                )}
                {data.temperatures && data.temperatures.slice(1).map((temp, index) => (
                   <MetricCard key={index} title={`Sensor T${index + 2}`} value={temp.toFixed(1)} unit="°C" />
                ))}
              </div>
            </div>
          )}
          
          {(data.highestCellVoltage != null || data.lowestCellVoltage != null || data.cellVoltageDifference != null || data.averageCellVoltage != null) && (
            <div className="mb-8">
              <h4 className="text-xl font-semibold text-neutral-dark mb-4">Cell Health</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {data.highestCellVoltage != null && (
                  <MetricCard title="Highest Cell" value={data.highestCellVoltage.toFixed(3)} unit="V" />
                )}
                {data.lowestCellVoltage != null && (
                  <MetricCard title="Lowest Cell" value={data.lowestCellVoltage.toFixed(3)} unit="V" />
                )}
                {data.cellVoltageDifference != null && (
                  <MetricCard title="Difference" value={(data.cellVoltageDifference * 1000).toFixed(1)} unit="mV" cardClassName={diffStyles.card} valueClassName={diffStyles.value} />
                )}
                {data.averageCellVoltage != null && (
                  <MetricCard title="Average Cell" value={data.averageCellVoltage.toFixed(3)} unit="V" />
                )}
              </div>
            </div>
          )}

           {(data.serialNumber || data.softwareVersion || data.hardwareVersion || data.snCode) && (
            <div className="mb-8">
              <h4 className="text-xl font-semibold text-neutral-dark mb-4">Device Details</h4>
              <div className="p-4 bg-white rounded-lg shadow-md text-sm text-neutral-dark space-y-2">
                {data.serialNumber && <p><strong className="font-semibold text-gray-600">Serial Number:</strong> <span className="font-mono">{data.serialNumber}</span></p>}
                {data.softwareVersion && <p><strong className="font-semibold text-gray-600">Software Version:</strong> <span className="font-mono">{data.softwareVersion}</span></p>}
                {data.hardwareVersion && <p><strong className="font-semibold text-gray-600">Hardware Version:</strong> <span className="font-mono">{data.hardwareVersion}</span></p>}
                {data.snCode && <p><strong className="font-semibold text-gray-600">SN Code:</strong> <span className="font-mono">{data.snCode}</span></p>}
              </div>
            </div>
          )}
          
          {data.cellVoltages && data.cellVoltages.length > 0 && (
            <div>
              <h4 className="text-xl font-semibold text-neutral-dark mb-4">Cell Voltage Breakdown</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {data.cellVoltages.map((voltage, index) => (
                  <div key={index} className="bg-white p-3 rounded-md shadow-sm flex justify-between items-center text-sm">
                    <span className="font-medium text-gray-600">Cell {index + 1}:</span>
                    <span className="font-bold text-primary">{voltage.toFixed(3)} V</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AnalysisResult;
