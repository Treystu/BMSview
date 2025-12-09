import React, { useState, useEffect } from 'react';

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
  onAdopt: (systemId: string) => void;
  onRefresh: () => void;
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#10b981';
      case 'inactive': return '#ef4444';
      case 'maintenance': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  return (
    <div className="system-card" style={{
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '16px',
      backgroundColor: '#ffffff',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 8px 0', color: '#1f2937' }}>{system.name}</h3>
          <p style={{ margin: '4px 0', color: '#6b7280', fontSize: '14px' }}>
            Records: <span style={{ fontWeight: 'bold', color: '#1f2937' }}>{system.recordCount}</span>
          </p>
          <p style={{ margin: '4px 0', color: '#6b7280', fontSize: '14px' }}>
            Status: 
            <span 
              style={{ 
                marginLeft: '8px', 
                padding: '2px 8px', 
                borderRadius: '4px', 
                backgroundColor: getStatusColor(system.status),
                color: 'white',
                fontSize: '12px',
                fontWeight: 'bold'
              }}
            >
              {system.status.toUpperCase()}
            </span>
          </p>
          {system.lastActive && (
            <p style={{ margin: '4px 0', color: '#6b7280', fontSize: '14px' }}>
              Last Active: {new Date(system.lastActive).toLocaleString()}
            </p>
          )}
          <p style={{ margin: '4px 0', color: '#9ca3af', fontSize: '12px' }}>
            Created: {new Date(system.createdAt).toLocaleString()}
          </p>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {!system.adopted && (
            <button
              onClick={handleAdopt}
              disabled={loading}
              style={{
                padding: '8px 16px',
                backgroundColor: loading ? '#9ca3af' : '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px'
              }}
            >
              {loading ? 'Adopting...' : 'Adopt'}
            </button>
          )}
          <button
            onClick={onRefresh}
            style={{
              padding: '8px 16px',
              backgroundColor: '#f3f4f6',
              color: '#1f2937',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
};

interface AdminSystemsProps {
  // No props needed - single-tenant application
}

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
      
      const data = await response.json();
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
      
      // Refresh the systems list
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
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <div>Loading systems...</div>
      </div>
    );
  }

  return (
    <div className="admin-systems" style={{ padding: '20px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 16px 0', color: '#1f2937' }}>System Management</h2>
        
        <div style={{ 
          display: 'flex', 
          gap: '8px', 
          marginBottom: '16px',
          flexWrap: 'wrap'
        }}>
          <button
            onClick={() => setFilter('all')}
            style={{
              padding: '8px 16px',
              backgroundColor: filter === 'all' ? '#3b82f6' : '#f3f4f6',
              color: filter === 'all' ? 'white' : '#1f2937',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            All ({systems.length})
          </button>
          <button
            onClick={() => setFilter('adopted')}
            style={{
              padding: '8px 16px',
              backgroundColor: filter === 'adopted' ? '#3b82f6' : '#f3f4f6',
              color: filter === 'adopted' ? 'white' : '#1f2937',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Adopted ({systems.filter(s => s.adopted).length})
          </button>
          <button
            onClick={() => setFilter('unadopted')}
            style={{
              padding: '8px 16px',
              backgroundColor: filter === 'unadopted' ? '#3b82f6' : '#f3f4f6',
              color: filter === 'unadopted' ? 'white' : '#1f2937',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Unadopted ({systems.filter(s => !s.adopted).length})
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#dc2626',
          padding: '12px',
          borderRadius: '4px',
          marginBottom: '16px'
        }}>
          Error: {error}
        </div>
      )}

      {filteredSystems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📦</div>
          <div style={{ fontSize: '16px' }}>
            No {filter === 'all' ? '' : filter} systems found
          </div>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: '12px', color: '#6b7280', fontSize: '14px' }}>
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