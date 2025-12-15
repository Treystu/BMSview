import React, { useEffect, useState } from 'react';

interface System {
  id: string;
  name: string;
  recordCount: number;
  adopted: boolean;
  createdAt: string;
  lastActive?: string;
  status: 'active' | 'inactive' | 'maintenance';
}

interface SystemCardProps {
  system: System;
  onAdopt: (systemId: string) => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
}

const SystemCard: React.FC<SystemCardProps> = ({ system, onAdopt, onRefresh }) => {
  const [loading, setLoading] = useState(false);

  const handleAdopt = async () => {
    setLoading(true);
    try {
      await onAdopt(system.id);
    } finally {
      setLoading(false);
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-500';
      case 'inactive': return 'bg-red-500';
      case 'maintenance': return 'bg-amber-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="system-card border border-gray-200 rounded-lg p-4 mb-4 bg-white shadow">
      <div className="flex justify-between items-start">
        <div className="flex-1 space-y-2">
          <h3 className="m-0 text-gray-900 text-lg font-semibold">{system.name}</h3>
          <p className="m-0 text-gray-500 text-sm">
            Records: <span className="font-semibold text-gray-900">{system.recordCount}</span>
          </p>
          <p className="m-0 text-gray-500 text-sm flex items-center gap-2">
            <span>Status:</span>
            <span
              className={`px-2 py-0.5 rounded text-white text-xs font-bold ${getStatusClass(system.status)}`}
            >
              {system.status.toUpperCase()}
            </span>
          </p>
          {system.lastActive && (
            <p className="m-0 text-gray-500 text-sm">
              Last Active: {new Date(system.lastActive).toLocaleString()}
            </p>
          )}
          <p className="m-0 text-gray-400 text-xs">
            Created: {new Date(system.createdAt).toLocaleString()}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {!system.adopted && (
            <button
              onClick={handleAdopt}
              disabled={loading}
              className={`px-4 py-2 rounded text-sm text-white ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'}`}
            >
              {loading ? 'Adopting...' : 'Adopt'}
            </button>
          )}
          <button
            onClick={onRefresh}
            className="px-4 py-2 rounded border border-gray-300 bg-gray-100 text-gray-800 text-sm hover:bg-gray-200"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
};

type AdminSystemsProps = Record<string, never>;

const AdminSystems: React.FC<AdminSystemsProps> = () => {
  const [systems, setSystems] = useState<System[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'adopted' | 'unadopted'>('unadopted');

  useEffect(() => {
    fetchSystems();
  }, [filter]);

  const fetchSystems = async () => {
    setLoading(true);
    setError(null);

    try {
      const endpoint = filter === 'unadopted'
        ? '/api/unadopted-systems'
        : filter === 'adopted'
          ? '/api/adopted-systems'
          : '/api/all-systems';

      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error(`Failed to fetch systems: ${response.statusText}`);
      }

      const data: System[] = await response.json();
      setSystems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching systems:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdoptSystem = async (systemId: string) => {
    try {
      const response = await fetch('/api/adopt-system', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ systemId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to adopt system: ${response.statusText}`);
      }

      await fetchSystems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to adopt system');
      console.error('Error adopting system:', err);
    }
  };

  const filteredSystems = systems.filter(system => {
    if (filter === 'all') return true;
    if (filter === 'adopted') return system.adopted;
    if (filter === 'unadopted') return !system.adopted;
    return true;
  });

  if (loading) {
    return (
      <div className="p-5 text-center">
        <div>Loading systems...</div>
      </div>
    );
  }

  return (
    <div className="admin-systems p-5 space-y-5">
      <div className="space-y-4">
        <h2 className="m-0 text-2xl font-semibold text-gray-900">System Management</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
          >
            All Systems ({systems.length})
          </button>
          <button
            onClick={() => setFilter('unadopted')}
            className={`px-4 py-2 rounded ${filter === 'unadopted' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
          >
            Unadopted Systems ({systems.filter(s => !s.adopted).length})
          </button>
          <button
            onClick={() => setFilter('adopted')}
            className={`px-4 py-2 rounded ${filter === 'adopted' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
          >
            Adopted Systems ({systems.filter(s => s.adopted).length})
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 text-red-700">
          {error}
        </div>
      )}

      {filteredSystems.length === 0 ? (
        <div className="text-center py-10 text-gray-500">
          <div className="text-5xl mb-4">📦</div>
          <div className="text-base">No {filter === 'all' ? '' : filter} systems found</div>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="text-sm text-gray-500">
            Showing {filteredSystems.length} system{filteredSystems.length !== 1 ? 's' : ''}
          </div>
          {filteredSystems.map(system => (
            <SystemCard
              key={system.id}
              system={system}
              onAdopt={handleAdoptSystem}
              onRefresh={fetchSystems}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminSystems;