import React, { useState, useEffect } from 'react';
import type { BmsSystem } from '../types';

interface EditSystemModalProps {
    system: BmsSystem | null; // null means creating new system
    onSave: (updatedData: Omit<BmsSystem, 'id'>) => void;
    onClose: () => void;
    isSaving: boolean;
    initialData?: Partial<Omit<BmsSystem, 'id'>>; // Pre-fill data for new systems
    enableGeolocation?: boolean; // Auto-detect GPS coordinates
    error?: string | null; // Error message to display
}

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        component: 'EditSystemModal',
        message,
        context
    }));
};

const EditSystemModal: React.FC<EditSystemModalProps> = ({ 
    system, 
    onSave, 
    onClose, 
    isSaving,
    initialData,
    enableGeolocation = false,
    error
}) => {
    const [name, setName] = useState('');
    const [chemistry, setChemistry] = useState('');
    const [voltage, setVoltage] = useState('');
    const [capacity, setCapacity] = useState('');
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    const [associatedDLs, setAssociatedDLs] = useState('');
    const [maxAmpsSolarCharging, setMaxAmpsSolarCharging] = useState('');
    const [maxAmpsGeneratorCharging, setMaxAmpsGeneratorCharging] = useState('');
    const [isDetectingLocation, setIsDetectingLocation] = useState(false);
    const [geoError, setGeoError] = useState<string | null>(null);

    useEffect(() => {
        if (system) {
            // Editing existing system
            setName(system.name);
            setChemistry(system.chemistry || '');
            setVoltage(system.voltage?.toString() || '');
            setCapacity(system.capacity?.toString() || '');
            setLatitude(system.latitude?.toString() || '');
            setLongitude(system.longitude?.toString() || '');
            setAssociatedDLs(system.associatedDLs?.join(', ') || '');
            setMaxAmpsSolarCharging(system.maxAmpsSolarCharging?.toString() || '');
            setMaxAmpsGeneratorCharging(system.maxAmpsGeneratorCharging?.toString() || '');
        } else if (initialData) {
            // Creating new system with pre-filled data
            setName(initialData.name || '');
            setChemistry(initialData.chemistry || '');
            setVoltage(initialData.voltage?.toString() || '');
            setCapacity(initialData.capacity?.toString() || '');
            setLatitude(initialData.latitude?.toString() || '');
            setLongitude(initialData.longitude?.toString() || '');
            setAssociatedDLs(initialData.associatedDLs?.join(', ') || '');
            setMaxAmpsSolarCharging(initialData.maxAmpsSolarCharging?.toString() || '');
            setMaxAmpsGeneratorCharging(initialData.maxAmpsGeneratorCharging?.toString() || '');
        }
    }, [system, initialData]);

    // Auto-detect geolocation when enabled and creating new system
    useEffect(() => {
        if (enableGeolocation && !system && !latitude && !longitude) {
            handleDetectLocation();
        }
    }, [enableGeolocation, system]);

    const handleDetectLocation = () => {
        if (!navigator.geolocation) {
            log('warn', 'Geolocation is not supported by this browser.');
            setGeoError('Geolocation is not supported by your browser.');
            return;
        }

        setIsDetectingLocation(true);
        setGeoError(null);
        log('info', 'Requesting geolocation from browser...');

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude: lat, longitude: lon } = position.coords;
                log('info', 'Geolocation detected.', { latitude: lat, longitude: lon });
                setLatitude(lat.toFixed(6));
                setLongitude(lon.toFixed(6));
                setGeoError(null);
                setIsDetectingLocation(false);
            },
            (error) => {
                log('error', 'Geolocation error.', { error: error.message });
                let errorMessage = 'Unable to detect location.';
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage = 'Location permission denied. Please enable location access in your browser settings.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage = 'Location information is unavailable.';
                        break;
                    case error.TIMEOUT:
                        errorMessage = 'Location request timed out.';
                        break;
                }
                setGeoError(errorMessage);
                setIsDetectingLocation(false);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const dlsArray = associatedDLs.split(',').map(dl => dl.trim()).filter(dl => dl);

        onSave({
            name,
            chemistry,
            voltage: voltage ? parseFloat(voltage) : null,
            capacity: capacity ? parseFloat(capacity) : null,
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null,
            associatedDLs: dlsArray,
            maxAmpsSolarCharging: maxAmpsSolarCharging ? parseFloat(maxAmpsSolarCharging) : null,
            maxAmpsGeneratorCharging: maxAmpsGeneratorCharging ? parseFloat(maxAmpsGeneratorCharging) : null,
        });
    };

    return (
        <div 
            className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4"
            onClick={onClose}
            aria-modal="true"
            role="dialog"
        >
            <div 
                className="bg-gray-800 text-neutral-light rounded-xl shadow-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <h2 className="text-2xl font-bold text-secondary mb-6">
                    {system ? 'Edit System' : 'Create New System'}
                </h2>
                <button 
                    onClick={onClose} 
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors text-3xl leading-none"
                    aria-label="Close"
                >
                    &times;
                </button>
                
                {/* Display error from parent component (e.g., save error) */}
                {error && (
                    <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-md text-red-300 text-sm">
                        <strong>Error:</strong> {error}
                    </div>
                )}
                
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label htmlFor="system-name-edit" className="block text-gray-300 font-medium mb-1">System Name *</label>
                        <input
                            type="text"
                            id="system-name-edit"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary text-white"
                            required
                        />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="md:col-span-1">
                            <label htmlFor="chemistry-edit" className="block text-gray-300 font-medium mb-1">Chemistry</label>
                            <select
                                id="chemistry-edit"
                                value={chemistry}
                                onChange={(e) => setChemistry(e.target.value)}
                                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary text-white"
                            >
                                <option value="">Select...</option>
                                <option value="LiFePO4">LiFePO4</option>
                                <option value="LiPo">LiPo</option>
                                <option value="LiIon">LiIon</option>
                                <option value="LeadAcid">Lead Acid</option>
                                <option value="NiMH">NiMH</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="voltage-edit" className="block text-gray-300 font-medium mb-1">Voltage (V)</label>
                            <input
                                type="number"
                                id="voltage-edit"
                                value={voltage}
                                onChange={(e) => setVoltage(e.target.value)}
                                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary text-white"
                            />
                        </div>
                        <div>
                            <label htmlFor="capacity-edit" className="block text-gray-300 font-medium mb-1">Capacity (Ah)</label>
                            <input
                                type="number"
                                id="capacity-edit"
                                value={capacity}
                                onChange={(e) => setCapacity(e.target.value)}
                                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary text-white"
                            />
                        </div>
                    </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label htmlFor="max-solar-edit" className="block text-gray-300 font-medium mb-1">Max Amps Solar Charging</label>
                            <input
                                type="number"
                                id="max-solar-edit"
                                value={maxAmpsSolarCharging}
                                onChange={(e) => setMaxAmpsSolarCharging(e.target.value)}
                                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary text-white"
                            />
                        </div>
                        <div>
                            <label htmlFor="max-generator-edit" className="block text-gray-300 font-medium mb-1">Max Amps Generator Charging</label>
                            <input
                                type="number"
                                id="max-generator-edit"
                                value={maxAmpsGeneratorCharging}
                                onChange={(e) => setMaxAmpsGeneratorCharging(e.target.value)}
                                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary text-white"
                            />
                        </div>
                    </div>
                    <div className="mb-4">
                        <label className="block text-gray-300 font-medium mb-1">Location</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="latitude-edit" className="text-xs text-gray-400">Latitude</label>
                                <input type="number" step="any" id="latitude-edit" value={latitude} onChange={(e) => setLatitude(e.target.value)} className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary text-white" />
                            </div>
                            <div>
                                <label htmlFor="longitude-edit" className="text-xs text-gray-400">Longitude</label>
                                <input type="number" step="any" id="longitude-edit" value={longitude} onChange={(e) => setLongitude(e.target.value)} className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary text-white" />
                            </div>
                        </div>
                        {enableGeolocation && (
                            <>
                                <button
                                    type="button"
                                    onClick={handleDetectLocation}
                                    disabled={isDetectingLocation}
                                    className="mt-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md transition-colors text-sm disabled:bg-blue-900 disabled:cursor-not-allowed"
                                >
                                    {isDetectingLocation ? '🌍 Detecting...' : '📍 Use Current Location'}
                                </button>
                                {geoError && (
                                    <div className="mt-2 p-2 bg-yellow-900/50 border border-yellow-500 rounded text-yellow-200 text-xs">
                                        {geoError}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                     <div className="mb-6">
                        <label htmlFor="associated-dls-edit" className="block text-gray-300 font-medium mb-1">Associated DLs</label>
                        <textarea
                            id="associated-dls-edit"
                            value={associatedDLs}
                            onChange={(e) => setAssociatedDLs(e.target.value)}
                            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary text-white font-mono text-sm"
                            rows={2}
                            placeholder="e.g., DL-123456, DL-789012"
                        />
                        <p className="text-xs text-gray-400 mt-1">Enter DL numbers separated by commas.</p>
                    </div>

                    <div className="flex justify-end space-x-4">
                        <button 
                            type="button" 
                            onClick={onClose}
                            className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            type="submit"
                            disabled={isSaving || !name}
                            className="bg-secondary hover:bg-primary text-white font-bold py-2 px-6 rounded-lg shadow-md disabled:bg-gray-500 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center"
                        >
                            {isSaving ? 'Saving...' : (system ? 'Save Changes' : 'Create System')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditSystemModal;