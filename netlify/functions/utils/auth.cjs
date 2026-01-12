'use strict';

function parseAdminEmailAllowlist(value) {
    if (!value || typeof value !== 'string') return [];
    return value
        .split(/[;,\s]+/)
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean);
}

function getAdminEmailAllowlist() {
    const raw = process.env.ADMIN_EMAIL_ALLOWLIST || process.env.ADMIN_EMAILS || '';
    return parseAdminEmailAllowlist(raw);
}

function isAdminEmailAllowlistConfigured() {
    return getAdminEmailAllowlist().length > 0;
}

function isAdminEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const allowlist = getAdminEmailAllowlist();
    if (allowlist.length === 0) return false;
    return allowlist.includes(email.toLowerCase());
}

function isNetlifyIdentityUserAdmin(user) {
    if (!user || typeof user !== 'object') return false;

    const roles = Array.isArray(user.app_metadata?.roles) ? user.app_metadata.roles : [];
    if (roles.some((r) => String(r).toLowerCase() === 'admin')) {
        return true;
    }

    const email = user.email;
    if (isAdminEmailAllowlistConfigured()) {
        return isAdminEmail(email);
    }

    return false;
}

async function verifyGoogleIdToken(event, log) {
    const authHeader = event?.headers?.authorization || event?.headers?.Authorization || '';
    const bearerPrefix = 'Bearer ';

    if (!authHeader.startsWith(bearerPrefix)) {
        return { ok: false, reason: 'missing' };
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
        if (log?.warn) {
            log.warn('GOOGLE_CLIENT_ID not configured; skipping Google ID token verification');
        }
        return { ok: false, reason: 'client_id_missing' };
    }

    const idToken = authHeader.slice(bearerPrefix.length).trim();

    try {
        const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
        if (!res.ok) {
            const text = await res.text();
            if (log?.warn) {
                log.warn('Google ID token verification failed', { status: res.status, body: text });
            }
            return { ok: false, reason: 'invalid_token' };
        }

        const tokenInfo = await res.json();

        if (tokenInfo.aud !== process.env.GOOGLE_CLIENT_ID) {
            if (log?.warn) {
                log.warn('Google ID token audience mismatch', { expected: process.env.GOOGLE_CLIENT_ID, received: tokenInfo.aud });
            }
            return { ok: false, reason: 'aud_mismatch' };
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        if (tokenInfo.exp && Number(tokenInfo.exp) < nowSeconds) {
            if (log?.warn) {
                log.warn('Google ID token expired', { exp: tokenInfo.exp, now: nowSeconds });
            }
            return { ok: false, reason: 'expired' };
        }

        return {
            ok: true,
            email: tokenInfo.email,
            sub: tokenInfo.sub,
            hd: tokenInfo.hd
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (log?.error) {
            log.error('Failed to verify Google ID token', { error: message });
        }
        return { ok: false, reason: 'verification_failed' };
    }
}

function getProvidedAdminToken(event) {
    if (!event) return null;
    const headers = event.headers || {};
    return (
        headers['x-admin-token'] ||
        headers['X-Admin-Token'] ||
        headers['x-admin-token'.toLowerCase()] ||
        event.queryStringParameters?.adminKey ||
        null
    );
}

function unauthorized(headers) {
    return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json', ...(headers || {}) },
        body: JSON.stringify({ error: 'Unauthorized' })
    };
}

async function ensureAdminAuthorized(event, context, headers, log) {
    const isProduction = process.env.CONTEXT === 'production';

    const identityUser = context?.clientContext?.user;
    if (identityUser) {
        if (!isNetlifyIdentityUserAdmin(identityUser)) {
            if (!process.env.ADMIN_ACCESS_TOKEN && !isAdminEmailAllowlistConfigured()) {
                return null;
            }

            if (log?.warn) {
                log.warn('Netlify Identity user is not authorized for admin access', {
                    email: identityUser.email,
                    id: identityUser.sub || identityUser.id,
                    provider: identityUser.app_metadata?.provider
                });
            }
            return unauthorized(headers);
        }

        if (log?.info) {
            log.info('Authorized via Netlify Identity (Google OAuth)', {
                email: identityUser.email,
                id: identityUser.sub || identityUser.id,
                provider: identityUser.app_metadata?.provider
            });
        }
        return null;
    }

    const googleAuth = await verifyGoogleIdToken(event, log);
    if (googleAuth.ok) {
        if (isAdminEmailAllowlistConfigured() && !isAdminEmail(googleAuth.email)) {
            if (log?.warn) {
                log.warn('Google OAuth user is not authorized for admin access', { email: googleAuth.email, sub: googleAuth.sub });
            }
            return unauthorized(headers);
        }

        if (!isAdminEmailAllowlistConfigured() && !process.env.ADMIN_ACCESS_TOKEN) {
            return null;
        }

        if (log?.info) {
            log.info('Authorized via Google OAuth', { email: googleAuth.email, sub: googleAuth.sub, domain: googleAuth.hd });
        }
        return null;
    }

    const adminToken = process.env.ADMIN_ACCESS_TOKEN;
    if (!adminToken) {
        if (isProduction && isAdminEmailAllowlistConfigured()) {
            if (log?.warn) {
                log.warn('Admin access denied: allowlist configured but no identity present');
            }
            return unauthorized(headers);
        }

        if (isProduction && !isAdminEmailAllowlistConfigured()) {
            if (log?.warn) {
                log.warn('Admin access denied: no identity present and no ADMIN_ACCESS_TOKEN configured in production');
            }
            return unauthorized(headers);
        }

        if (log?.info) {
            log.info('No ADMIN_ACCESS_TOKEN configured; allowing request based on page-level Google OAuth protection');
        }
        return null;
    }

    const provided = getProvidedAdminToken(event);
    if (provided !== adminToken) {
        if (log?.warn) {
            log.warn('Unauthorized admin operation attempt', { method: event?.httpMethod, path: event?.path });
        }
        return unauthorized(headers);
    }

    return null;
}

module.exports = {
    ensureAdminAuthorized,
    verifyGoogleIdToken,
    isNetlifyIdentityUserAdmin,
    isAdminEmailAllowlistConfigured,
    isAdminEmail,
    getAdminEmailAllowlist
};
