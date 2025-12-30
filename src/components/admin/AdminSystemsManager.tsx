import React, { useEffect, useState } from 'react';
import { AdminAction } from '../../state/adminState';
import type { BmsSystem } from '../../types';

interface AdminSystemsManagerProps {
    editingSystem: BmsSystem | null;
    dispatch: React.Dispatch<AdminAction>;
    onClose: () => void;
    onSave: (system: BmsSystem) => Promise<void>;
    onDelete?: (systemId: string) => Promise<void>;
}

/**
 * AdminSystemsManager - Full CRUD UI for BMS Systems
 * 
 * Features:
 * - Create new systems
 * - Edit existing systems
 * - Update all system metadata (name, chemistry, specs, location, DLs)
 * - Delete systems with confirmation
 * - Real-time validation
 */
const AdminSystemsManager: React.FC<AdminSystemsManagerProps> = ({
    editingSystem,
    onClose,
    onSave,
    onDelete
}) => {
    const isEditing = !!editingSystem;
    const [formData, setFormData] = useState<Partial<BmsSystem>>({
        name: '',
        chemistry: '',
        voltage: undefined,
        capacity: undefined,
        latitude: undefined,
        longitude: undefined,
        associatedHardwareIds: [],
    });
    const [hwIdInput, setHwIdInput] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

    // Initialize form data when editing system changes
    useEffect(() => {
        if (editingSystem) {
            setFormData({
                id: editingSystem.id,
                name: editingSystem.name || '',
                chemistry: editingSystem.chemistry || '',
                voltage: editingSystem.voltage,
                capacity: editingSystem.capacity,
                latitude: editingSystem.latitude,
                longitude: editingSystem.longitude,
                associatedHardwareIds: editingSystem.associatedHardwareIds || editingSystem.associatedDLs || [],
            });
        } else {
            // Reset for new system creation
            setFormData({
                name: '',
                chemistry: '',
                voltage: undefined,
                capacity: undefined,
                latitude: undefined,
                longitude: undefined,
                associatedHardwareIds: [],
            });
        }
        setError(null);
        setValidationErrors({});
        setShowDeleteConfirm(false);
    }, [editingSystem]);

    const validateForm = (): boolean => {
        const errors: Record<string, string> = {};

        if (!formData.name || formData.name.trim() === '') {
            errors.name = 'System name is required';
        }

        if (formData.voltage !== undefined && formData.voltage !== null && (formData.voltage <= 0 || formData.voltage > 1000)) {
            errors.voltage = 'Voltage must be greater than 0 and less than or equal to 1000V';
        }

        if (formData.capacity !== undefined && formData.capacity !== null && (formData.capacity <= 0 || formData.capacity > 10000)) {
            errors.capacity = 'Capacity must be greater than 0 and less than or equal to 10000Ah';
        }

        if (formData.latitude !== undefined && formData.latitude !== null && (formData.latitude < -90 || formData.latitude > 90)) {
            errors.latitude = 'Latitude must be between -90 and 90';
        }

        if (formData.longitude !== undefined && formData.longitude !== null && (formData.longitude < -180 || formData.longitude > 180)) {
            errors.longitude = 'Longitude must be between -180 and 180';
        }

        setValidationErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!validateForm()) {
            return;
        }

        setIsSaving(true);
        setError(null);

        try {
            const systemToSave: BmsSystem = {
                id: formData.id || crypto.randomUUID(),
                name: formData.name!,
                chemistry: formData.chemistry || undefined,
                voltage: formData.voltage ?? null,
                capacity: formData.capacity ?? null,
                latitude: formData.latitude ?? null,
                longitude: formData.longitude ?? null,
                associatedHardwareIds: formData.associatedHardwareIds || [],
            };

            await onSave(systemToSave);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save system');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!editingSystem || !onDelete) return;

        setIsDeleting(true);
        setError(null);

        try {
            await onDelete(editingSystem.id);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete system');
        } finally {
            setIsDeleting(false);
            setShowDeleteConfirm(false);
        }
    };

    const handleAddHwId = () => {
        if (hwIdInput.trim()) {
            // Check for duplicates
            if (formData.associatedHardwareIds?.includes(hwIdInput.trim())) {
                return;
            }
            const updatedIds = [...(formData.associatedHardwareIds || []), hwIdInput.trim()];
            setFormData({ ...formData, associatedHardwareIds: updatedIds });
            setHwIdInput('');
        }
    };

    const handleRemoveHwId = (idToRemove: string) => {
        const updatedIds = (formData.associatedHardwareIds || []).filter(id => id !== idToRemove);
        setFormData({ ...formData, associatedHardwareIds: updatedIds });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-neutral-dark rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="bg-gray-800 px-6 py-4 border-b border-gray-700 sticky top-0 z-10">
                    <h2 className="text-2xl font-semibold text-secondary">
                        {isEditing ? 'Edit System' : 'Create New System'}
                    </h2>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Error Display */}
                    {error && (
                        <div className="bg-red-900 bg-opacity-20 border border-red-500 text-red-200 px-4 py-3 rounded">
                            {error}
                        </div>
                    )}

                    {/* Basic Information */}
                    <section>
                        <h3 className="text-lg font-semibold text-secondary mb-3">Basic Information</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">
                                    System Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-secondary"
                                    placeholder="e.g., Main Battery Bank"
                                />
                                {validationErrors.name && (
                                    <p className="text-red-400 text-sm mt-1">{validationErrors.name}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Chemistry</label>
                                <select
                                    value={formData.chemistry}
                                    onChange={(e) => setFormData({ ...formData, chemistry: e.target.value })}
                                    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-secondary"
                                >
                                    <option value="">Select chemistry...</option>
                                    <option value="LiFePO4">LiFePO4 (Lithium Iron Phosphate)</option>
                                    <option value="NMC">NMC (Nickel Manganese Cobalt)</option>
                                    <option value="LTO">LTO (Lithium Titanate)</option>
                                    <option value="Lead-Acid">Lead-Acid</option>
                                    <option value="AGM">AGM (Absorbed Glass Mat)</option>
                                    <option value="Gel">Gel</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>
                        </div>
                    </section>

                    {/* Specifications */}
                    <section>
                        <h3 className="text-lg font-semibold text-secondary mb-3">Specifications</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Voltage (V)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={formData.voltage || ''}
                                    onChange={(e) => setFormData({ ...formData, voltage: parseFloat(e.target.value) || undefined })}
                                    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-secondary"
                                    placeholder="e.g., 48"
                                />
                                {validationErrors.voltage && (
                                    <p className="text-red-400 text-sm mt-1">{validationErrors.voltage}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Capacity (Ah)</label>
                                <input
                                    type="number"
                                    step="1"
                                    value={formData.capacity || ''}
                                    onChange={(e) => setFormData({ ...formData, capacity: parseFloat(e.target.value) || undefined })}
                                    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-secondary"
                                    placeholder="e.g., 200"
                                />
                                {validationErrors.capacity && (
                                    <p className="text-red-400 text-sm mt-1">{validationErrors.capacity}</p>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Location */}
                    <section>
                        <h3 className="text-lg font-semibold text-secondary mb-3">Location</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Latitude</label>
                                <input
                                    type="number"
                                    step="any"
                                    value={formData.latitude || ''}
                                    onChange={(e) => setFormData({ ...formData, latitude: parseFloat(e.target.value) || undefined })}
                                    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-secondary"
                                    placeholder="e.g., 21.3099"
                                />
                                {validationErrors.latitude && (
                                    <p className="text-red-400 text-sm mt-1">{validationErrors.latitude}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Longitude</label>
                                <input
                                    type="number"
                                    step="any"
                                    value={formData.longitude || ''}
                                    onChange={(e) => setFormData({ ...formData, longitude: parseFloat(e.target.value) || undefined })}
                                    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-secondary"
                                    placeholder="e.g., -157.8581"
                                />
                                {validationErrors.longitude && (
                                    <p className="text-red-400 text-sm mt-1">{validationErrors.longitude}</p>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Associated DL Numbers */}
                    <section>
                        <h3 className="text-lg font-semibold text-secondary mb-3">Associated Hardware IDs</h3>
                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={hwIdInput}
                                    onChange={(e) => setHwIdInput(e.target.value)}
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddHwId())}
                                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-secondary"
                                    placeholder="Enter Hardware ID..."
                                />
                                <button
                                    type="button"
                                    onClick={handleAddHwId}
                                    className="px-4 py-2 bg-secondary text-white rounded hover:bg-opacity-90 transition-colors"
                                >
                                    Add
                                </button>
                            </div>

                            {formData.associatedHardwareIds && formData.associatedHardwareIds.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {formData.associatedHardwareIds.map((id, index) => (
                                        <div key={index} className="bg-gray-800 px-3 py-1 rounded flex items-center gap-2">
                                            <span className="font-mono text-sm">{id}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveHwId(id)}
                                                className="text-red-400 hover:text-red-300"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Actions */}
                    <div className="flex justify-between items-center pt-4 border-t border-gray-700">
                        <div>
                            {isEditing && onDelete && !showDeleteConfirm && (
                                <button
                                    type="button"
                                    onClick={() => setShowDeleteConfirm(true)}
                                    className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                                    disabled={isDeleting}
                                >
                                    Delete System
                                </button>
                            )}
                            {showDeleteConfirm && (
                                <div className="flex gap-2">
                                    <span className="text-red-400 text-sm py-2">Confirm deletion?</span>
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                                        disabled={isDeleting}
                                    >
                                        {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                                disabled={isSaving || isDeleting}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 bg-secondary text-white rounded hover:bg-opacity-90 transition-colors"
                                disabled={isSaving || isDeleting}
                            >
                                {isSaving ? 'Saving...' : (isEditing ? 'Save Changes' : 'Create System')}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AdminSystemsManager;
