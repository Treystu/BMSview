// Module-level guard to prevent multiple registration attempts in the same session
let registrationAttempted = false;

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const isHttps = location.protocol === 'https:';
    const debugSw = new URLSearchParams(window.location.search).has('debug_sw');

    // Only register if on HTTPS or explicitly debugging on localhost
    // This avoids "Update on reload" noise and potential reloads during development
    if (!isHttps && !(isLocalhost && debugSw)) {
      if (isLocalhost) {
        console.log('[SW] Service worker registration skipped on localhost. Use ?debug_sw=1 to enable.');
      }
      return;
    }

    if (registrationAttempted) return;
    registrationAttempted = true;

    // Check session storage to persist guard across some types of HMR re-evaluations
    if (typeof sessionStorage !== 'undefined') {
      if (sessionStorage.getItem('sw_registered')) {
        console.log('[SW] Service worker already registered in this session.');
        return;
      }
    }

    console.log('[SW] Registering service worker...');

    // In development, log the stack trace to find who is calling this
    if (location.hostname === 'localhost') {
      console.groupCollapsed('[SW] Registration Stack Trace');
      console.trace();
      console.groupEnd();
    }

    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('[SW] Registered successfully:', reg.scope);
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('sw_registered', 'true');
      }
    }).catch(err => {
      registrationAttempted = false; // Allow retry on failure
      console.warn('[SW] Registration failed:', err);
    });
  }
}
