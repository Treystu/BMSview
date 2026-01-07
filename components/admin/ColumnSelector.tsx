import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ALL_HISTORY_COLUMNS, HistoryColumnKey, ColumnDefinition } from './columnDefinitions';

interface ColumnSelectorProps {
    visibleColumns: HistoryColumnKey[];
    onVisibleColumnsChange: (columns: HistoryColumnKey[]) => void;
}

const ColumnSelector: React.FC<ColumnSelectorProps> = ({ visibleColumns, onVisibleColumnsChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const groupedColumns = useMemo(() => {
        return Object.entries(ALL_HISTORY_COLUMNS).reduce((acc, [key, def]) => {
            if (!acc[def.group]) {
                acc[def.group] = [];
            }
            acc[def.group].push({ key: key as HistoryColumnKey, ...def });
            return acc;
        }, {} as Record<string, (ColumnDefinition & { key: HistoryColumnKey })[]>);
    }, []);

    const handleToggleColumn = (key: HistoryColumnKey) => {
        const newVisibleColumns = visibleColumns.includes(key)
            ? visibleColumns.filter(c => c !== key)
            : [...visibleColumns, key];
        onVisibleColumnsChange(newVisibleColumns);
    };

    return (
        <div className="relative inline-block text-left" ref={dropdownRef}>
            <div>
                <button
                    type="button"
                    onClick={() => setIsOpen(!isOpen)}
                    className="inline-flex justify-center w-full rounded-md border border-gray-600 shadow-sm px-4 py-2 bg-gray-700 text-sm font-medium text-gray-300 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-secondary"
                    aria-haspopup="true"
                    aria-expanded={isOpen}
                >
                    Columns
                    <svg className="-mr-1 ml-2 h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>
            </div>
            {isOpen && (
                <div className="origin-top-right absolute right-0 mt-2 w-96 rounded-md shadow-lg bg-gray-800 ring-1 ring-black ring-opacity-5 z-10 p-4 max-h-96 overflow-y-auto">
                    <div className="space-y-4">
                        {Object.entries(groupedColumns).map(([groupName, columns]) => (
                            <div key={groupName}>
                                <h4 className="font-semibold text-gray-400 text-xs uppercase tracking-wider mb-2">{groupName}</h4>
                                <div className="grid grid-cols-2 gap-2">
                                    {columns.map(({ key, label }) => (
                                        <label key={key} className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer p-1 rounded hover:bg-gray-700">
                                            <input
                                                type="checkbox"
                                                checked={visibleColumns.includes(key)}
                                                onChange={() => handleToggleColumn(key)}
                                                className="form-checkbox h-4 w-4 bg-gray-900 border-gray-600 text-secondary focus:ring-secondary focus:ring-offset-gray-800"
                                            />
                                            <span>{label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ColumnSelector;
