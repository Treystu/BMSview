/**
 * User acceptance testing for admin panel updates
 */

const { MongoClient } = require('mongodb');

// Mock database for testing
const mockDatabase = {
  systems: [
    {
      _id: 'system-1',
      name: 'Battery System Alpha',
      adopted: false,
      createdAt: new Date('2024-01-15'),
      type: 'lithium-ion',
      recordCount: 150
    },
    {
      _id: 'system-2',
      name: 'Energy Storage Beta',
      adopted: false,
      createdAt: new Date('2024-02-20'),
      type: 'lead-acid',
      recordCount: 75
    },
    {
      _id: 'system-3',
      name: 'Solar Battery Gamma',
      adopted: true,
      adoptedBy: 'admin-user',
      adoptedAt: new Date('2024-03-10'),
      type: 'lithium-ion',
      recordCount: 200
    }
  ],
  records: [
    { systemId: 'system-1', data: 'sample1' },
    { systemId: 'system-1', data: 'sample2' },
    { systemId: 'system-2', data: 'sample3' },
    { systemId: 'system-3', data: 'sample4' },
    { systemId: 'system-3', data: 'sample5' }
  ]
};

describe('Admin Panel User Acceptance Tests', () => {
  let adminFunction;

  beforeEach(() => {
    // Mock the admin systems function
    adminFunction = require('../netlify/functions/admin-systems').handler;
  });

  describe('System Management Features', () => {
    test('should display unadopted systems with correct counts', async () => {
      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          filter: 'unadopted',
          userId: 'admin-user'
        }
      };

      // Mock MongoDB responses
      jest.mock('mongodb', () => ({
        MongoClient: {
          prototype: {
            connect: jest.fn().mockResolvedValue(),
            db: jest.fn().mockReturnValue({
              collection: jest.fn().mockReturnValue({
                aggregate: jest.fn().mockReturnValue({
                  toArray: jest.fn().mockResolvedValue(mockDatabase.systems.filter(s => !s.adopted))
                })
              })
            })
          }
        }
      }));

      const result = await adminFunction(event);
      
      expect(result.statusCode).toBe(200);
      const systems = JSON.parse(result.body);
      
      expect(systems).toHaveLength(2);
      expect(systems[0].name).toBe('Battery System Alpha');
      expect(systems[0].recordCount).toBe(150);
      expect(systems[0].adopted).toBe(false);
      expect(systems[0].status).toBe('active');
    });

    test('should display adopted systems with adoption info', async () => {
      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          filter: 'adopted',
          userId: 'admin-user'
        }
      };

      // Mock adopted systems response
      const adoptedSystems = mockDatabase.systems
        .filter(s => s.adopted && s.adoptedBy === 'admin-user')
        .map(s => ({
          ...s,
          id: s._id,
          status: s.recordCount > 0 ? 'active' : 'inactive',
          lastActive: new Date().toISOString()
        }));

      jest.mock('mongodb', () => ({
        MongoClient: {
          prototype: {
            connect: jest.fn().mockResolvedValue(),
            db: jest.fn().mockReturnValue({
              collection: jest.fn().mockReturnValue({
                aggregate: jest.fn().mockReturnValue({
                  toArray: jest.fn().mockResolvedValue(adoptedSystems)
                })
              })
            })
          }
        }
      }));

      const result = await adminFunction(event);
      
      expect(result.statusCode).toBe(200);
      const systems = JSON.parse(result.body);
      
      expect(systems).toHaveLength(1);
      expect(systems[0].name).toBe('Solar Battery Gamma');
      expect(systems[0].adopted).toBe(true);
      expect(systems[0].status).toBe('active');
      expect(systems[0].lastActive).toBeDefined();
    });

    test('should handle system adoption successfully', async () => {
      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          systemId: 'system-1',
          userId: 'admin-user'
        })
      };

      // Mock successful adoption
      jest.mock('mongodb', () => ({
        MongoClient: {
          prototype: {
            connect: jest.fn().mockResolvedValue(),
            db: jest.fn().mockReturnValue({
              collection: jest.fn().mockReturnValue({
                findOne: jest.fn().mockResolvedValue(mockDatabase.systems[0]),
                updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
                insertOne: jest.fn().mockResolvedValue({ insertedId: 'log-id' })
              })
            })
          }
        }
      }));

      const result = await adminFunction(event);
      
      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      
      expect(response.success).toBe(true);
      expect(response.message).toContain('adopted successfully');
    });

    test('should prevent adoption of already adopted systems', async () => {
      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          systemId: 'system-3',
          userId: 'admin-user'
        })
      };

      // Mock already adopted system
      jest.mock('mongodb', () => ({
        MongoClient: {
          prototype: {
            connect: jest.fn().mockResolvedValue(),
            db: jest.fn().mockReturnValue({
              collection: jest.fn().mockReturnValue({
                findOne: jest.fn().mockResolvedValue(mockDatabase.systems[2]) // Already adopted
              })
            })
          }
        }
      }));

      const result = await adminFunction(event);
      
      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      
      expect(response.error).toContain('already adopted');
    });

    test('should handle filtering between all/adopted/unadopted systems', async () => {
      const filters = ['all', 'adopted', 'unadopted'];
      const expectedCounts = [3, 1, 2];

      for (let i = 0; i < filters.length; i++) {
        const event = {
          httpMethod: 'GET',
          queryStringParameters: {
            filter: filters[i],
            userId: 'admin-user'
          }
        };

        // Mock filtered responses
        let filteredSystems;
        switch (filters[i]) {
          case 'all':
            filteredSystems = mockDatabase.systems;
            break;
          case 'adopted':
            filteredSystems = mockDatabase.systems.filter(s => s.adopted);
            break;
          case 'unadopted':
            filteredSystems = mockDatabase.systems.filter(s => !s.adopted);
            break;
        }

        jest.mock('mongodb', () => ({
          MongoClient: {
            prototype: {
              connect: jest.fn().mockResolvedValue(),
              db: jest.fn().mockReturnValue({
                collection: jest.fn().mockReturnValue({
                  aggregate: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue(filteredSystems)
                  })
                })
              })
            }
          }
        }));

        const result = await adminFunction(event);
        
        expect(result.statusCode).toBe(200);
        const systems = JSON.parse(result.body);
        expect(systems).toHaveLength(expectedCounts[i]);
      }
    });
  });

  describe('User Interface Requirements', () => {
    test('should provide system metadata for display', async () => {
      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          filter: 'all',
          userId: 'admin-user'
        }
      };

      const systemsWithMetadata = mockDatabase.systems.map(s => ({
        ...s,
        id: s._id,
        recordCount: mockDatabase.records.filter(r => r.systemId === s._id).length,
        status: s.recordCount > 0 ? 'active' : 'inactive',
        createdAt: s.createdAt.toISOString(),
        lastActive: s.adopted ? new Date().toISOString() : null
      }));

      jest.mock('mongodb', () => ({
        MongoClient: {
          prototype: {
            connect: jest.fn().mockResolvedValue(),
            db: jest.fn().mockReturnValue({
              collection: jest.fn().mockReturnValue({
                aggregate: jest.fn().mockReturnValue({
                  toArray: jest.fn().mockResolvedValue(systemsWithMetadata)
                })
              })
            })
          }
        }
      }));

      const result = await adminFunction(event);
      
      expect(result.statusCode).toBe(200);
      const systems = JSON.parse(result.body);
      
      systems.forEach(system => {
        // Verify required UI fields are present
        expect(system).toHaveProperty('id');
        expect(system).toHaveProperty('name');
        expect(system).toHaveProperty('recordCount');
        expect(system).toHaveProperty('adopted');
        expect(system).toHaveProperty('status');
        expect(system).toHaveProperty('createdAt');
        
        // Verify data types
        expect(typeof system.id).toBe('string');
        expect(typeof system.name).toBe('string');
        expect(typeof system.recordCount).toBe('number');
        expect(typeof system.adopted).toBe('boolean');
        expect(typeof system.status).toBe('string');
        
        // Verify status values
        expect(['active', 'inactive', 'maintenance']).toContain(system.status);
      });
    });

    test('should handle refresh functionality', async () => {
      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          filter: 'unadopted',
          userId: 'admin-user'
        }
      };

      // Simulate data change between requests
      const initialSystems = mockDatabase.systems.filter(s => !s.adopted);
      const refreshedSystems = [
        ...initialSystems,
        {
          _id: 'system-4',
          name: 'New System Delta',
          adopted: false,
          createdAt: new Date(),
          type: 'lithium-ion',
          recordCount: 25
        }
      ];

      let callCount = 0;
      jest.mock('mongodb', () => ({
        MongoClient: {
          prototype: {
            connect: jest.fn().mockResolvedValue(),
            db: jest.fn().mockReturnValue({
              collection: jest.fn().mockReturnValue({
                aggregate: jest.fn().mockImplementation(() => ({
                  toArray: jest.fn().mockImplementation(() => {
                    callCount++;
                    return callCount === 1 ? initialSystems : refreshedSystems;
                  })
                }))
              })
            })
          }
        }
      }));

      // Initial load
      const initialResult = await adminFunction(event);
      expect(JSON.parse(initialResult.body)).toHaveLength(2);

      // Refresh
      const refreshResult = await adminFunction(event);
      expect(JSON.parse(refreshResult.body)).toHaveLength(3);
    });

    test('should handle error states gracefully', async () => {
      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          filter: 'unadopted',
          userId: 'admin-user'
        }
      };

      // Mock database error
      jest.mock('mongodb', () => ({
        MongoClient: {
          prototype: {
            connect: jest.fn().mockRejectedValue(new Error('Database connection failed'))
          }
        }
      }));

      const result = await adminFunction(event);
      
      expect(result.statusCode).toBe(500);
      const error = JSON.parse(result.body);
      expect(error.error).toContain('Internal server error');
    });
  });

  describe('Real-time Updates Simulation', () => {
    test('should simulate system status changes', async () => {
      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          filter: 'all',
          userId: 'admin-user'
        }
      };

      // Simulate status change from inactive to active
      const systemsWithStatusChange = mockDatabase.systems.map(s => ({
        ...s,
        id: s._id,
        recordCount: s.name === 'Battery System Alpha' ? 10 : s.recordCount,
        status: s.name === 'Battery System Alpha' ? 'active' : 'active',
        createdAt: s.createdAt.toISOString()
      }));

      jest.mock('mongodb', () => ({
        MongoClient: {
          prototype: {
            connect: jest.fn().mockResolvedValue(),
            db: jest.fn().mockReturnValue({
              collection: jest.fn().mockReturnValue({
                aggregate: jest.fn().mockReturnValue({
                  toArray: jest.fn().mockResolvedValue(systemsWithStatusChange)
                })
              })
            })
          }
        }
      }));

      const result = await adminFunction(event);
      
      expect(result.statusCode).toBe(200);
      const systems = JSON.parse(result.body);
      
      const alphaSystem = systems.find(s => s.name === 'Battery System Alpha');
      expect(alphaSystem.status).toBe('active');
      expect(alphaSystem.recordCount).toBeGreaterThan(0);
    });

    test('should handle concurrent adoption requests', async () => {
      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          systemId: 'system-1',
          userId: 'admin-user'
        })
      };

      // Simulate race condition
      let findOneCallCount = 0;
      jest.mock('mongodb', () => ({
        MongoClient: {
          prototype: {
            connect: jest.fn().mockResolvedValue(),
            db: jest.fn().mockReturnValue({
              collection: jest.fn().mockReturnValue({
                findOne: jest.fn().mockImplementation(() => {
                  findOneCallCount++;
                  // Return unadopted on first call, adopted on second
                  return findOneCallCount === 1 ? mockDatabase.systems[0] : { ...mockDatabase.systems[0], adopted: true };
                }),
                updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 })
              })
            })
          }
        }
      }));

      // Simulate concurrent requests
      const results = await Promise.all([
        adminFunction(event),
        adminFunction(event)
      ]);

      // One should succeed, one should fail
      const successCount = results.filter(r => r.statusCode === 200).length;
      const failureCount = results.filter(r => r.statusCode === 400).length;
      
      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);
    });
  });

  describe('Accessibility and Usability', () => {
    test('should provide meaningful system identifiers', async () => {
      const event = {
        httpMethod: 'GET',
        queryStringParameters: {
          filter: 'all',
          userId: 'admin-user'
        }
      };

      const formattedSystems = mockDatabase.systems.map(s => ({
        ...s,
        id: s._id,
        name: s.name,
        recordCount: mockDatabase.records.filter(r => r.systemId === s._id).length,
        status: 'active',
        createdAt: s.createdAt.toISOString()
      }));

      jest.mock('mongodb', () => ({
        MongoClient: {
          prototype: {
            connect: jest.fn().mockResolvedValue(),
            db: jest.fn().mockReturnValue({
              collection: jest.fn().mockReturnValue({
                aggregate: jest.fn().mockReturnValue({
                  toArray: jest.fn().mockResolvedValue(formattedSystems)
                })
              })
            })
          }
        }
      }));

      const result = await adminFunction(event);
      
      expect(result.statusCode).toBe(200);
      const systems = JSON.parse(result.body);
      
      systems.forEach(system => {
        // Verify accessibility-friendly naming
        expect(system.name).toBeTruthy();
        expect(system.name.length).toBeGreaterThan(3);
        expect(system.name).toMatch(/^[A-Za-z0-9\s\-]+$/);
        
        // Verify IDs are URL-friendly
        expect(system.id).toMatch(/^[a-zA-Z0-9\-_]+$/);
      });
    });

    test('should maintain consistent data format across filters', async () => {
      const filters = ['all', 'adopted', 'unadopted'];
      let expectedFields;

      for (const filter of filters) {
        const event = {
          httpMethod: 'GET',
          queryStringParameters: {
            filter,
            userId: 'admin-user'
          }
        };

        let filteredSystems = mockDatabase.systems;
        if (filter === 'adopted') filteredSystems = filteredSystems.filter(s => s.adopted);
        if (filter === 'unadopted') filteredSystems = filteredSystems.filter(s => !s.adopted);

        const formattedSystems = filteredSystems.map(s => ({
          ...s,
          id: s._id,
          recordCount: mockDatabase.records.filter(r => r.systemId === s._id).length,
          status: 'active',
          createdAt: s.createdAt.toISOString()
        }));

        jest.mock('mongodb', () => ({
          MongoClient: {
            prototype: {
              connect: jest.fn().mockResolvedValue(),
              db: jest.fn().mockReturnValue({
                collection: jest.fn().mockReturnValue({
                  aggregate: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue(formattedSystems)
                  })
                })
              })
            }
          }
        }));

        const result = await adminFunction(event);
        const systems = JSON.parse(result.body);

        if (systems.length > 0) {
          expectedFields = Object.keys(systems[0]);
          
          systems.forEach(system => {
            expect(Object.keys(system)).toEqual(expect.arrayContaining(expectedFields));
          });
        }
      }
    });
  });
});

// End-to-end user scenarios
describe('Admin Panel User Scenarios', () => {
  test('Administrator workflow: Review and adopt new systems', async () => {
    const adminFunction = require('../netlify/functions/admin-systems').handler;
    
    // Step 1: View unadopted systems
    const listEvent = {
      httpMethod: 'GET',
      queryStringParameters: {
        filter: 'unadopted',
        userId: 'workflow-admin'
      }
    };

    // Mock initial unadopted systems
    const unadoptedSystems = [
      { _id: 'system-new-1', name: 'New Battery System', adopted: false, recordCount: 50 },
      { _id: 'system-new-2', name: 'Emergency Backup', adopted: false, recordCount: 25 }
    ];

    jest.mock('mongodb', () => ({
      MongoClient: {
        prototype: {
          connect: jest.fn().mockResolvedValue(),
          db: jest.fn().mockReturnValue({
            collection: jest.fn().mockReturnValue({
              findOne: jest.fn().mockResolvedValue(unadoptedSystems[0]),
              updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
              aggregate: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue(unadoptedSystems)
              })
            })
          })
        }
      }
    }));

    const listResult = await adminFunction(listEvent);
    expect(listResult.statusCode).toBe(200);
    const systems = JSON.parse(listResult.body);
    expect(systems).toHaveLength(2);

    // Step 2: Adopt first system
    const adoptEvent = {
      httpMethod: 'POST',
      body: JSON.stringify({
        systemId: 'system-new-1',
        userId: 'workflow-admin'
      })
    };

    const adoptResult = await adminFunction(adoptEvent);
    expect(adoptResult.statusCode).toBe(200);

    // Step 3: Verify system moved to adopted list
    const adoptedEvent = {
      httpMethod: 'GET',
      queryStringParameters: {
        filter: 'adopted',
        userId: 'workflow-admin'
      }
    };

    // Mock updated adopted systems
    const adoptedSystems = [
      { _id: 'system-new-1', name: 'New Battery System', adopted: true, adoptedBy: 'workflow-admin', recordCount: 50 }
    ];

    jest.mock('mongodb', () => ({
      MongoClient: {
        prototype: {
          connect: jest.fn().mockResolvedValue(),
          db: jest.fn().mockReturnValue({
            collection: jest.fn().mockReturnValue({
              aggregate: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue(adoptedSystems)
              })
            })
          })
        }
      }
    }));

    const adoptedResult = await adminFunction(adoptedEvent);
    expect(adoptedResult.statusCode).toBe(200);
    const adoptedList = JSON.parse(adoptedResult.body);
    expect(adoptedList).toHaveLength(1);
    expect(adoptedList[0].name).toBe('New Battery System');
    expect(adoptedList[0].adopted).toBe(true);
  });
});