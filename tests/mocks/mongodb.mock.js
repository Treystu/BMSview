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

// Initialize mock MongoDB implementation
const mockMongoDB = {
  client: {
    connect: jest.fn().mockResolvedValue(undefined),
    db: jest.fn()
  },
  db: {
    collection: jest.fn()
  },
  collection: {
    findOne: jest.fn(),
    updateOne: jest.fn(),
    aggregate: jest.fn(),
    insertOne: jest.fn(),
    toArray: jest.fn()
  }
};

// Configure basic database responses
mockMongoDB.client.db.mockReturnValue(mockMongoDB.db);
mockMongoDB.db.collection.mockReturnValue(mockMongoDB.collection);
mockMongoDB.collection.aggregate.mockReturnValue({ toArray: mockMongoDB.collection.toArray });

// Configure common responses
function setupMockResponses(data) {
  mockMongoDB.collection.toArray.mockResolvedValueOnce(data);
}

module.exports = {
  mockDatabase,
  mockMongoDB,
  setupMockResponses
};