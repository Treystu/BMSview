import React, { useState, useEffect } from 'react';
import type { BmsSystem } from '../types';

interface EditSystemModalProps {
    system: BmsSystem;
    onSave: (updatedData: Omit<BmsSystem, 'id'>) => void;
    onClose: () => void;
    isSaving: boolean;
}

const EditSystemModal: React.FC<EditSystemModalProps> = ({ system, onSave, onClose, isSaving }) => {
    const [name, setName] = useState('');
    const [chemistry, setChemistry] = useState('');
    const [voltage, setVoltage] = useState('');
    const [capacity, setCapacity] = useState('');
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    const [associatedDLs, setAssociatedDLs] = useState('');
    const [maxAmpsSolarCharging, setMaxAmpsSolarCharging] = useState('');
    const [maxAmpsGeneratorCharging, setMaxAmpsGeneratorCharging] = useState('');

    useEffect(() => {
        if (system) {
            setName(system.name);
            setChemistry(system.chemistry || '');
            setVoltage(system.voltage?.toString() || '');
            setCapacity(system.capacity?.toString() || '');
            setLatitude(system.latitude?.toString() || '');
            setLongitude(system.longitude?.toString() || '');
            setAssociatedDLs(system.associatedDLs?.join(', ') || '');
            setMaxAmpsSolarCharging(system.maxAmpsSolarCharging?.toString() || '');
            setMaxAmpsGeneratorCharging(system.maxAmpsGeneratorCharging?.toString() || '');
        }
    }, [system]);

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
                <h2 className="text-2xl font-bold text-secondary mb-6">Edit System</h2>
                <button 
                    onClick={onClose} 
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors text-3xl leading-none"
                    aria-label="Close"
                >
                    &times;
                </button>
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
                            <input
                                type="text"
                                id="chemistry-edit"
                                value={chemistry}
                                onChange={(e) => setChemistry(e.target.value)}
                                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary text-white"
                            />
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
                            {isSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditSystemModal;