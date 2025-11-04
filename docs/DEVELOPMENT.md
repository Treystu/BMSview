# BMSview Development Guide

## Copilot Context

This guide provides context and patterns for GitHub Copilot to better assist with development in this project.

### Project Overview

BMSview is a TypeScript-based React application for battery management system (BMS) monitoring and analysis, with integrated AI capabilities.

### Key Technical Details

#### TypeScript Patterns

```typescript
// Component Props Pattern
interface ComponentProps {
  data: BatteryMeasurement[];
  onAction: (event: CustomEvent) => void;
  config?: ComponentConfig;
}

// Hook Pattern
function useCustomHook<T>(config: HookConfig): {
  data: T[];
  loading: boolean;
  error: Error | null;
}

// Service Pattern
class ServiceClass {
  private config: ServiceConfig;
  
  async fetchData<T>(params: QueryParams): Promise<ServiceResponse<T>> {
    // Implementation
  }
}
```

#### React Patterns

```typescript
// Functional Component Pattern
const Component: React.FC<Props> = ({ prop1, prop2 }) => {
  const [state, setState] = useState<State>();
  
  useEffect(() => {
    // Side effects
  }, [dependencies]);
  
  return (
    <div>
      {/* JSX */}
    </div>
  );
};

// Custom Hook Pattern
const useCustomHook = (config: Config) => {
  // Hook implementation
  return { data, loading, error };
};
```

#### API Integration Patterns

```typescript
// API Call Pattern
const fetchData = async <T>(endpoint: string, params: Params): Promise<T> => {
  try {
    const response = await fetch(endpoint);
    const data = await response.json();
    return data as T;
  } catch (error) {
    handleError(error);
    throw error;
  }
};

// Error Handling Pattern
const handleError = (error: unknown) => {
  if (error instanceof Error) {
    logError(error);
    showUserFriendlyMessage(error);
  }
};
```

### Common Tasks and Solutions

#### 1. Adding a New Component

```typescript
// 1. Create interface
interface NewComponentProps {
  data: DataType;
  onAction: (event: ActionEvent) => void;
}

// 2. Create component
const NewComponent: React.FC<NewComponentProps> = ({ data, onAction }) => {
  // Implementation
};

// 3. Add tests
describe('NewComponent', () => {
  it('renders correctly', () => {
    // Test implementation
  });
});
```

#### 2. Implementing a Custom Hook

```typescript
// 1. Define types
interface HookConfig {
  param1: string;
  param2: number;
}

interface HookResult {
  data: DataType;
  loading: boolean;
  error: Error | null;
}

// 2. Implement hook
const useCustomHook = (config: HookConfig): HookResult => {
  // Implementation
};

// 3. Add tests
describe('useCustomHook', () => {
  it('handles data correctly', () => {
    // Test implementation
  });
});
```

#### 3. Adding a New API Service

```typescript
// 1. Define types
interface ServiceConfig {
  baseUrl: string;
  timeout: number;
}

// 2. Implement service
class NewService {
  constructor(private config: ServiceConfig) {}

  async getData(): Promise<ServiceResponse> {
    // Implementation
  }
}

// 3. Add tests
describe('NewService', () => {
  it('fetches data correctly', async () => {
    // Test implementation
  });
});
```

### File Structure Guidelines

```
src/
├── components/
│   ├── ComponentName/
│   │   ├── index.tsx
│   │   ├── styles.css
│   │   └── ComponentName.test.tsx
│   └── shared/
├── hooks/
│   ├── useHookName.ts
│   └── useHookName.test.ts
├── services/
│   ├── ServiceName.ts
│   └── ServiceName.test.ts
└── utils/
    ├── utilityName.ts
    └── utilityName.test.ts
```

### Testing Patterns

```typescript
// Component Test Pattern
describe('Component', () => {
  it('renders correctly', () => {
    render(<Component />);
    expect(screen.getByText('text')).toBeInTheDocument();
  });

  it('handles user interaction', async () => {
    const onAction = jest.fn();
    render(<Component onAction={onAction} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onAction).toHaveBeenCalled();
  });
});

// Hook Test Pattern
describe('useCustomHook', () => {
  it('returns correct data', () => {
    const { result } = renderHook(() => useCustomHook());
    expect(result.current.data).toBeDefined();
  });
});
```

### Error Handling

```typescript
// Standard error handling pattern
try {
  // Operation that might fail
} catch (error) {
  if (error instanceof NetworkError) {
    // Handle network errors
  } else if (error instanceof ValidationError) {
    // Handle validation errors
  } else {
    // Handle unknown errors
  }
}
```

### Naming Conventions

- Components: PascalCase (e.g., `BatteryChart`)
- Hooks: camelCase with 'use' prefix (e.g., `useBatteryData`)
- Services: camelCase (e.g., `batteryService`)
- Utils: camelCase (e.g., `formatBatteryData`)
- Types/Interfaces: PascalCase (e.g., `BatteryMeasurement`)
- Constants: SCREAMING_SNAKE_CASE (e.g., `MAX_VOLTAGE`)

### Documentation Requirements

Every file should have:

```typescript
/**
 * @fileoverview Brief description of the file
 * @module path/to/module
 */

/**
 * Component/function description
 * @param {ParamType} param - Parameter description
 * @returns {ReturnType} Return value description
 * @throws {ErrorType} Description of when errors are thrown
 */
```

### State Management

```typescript
// Context Pattern
const MyContext = createContext<ContextType>(defaultValue);

// Provider Pattern
const MyProvider: React.FC = ({ children }) => {
  const [state, setState] = useState<StateType>(initialState);
  
  return (
    <MyContext.Provider value={{ state, setState }}>
      {children}
    </MyContext.Provider>
  );
};
```

### Performance Optimization

```typescript
// Memoization Pattern
const memoizedValue = useMemo(() => computeExpensiveValue(a, b), [a, b]);

// Callback Pattern
const memoizedCallback = useCallback((param) => {
  doSomething(param);
}, [dependency]);