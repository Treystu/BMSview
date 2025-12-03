# Admin Access Control Pattern

## Overview

BMSview uses a **page-level access control** pattern for admin functionality. This document clarifies how authentication and authorization work in the admin dashboard.

## Access Control Model

### Page-Level Protection (Primary)

The admin dashboard (`admin.html`) is protected by **Netlify Identity OAuth**:

1. User navigates to `/admin.html`
2. Netlify Identity widget loads and checks for authentication
3. If not authenticated, user is prompted to log in via OAuth
4. Only authenticated users can access the admin page and its functionality

This is the **primary and sufficient** access control mechanism for admin features.

### Function-Level Authentication (Secondary)

Admin functions (called from the admin page) verify that:

1. The request includes a valid Netlify Identity JWT token
2. The user is authenticated (has a valid `clientContext.user`)

Admin functions **DO NOT** perform additional role-based access control (RBAC). The assumption is:
- If a user can access `admin.html` (OAuth-protected), they are authorized to use all admin functions
- Functions only verify authentication, not authorization roles

## Implementation Pattern

### Correct Pattern (Current)

```javascript
// In admin functions like feedback-analytics.cjs
const user = context.clientContext?.user;
if (!user) {
  return {
    statusCode: 401,
    body: JSON.stringify({ 
      error: 'Authentication required',
      message: 'Please log in via the Admin Dashboard.'
    })
  };
}

// User is authenticated - proceed with function logic
```

### Anti-Pattern (Avoid)

```javascript
// ❌ DO NOT add role checks in admin functions
const isAdmin = user.app_metadata?.roles?.includes('admin');
if (!isAdmin) {
  return { statusCode: 403, body: 'Forbidden' };
}
```

**Why avoid?** This creates a second layer of authorization that:
- Duplicates the page-level OAuth protection
- Can fail even for legitimate admin users if role metadata is not configured
- Creates unnecessary complexity and potential for access denial bugs

## Admin Functions

Functions that follow this pattern:

- `netlify/functions/feedback-analytics.cjs` - AI feedback analytics
- `netlify/functions/admin-diagnostics.cjs` - System diagnostics
- Any future admin-only endpoints

## Security Considerations

### What This Pattern Provides

✅ **Authentication**: Verifies user identity via Netlify Identity OAuth  
✅ **Access Control**: Page-level restriction to authenticated users only  
✅ **JWT Validation**: Token-based security for API calls  
✅ **Audit Logging**: All access attempts are logged with user details

### What This Pattern Does NOT Provide

❌ **Fine-grained RBAC**: No per-function role checks  
❌ **Public API Protection**: Admin functions should only be callable from admin.html, not exposed as public APIs  
❌ **Multi-tenancy**: No organization or team-level access separation

### When to Add RBAC

Consider adding role-based checks if:

1. You need different admin permission levels (e.g., viewer vs editor vs super-admin)
2. You want to expose admin APIs to external systems with varying permissions
3. You need to restrict specific admin features to certain users

For the current use case (single-admin access to all admin features), page-level OAuth is sufficient.

## Testing

Tests should verify:

1. ✅ Unauthenticated requests are rejected (401)
2. ✅ Any authenticated user can access admin functions
3. ✅ Access attempts are logged for audit purposes
4. ❌ No role-based rejection tests (unless RBAC is added)

Example test:

```javascript
it('should allow any authenticated user', async () => {
  const context = {
    clientContext: {
      user: { 
        email: 'user@example.com',
        sub: 'user-123',
        // No admin role needed
        app_metadata: {},
        user_metadata: {}
      }
    }
  };
  
  const response = await handler(mockEvent, context);
  expect(response.statusCode).toBe(200);
});
```

## Migration Notes

**Issue #[number]**: Removed admin role check from `feedback-analytics.cjs`

**Reason**: The admin role check was preventing legitimate admin users from accessing the feedback analytics feature, even though they had successfully authenticated via the admin page OAuth. This was redundant with the page-level access control.

**Change**: 
- Removed lines checking `user.app_metadata.roles` and `user.user_metadata.role`
- Updated error message from "requires admin privileges" to "requires authentication"
- Updated tests to reflect that any authenticated user can access admin functions

## Related Documentation

- [Architecture Overview](ARCHITECTURE.md)
- [Admin Diagnostics Guide](ADMIN_DIAGNOSTICS_GUIDE.md)
- [Full Context Mode](FULL_CONTEXT_MODE.md)
