# BMSview Patterns & Best Practices

**Purpose:** Common patterns, conventions, and best practices used throughout BMSview  
**Last Updated:** 2025-11-05

---

## 🎯 BMSview Coding Standards

### 1. No Duplicate Exports
```typescript
// ❌ WRONG
export function foo() {}
export function foo() {}

// ✅ CORRECT
export function foo() {}
export function bar() {}
```

### 2. Merge Duplicate tsconfig.json Keys
```json
// ❌ WRONG
{
  "compilerOptions": { "target": "ES2020" },
  "compilerOptions": { "module": "ESNext" }
}

// ✅ CORRECT
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext"
  }
}
```

### 3. Use Package Managers for Dependencies
```bash
# ❌ WRONG - Never manually edit package.json
# (manually add "lodash": "^4.17.21")

# ✅ CORRECT
npm install lodash
npm uninstall lodash
```

### 4. Avoid require() for ES Modules in .js Files
```javascript
// ❌ WRONG in .js files
const { foo } = require('@module/es-module');

// ✅ CORRECT - Use dynamic import
const { foo } = await import('@module/es-module');

// ✅ CORRECT - Use .cjs for CommonJS
// (in .cjs files, require() is fine)
```

### 5. Check Browser APIs Before Use
```typescript
// ❌ WRONG
const data = localStorage.getItem('key');

// ✅ CORRECT
if (typeof localStorage !== 'undefined') {
  const data = localStorage.getItem('key');
}
```

### 6. Test Timeouts
```javascript
// ❌ WRONG - Production values in tests
jest.setTimeout(5000);

// ✅ CORRECT - Short timeouts for tests
jest.setTimeout(100);
```

### 7. Avoid Global afterEach Assertions
```javascript
// ❌ WRONG - Breaks error-handling tests
afterEach(() => {
  expect(console.error).not.toHaveBeenCalled();
});

// ✅ CORRECT - Test-specific assertions
test('should not log errors', () => {
  // ... test code
  expect(console.error).not.toHaveBeenCalled();
});
```

---

## 🏗️ Component Patterns

### React Component Pattern
```typescript
interface ComponentProps {
  data: BatteryMeasurement[];
  onAction: (event: CustomEvent) => void;
  config?: ComponentConfig;
}

export const MyComponent: React.FC<ComponentProps> = ({
  data,
  onAction,
  config
}) => {
  const [state, setState] = useState<StateType>(initialState);
  
  useEffect(() => {
    // Side effects
  }, [dependencies]);
  
  const handleAction = useCallback(() => {
    onAction(event);
  }, [onAction]);
  
  return (
    <div>
      {/* JSX */}
    </div>
  );
};
```

### Custom Hook Pattern
```typescript
interface HookConfig {
  initialValue?: T;
  onError?: (error: Error) => void;
}

export function useCustomHook<T>(config: HookConfig) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    // Hook logic
  }, []);
  
  return { data, loading, error };
}
```

---

## 🔌 Netlify Function Patterns

### Function Structure
```javascript
async function handler(event = {}, context = {}) {
  const log = createLogger('function-name', context);
  const timer = createTimer(log, 'function-name');
  
  try {
    // Parse input
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (err) {
      log.warn('Failed to parse body', { error: err.message });
      return respond(400, { error: 'Invalid JSON' });
    }
    
    // Validate input
    if (!body.requiredField) {
      return respond(400, { error: 'Missing required field' });
    }
    
    // Process
    const result = await processData(body);
    
    // Return success
    return respond(200, { success: true, data: result });
    
  } catch (err) {
    log.error('Function error', { error: err.message, stack: err.stack });
    return respond(500, { error: 'Internal server error' });
  } finally {
    timer.end();
  }
}

exports.handler = handler;
```

### Error Response Pattern
```javascript
function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
```

---

## 📊 State Management Patterns

### Reducer Pattern
```typescript
type Action = 
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_DATA'; payload: DataType }
  | { type: 'SET_ERROR'; payload: string | null };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_DATA':
      return { ...state, data: action.payload, error: null };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    default:
      return state;
  }
};
```

### Context Pattern
```typescript
const MyContext = createContext<ContextType | undefined>(undefined);

export const MyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  
  return (
    <MyContext.Provider value={{ state, dispatch }}>
      {children}
    </MyContext.Provider>
  );
};

export const useMyContext = () => {
  const context = useContext(MyContext);
  if (!context) {
    throw new Error('useMyContext must be used within MyProvider');
  }
  return context;
};
```

