# Follow-up: Update @testing-library/react-hooks to React 18 Compatible Version

## Background
Currently using `@testing-library/react-hooks@8.0.1` which only supports React 16/17. We've implemented a **temporary workaround** using `legacy-peer-deps` to allow the build to succeed with React 18.

## Current Situation
- **React version**: 18.3.1
- **@testing-library/react-hooks version**: 8.0.1 (supports React ^16.9.0 || ^17.0.0)
- **Workaround**: Added `legacy-peer-deps=true` in `.npmrc` and updated `netlify.toml`

## Recommended Solution
The `@testing-library/react-hooks` package has been **deprecated** and its functionality has been merged into `@testing-library/react` v13+.

### Migration Path:

1. **Remove the deprecated package**:
   ```bash
   npm uninstall @testing-library/react-hooks
   ```

2. **Install or upgrade @testing-library/react** (if not already at v13+):
   ```bash
   npm install --save-dev @testing-library/react@^14.0.0
   ```

3. **Update imports in test files**:
   ```javascript
   // OLD
   import { renderHook } from '@testing-library/react-hooks';
   
   // NEW
   import { renderHook } from '@testing-library/react';
   ```

4. **Search for usage**:
   ```bash
   grep -r "@testing-library/react-hooks" --include="*.js" --include="*.ts" --include="*.tsx"
   ```

5. **Remove legacy peer deps workaround**:
   - Delete `.npmrc` file
   - Revert changes to `netlify.toml` build command

## Files Currently Using This Package
Based on `package.json`, this is listed as a dev dependency. Need to search codebase for actual usage.

## Testing Checklist
After migration:
- [ ] All tests pass: `npm test`
- [ ] Build succeeds without legacy-peer-deps: `npm run build`
- [ ] Clean install works: `rm -rf node_modules package-lock.json && npm install`
- [ ] No peer dependency warnings

## Priority
**Medium** - The workaround is stable and functional, but we should migrate to the supported approach within the next 1-2 sprints to avoid technical debt.

## References
- [Testing Library React Hooks Migration Guide](https://react-hooks-testing-library.com/usage/advanced-hooks#react-18-support)
- [@testing-library/react v13+ Release Notes](https://github.com/testing-library/react-testing-library/releases/tag/v13.0.0)
