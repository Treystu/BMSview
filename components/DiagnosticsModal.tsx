
import React from 'react';
import SpinnerIcon from './icons/SpinnerIcon';

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: Record<string, { status: string; message: string }>;
  isLoading: boolean;
}

const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({ isOpen, onClose, results, isLoading }) => {
  if (!isOpen) return null;

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'success':
        return 'text-green-400';
      case 'failure':
        return 'text-red-400';
      default:
        return 'text-yellow-400';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center border-b border-gray-600 pb-3 mb-4">
          <h2 className="text-xl font-semibold text-secondary">System Diagnostics</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">&times;</button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <SpinnerIcon className="w-8 h-8 text-secondary" />
            <span className="ml-4 text-lg">Running diagnostic tests...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(results).map(([key, result]) => {
              // Support suggestions array as a special key
              if (key === 'suggestions' && Array.isArray(result)) {
                return (
                  <div key={key} className="bg-gray-700 p-4 rounded-md">
                    <h3 className="font-semibold text-lg">Suggestions</h3>
                    <ul className="list-disc list-inside text-gray-300 mt-2">
                      {result.map((s, idx) => <li key={idx}>{String(s)}</li>)}
                    </ul>
                  </div>
                );
              }

              const r = result as any;
              return (
                <div key={key} className="bg-gray-700 p-4 rounded-md">
                  <h3 className="font-semibold text-lg capitalize flex items-center">
                    <span className={`mr-2 ${getStatusColor(r.status || '')}`}>
                      {r && r.status === 'Success' ? '✔' : r && r.status === 'Failure' ? '✖' : 'ℹ'}
                    </span>
                    {key.replace(/([A-Z])/g, ' $1')}
                  </h3>
                  <p className="text-gray-300 mt-1 pl-6">{r && r.message ? String(r.message) : ''}</p>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 text-right">
          <button
            onClick={onClose}
            className="bg-secondary hover:bg-secondary-dark text-white font-bold py-2 px-4 rounded-md transition duration-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsModal;
