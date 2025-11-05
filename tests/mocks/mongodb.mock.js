// In-memory store backing the MongoDB mock
const store = {
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
  ],
  uploads: []
};

function getCollectionArray(name) {
  if (!store[name]) store[name] = [];
  return store[name];
}

function matches(doc, query) {
  if (!query || Object.keys(query).length === 0) return true;
  if (query.$or && Array.isArray(query.$or)) {
    return query.$or.some(cond => cond && matches(doc, cond));
  }
  for (const key of Object.keys(query)) {
    if (key === '$or') continue;
    const expected = query[key];
    const actual = doc[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$in' in expected) {
        if (!expected.$in.includes(actual)) return false;
      } else {
        // Unsupported operator: do strict compare
        if (JSON.stringify(expected) !== JSON.stringify(actual)) return false;
      }
    } else {
      if (actual !== expected) return false;
    }
  }
  return true;
}

function createCollection(name) {
  return {
    findOne: jest.fn(async (query) => {
      const arr = getCollectionArray(name);
      return arr.find(doc => matches(doc, query)) || null;
    }),
    insertOne: jest.fn(async (document) => {
      const arr = getCollectionArray(name);
      const _id = document._id || `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const doc = { _id, ...document };
      arr.push(doc);
      return { insertedId: _id };
    }),
    insertMany: jest.fn(async (documents) => {
      const arr = getCollectionArray(name);
      for (const document of documents) {
        const _id = document._id || `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        arr.push({ _id, ...document });
      }
      return { insertedCount: documents.length };
    }),
    updateOne: jest.fn(async (filter, update) => {
      const arr = getCollectionArray(name);
      const idx = arr.findIndex(doc => matches(doc, filter));
      if (idx === -1) return { modifiedCount: 0 };
      if (update && update.$set) {
        arr[idx] = { ...arr[idx], ...update.$set };
      }
      return { modifiedCount: 1 };
    }),
    deleteMany: jest.fn(async (filter) => {
      const arr = getCollectionArray(name);
      const before = arr.length;
      const remaining = arr.filter(doc => !matches(doc, filter));
      store[name] = remaining;
      return { deletedCount: before - remaining.length };
    }),
    aggregate: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
    toArray: jest.fn(async () => getCollectionArray(name).slice())
  };
}

// Initialize mock MongoDB implementation
const mockMongoDB = {
  client: {
    connect: jest.fn().mockResolvedValue(undefined),
    db: jest.fn((dbName) => ({ collection: jest.fn((name) => createCollection(name)) }))
  },
  db: { collection: jest.fn((name) => createCollection(name)) }
};

// Legacy helpers preserved for compatibility with existing tests
function setupMockResponses(data) {
  // No-op: aggregate().toArray() returns [] by default; callers can override per test if needed
  return data;
}

module.exports = {
  mockDatabase: { systems: store.systems, records: store.records },
  mockMongoDB,
  setupMockResponses,
  __store: store
};