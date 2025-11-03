export function registerServiceWorker() {
  if ('serviceWorker' in navigator && (location.hostname === 'localhost' || location.protocol === 'https:')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failure is non-fatal
    });
  }
}
