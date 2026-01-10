

import React, { useState, useEffect } from 'react';
import type { BmsSystem } from '../types';
import SpinnerIcon from './icons/SpinnerIcon';

interface RegisterBmsProps {
    onRegister: (systemData: Omit<BmsSystem, 'id' | 'associatedHardwareIds'>) => void;
    isRegistering: boolean;
    error: string | null;
    successMessage: string | null;
    isOpen: boolean;
    onClose: () => void;
}

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        component: 'RegisterBms',
        message,
        context
    }));
};

const RegisterBms: React.FC<RegisterBmsProps> = ({ onRegister, isRegistering, error, successMessage, isOpen, onClose }) => {
    const [name, setName] = useState('');
    const [chemistry, setChemistry] = useState('');
    const [voltage, setVoltage] = useState<string>('');
    const [capacity, setCapacity] = useState<string>('');
    const [latitude, setLatitude] = useState<string>('');
    const [longitude, setLongitude] = useState<string>('');
    const [maxAmpsSolarCharging, setMaxAmpsSolarCharging] = useState<string>('');
    const [maxAmpsGeneratorCharging, setMaxAmpsGeneratorCharging] = useState<string>('');
    const [locationError, setLocationError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            log('info', 'Registration modal opened.');
        }
        // Reset form state when the modal is closed to ensure it's fresh next time.
        if (!isOpen) {
            setName('');
            setChemistry('');
            setVoltage('');
            setCapacity('');
            setLatitude('');
            setLongitude('');
            setMaxAmpsSolarCharging('');
            setMaxAmpsGeneratorCharging('');
            setLocationError(null);
        }
    }, [isOpen]);

    // Log state changes from props
    useEffect(() => {
        if (error) {
            log('error', 'Registration error received from parent.', { error });
        }
        if (successMessage) {
            log('info', 'Registration success message received from parent.', { successMessage });
        }
    }, [error, successMessage]);


    const handleGetCurrentLocation = () => {
        if (!navigator.geolocation) {
            log('warn', 'Geolocation is not supported by this browser.');
            setLocationError("Geolocation is not supported by your browser.");
            return;
        }

        log('info', 'Attempting to get current location.');
        setLocationError(null);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                log('info', 'Successfully retrieved current location.', { lat: position.coords.latitude, lon: position.coords.longitude });
                setLatitude(position.coords.latitude.toFixed(6));
                setLongitude(position.coords.longitude.toFixed(6));
            },
            () => {
                log('error', 'Failed to retrieve current location.');
                setLocationError("Unable to retrieve your location. Please check browser permissions.");
            }
        );
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const systemData = {
            name,
            chemistry,
            voltage: voltage ? parseFloat(voltage) : null,
            capacity: capacity ? parseFloat(capacity) : null,
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null,
            associatedHardwareIds: [], // Start with empty array for new systems
            maxAmpsSolarCharging: maxAmpsSolarCharging ? parseFloat(maxAmpsSolarCharging) : null,
            maxAmpsGeneratorCharging: maxAmpsGeneratorCharging ? parseFloat(maxAmpsGeneratorCharging) : null,
        };
        log('info', 'Submitting new system registration.', { name: systemData.name, hasLocation: !!systemData.latitude });
        onRegister(systemData);
    };

    if (!isOpen) {
        return null;
    }

    return (
        <div 
            className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4"
            onClick={onClose}
            aria-modal="true"
            role="dialog"
        >
            <div 
                className="bg-white rounded-xl shadow-2xl w-full max-w-xl p-6 sm:p-8 relative max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                {successMessage ? (
                     <div className="text-center p-8">
                        <h3 className="text-2xl font-bold text-secondary mb-2">Success!</h3>
                        <p className="text-neutral">{successMessage}</p>
                        <button 
                            onClick={onClose} 
                            className="mt-6 bg-secondary hover:bg-primary text-white font-bold py-2 px-6 rounded-lg transition-colors"
                        >
                            Done
                        </button>
                    </div>
                ) : (
                    <>
                        <button 
                            onClick={onClose} 
                            className="absolute top-4 right-4 text-gray-400 hover:text-gray-800 transition-colors text-3xl leading-none"
                            aria-label="Close"
                        >
                            &times;
                        </button>
                        <div className="text-center">
                            <h2 className="text-3xl font-bold text-neutral-dark mb-4">Register Your BMS System</h2>
                            <p className="text-neutral mb-8">
                                Register your system with its location to enable weather-based performance analysis.
                            </p>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="mb-4">
                                <label htmlFor="system-name" className="block text-gray-700 font-medium mb-1">System Name *</label>
                                <input
                                    type="text"
                                    id="system-name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                                    required
                                    placeholder="e.g., Garage Power Wall"
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                 <div className="md:col-span-1">
                                    <label htmlFor="chemistry" className="block text-gray-700 font-medium mb-1">Chemistry</label>
                                    <input
                                        type="text"
                                        id="chemistry"
                                        value={chemistry}
                                        onChange={(e) => setChemistry(e.target.value)}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                                        placeholder="e.g., LiFePO4"
                                    />
                                </div>
                                 <div>
                                    <label htmlFor="voltage" className="block text-gray-700 font-medium mb-1">Voltage (V)</label>
                                    <input
                                        type="number"
                                        id="voltage"
                                        value={voltage}
                                        onChange={(e) => setVoltage(e.target.value)}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                                        placeholder="e.g., 48"
                                    />
                                </div>
                                 <div>
                                    <label htmlFor="capacity" className="block text-gray-700 font-medium mb-1">Capacity (Ah)</label>
                                    <input
                                        type="number"
                                        id="capacity"
                                        value={capacity}
                                        onChange={(e) => setCapacity(e.target.value)}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                                        placeholder="e.g., 100"
                                    />
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label htmlFor="max-solar" className="block text-gray-700 font-medium mb-1">Max Amps Solar Charging</label>
                                    <input
                                        type="number"
                                        id="max-solar"
                                        value={maxAmpsSolarCharging}
                                        onChange={(e) => setMaxAmpsSolarCharging(e.target.value)}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                                        placeholder="e.g., 30"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="max-generator" className="block text-gray-700 font-medium mb-1">Max Amps Generator Charging</label>
                                    <input
                                        type="number"
                                        id="max-generator"
                                        value={maxAmpsGeneratorCharging}
                                        onChange={(e) => setMaxAmpsGeneratorCharging(e.target.value)}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                                        placeholder="e.g., 50"
                                    />
                                </div>
                            </div>

                            <div className="mb-4">
                                <div className="flex justify-between items-center mb-1">
                                    <label className="block text-gray-700 font-medium">Location (for Weather)</label>
                                    <button type="button" onClick={handleGetCurrentLocation} className="text-sm text-secondary font-semibold hover:underline">Get Current Location</button>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="latitude" className="text-xs text-gray-500">Latitude</label>
                                        <input type="number" step="any" id="latitude" value={latitude} onChange={(e) => setLatitude(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary" placeholder="e.g., 34.0522" />
                                    </div>
                                    <div>
                                        <label htmlFor="longitude" className="text-xs text-gray-500">Longitude</label>
                                        <input type="number" step="any" id="longitude" value={longitude} onChange={(e) => setLongitude(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary" placeholder="e.g., -118.2437" />
                                    </div>
                                </div>
                                 {locationError && <p className="mt-2 text-xs text-red-600">{locationError}</p>}
                            </div>

                            <button 
                                type="submit"
                                disabled={isRegistering || !name}
                                className="w-full mt-6 bg-secondary hover:bg-primary text-white font-bold py-3 px-4 rounded-lg shadow-md disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center"
                            >
                                 {isRegistering ? (
                                    <>
                                        <SpinnerIcon className="-ml-1 mr-3 h-5 w-5 text-white" />
                                        Registering...
                                    </>
                                    ) : (
                                    'Register System'
                                )}
                            </button>
                            {error && <p className="mt-4 text-sm text-red-600 text-center">{error}</p>}
                        </form>
                    </>
                )}
            </div>
        </div>
    );
};

export default RegisterBms;
