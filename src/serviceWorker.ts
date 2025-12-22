// Module-level guard to prevent multiple registration attempts in the same session
let registrationAttempted = false;

export function registerServiceWorker() {
  if (registrationAttempted) return;

  if ('serviceWorker' in navigator && (location.hostname === 'localhost' || location.protocol === 'https:')) {
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
