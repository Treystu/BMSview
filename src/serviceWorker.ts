export function registerServiceWorker() {
  if ('serviceWorker' in navigator && (location.hostname === 'localhost' || location.protocol === 'https:')) {
    console.log('[SW] Registering service worker...');
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('[SW] Registered successfully:', reg.scope);
    }).catch(err => {
      console.warn('[SW] Registration failed:', err);
    });
  }
}