---

## 🔐 Error Handling Patterns

### Try-Catch Pattern
```javascript
try {
  const result = await riskyOperation();
  return { success: true, data: result };
} catch (err) {
  const error = err instanceof Error ? err : new Error(String(err));
  log.error('Operation failed', { 
    error: error.message, 
    stack: error.stack 
  });
  return { success: false, error: error.message };
}
```

### Validation Pattern
```javascript
function validateInput(data) {
  const errors = [];
  
  if (!data.field1) errors.push('field1 is required');
  if (typeof data.field2 !== 'number') errors.push('field2 must be number');
  
  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join(', ')}`);
  }
  
  return true;
}
```

---

## 🔄 Async Patterns

### Promise Pattern
```typescript
async function fetchData(id: string): Promise<DataType> {
  try {
    const response = await fetch(`/api/data/${id}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    throw new Error(`Failed to fetch data: ${err.message}`);
  }
}
```

### Parallel Requests
```typescript
const [data1, data2, data3] = await Promise.all([
  fetchData1(),
  fetchData2(),
  fetchData3()
]);
```

### Sequential Requests
```typescript
const data1 = await fetchData1();
const data2 = await fetchData2(data1);
const data3 = await fetchData3(data2);
```

---

## 📝 Logging Patterns

### Structured Logging
```javascript
log.info('User action', {
  userId: user.id,
  action: 'upload',
  fileName: file.name,
  fileSize: file.size,
  timestamp: new Date().toISOString()
});

log.error('Operation failed', {
  error: error.message,
  stack: error.stack,
  context: { userId, action }
});
```

### Performance Logging
```javascript
const timer = createTimer(log, 'operation-name');
try {
  // Do work
} finally {
  timer.end(); // Logs duration
}
```

---

## 🧪 Testing Patterns

### Test Structure
```javascript
describe('Feature Name', () => {
  beforeEach(() => {
    // Setup
  });
  
  afterEach(() => {
    // Cleanup
  });
  
  test('should do something', async () => {
    // Arrange
    const input = { /* ... */ };
    
    // Act
    const result = await functionUnderTest(input);
    
    // Assert
    expect(result).toEqual(expected);
  });
});
```

### Mock Pattern
```javascript
jest.mock('../services/api', () => ({
  fetchData: jest.fn().mockResolvedValue({ data: 'mocked' })
}));

test('should handle API response', async () => {
  const result = await myFunction();
  expect(result).toBeDefined();
});
```

---

## 🔗 API Integration Patterns

### Service Layer Pattern
```typescript
export async function apiCall(endpoint: string, options: RequestInit) {
  try {
    const response = await fetch(endpoint, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (err) {
    throw new Error(`API call failed: ${err.message}`);
  }
}
```

### Retry Pattern
```javascript
async function retryOperation(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
}
```

---

## 🎨 TypeScript Patterns

### Type Definitions
```typescript
// Use interfaces for objects
interface User {
  id: string;
  name: string;
  email: string;
}

// Use types for unions
type Status = 'pending' | 'success' | 'error';

// Use generics for reusable types
interface Response<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

### Utility Types
```typescript
// Partial - make all properties optional
type PartialUser = Partial<User>;

// Pick - select specific properties
type UserPreview = Pick<User, 'id' | 'name'>;

// Omit - exclude specific properties
type UserWithoutEmail = Omit<User, 'email'>;

// Record - create object with specific keys
type UserRoles = Record<'admin' | 'user' | 'guest', boolean>;
```

---

## 🚀 Performance Patterns

### Memoization
```typescript
const memoizedValue = useMemo(() => {
  return expensiveCalculation(data);
}, [data]);

const memoizedCallback = useCallback(() => {
  handleAction(data);
}, [data]);
```

### Lazy Loading
```typescript
const LazyComponent = lazy(() => import('./Component'));

<Suspense fallback={<Loading />}>
  <LazyComponent />
</Suspense>
```

---

## 📚 Documentation Patterns

### JSDoc Comments
```javascript
/**
 * Analyzes battery data and generates insights
 * @param {BatteryMeasurement[]} measurements - Array of measurements
 * @param {string} systemId - System identifier
 * @returns {Promise<BatteryInsights>} Generated insights
 * @throws {Error} If analysis fails
 */
async function analyzeData(measurements, systemId) {
  // Implementation
}
```

---

**Follow these patterns to maintain consistency and quality across the codebase.**

