import { Buffer } from 'buffer';
import React, { Suspense, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { AdminStateProvider } from './state/adminState';
import type { NetlifyIdentityWidget } from './types';
const AdminDashboard = React.lazy(() => import('./components/AdminDashboard'));

// Polyfill Node.js globals for the browser environment.
// jszip relies on 'Buffer'.

declare global {
  interface Window {
    Buffer: typeof Buffer;
    netlifyIdentity?: NetlifyIdentityWidget;
  }
}
window.Buffer = Buffer;

interface NetlifyUser {
  email: string;
  user_metadata: {
    full_name: string;
  };
}

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
  console.log(JSON.stringify({
    level: level.toUpperCase(),
    timestamp: new Date().toISOString(),
    component: 'AdminApp',
    message,
    context
  }));
};

const AdminApp: React.FC = () => {
  const [user, setUser] = useState<NetlifyUser | null>(null);

  useEffect(() => {
    // Define stable handlers to be used for both adding and removing listeners.
    const handleInit = (identityUser: unknown) => {
      const typedUser = identityUser as NetlifyUser | null;
      log('info', 'Netlify Identity init event.', { hasUser: !!typedUser });
      setUser(typedUser);
      if (!typedUser) {
        // Delay opening the modal to ensure widget is fully loaded
        setTimeout(() => {
          if (window.netlifyIdentity) {
            try {
              window.netlifyIdentity.open();
            } catch (error) {
              log('error', 'Failed to open Netlify Identity modal', { error: String(error) });
            }
          }
        }, 500);
      }
    };

    const handleLogin = (loggedInUser: unknown) => {
      const typedUser = loggedInUser as NetlifyUser;
      log('info', 'Netlify Identity login event.', { userEmail: typedUser.email });
      setUser(typedUser);
      window.netlifyIdentity?.close();
    };

    const handleLogout = () => {
      log('info', 'Netlify Identity logout event.');
      setUser(null);
      // Re-open the login modal after logging out with delay
      setTimeout(() => {
        if (window.netlifyIdentity) {
          try {
            window.netlifyIdentity.open();
          } catch (error) {
            log('error', 'Failed to open Netlify Identity modal after logout', { error: String(error) });
          }
        }
      }, 500);
    };

    const handleError = (error: unknown) => {
      log('error', 'Netlify Identity error event.', { error: String(error) });
    };

    // Wait for widget to be fully loaded
    const initializeWidget = () => {
      if (window.netlifyIdentity) {
        try {
          // Register event listeners first
          window.netlifyIdentity.on('init', handleInit);
          window.netlifyIdentity.on('login', handleLogin);
          window.netlifyIdentity.on('logout', handleLogout);
          window.netlifyIdentity.on('error', handleError);

          // Then initialize the widget. This will trigger the 'init' event.
          window.netlifyIdentity.init();
          log('info', 'Netlify Identity widget initialized successfully');
        } catch (error) {
          log('error', 'Failed to initialize Netlify Identity widget', { error: String(error) });
        }
      } else {
        log('warn', 'Netlify Identity widget not available, retrying...');
        // Retry after a delay if widget not loaded
        setTimeout(initializeWidget, 1000);
      }
    };

    // Start initialization with a small delay to ensure script is loaded
    const initTimeout = setTimeout(initializeWidget, 100);

    // Cleanup listeners on component unmount
    return () => {
      clearTimeout(initTimeout);
      if (window.netlifyIdentity) {
        window.netlifyIdentity.off('init', handleInit);
        window.netlifyIdentity.off('login', handleLogin);
        window.netlifyIdentity.off('logout', handleLogout);
        window.netlifyIdentity.off('error', handleError);
      }
    };
  }, []); // Empty dependency array ensures this effect runs only once.

  const handleLogoutClick = () => {
    if (window.netlifyIdentity) {
      window.netlifyIdentity.logout();
    }
  };

  const handleManualLogin = () => {
    if (window.netlifyIdentity) {
      try {
        window.netlifyIdentity.open();
      } catch (error) {
        log('error', 'Failed to manually open login modal', { error: String(error) });
        alert('Unable to open login window. Please disable your popup blocker and try again.');
      }
    }
  };

  if (!user) {
    return (
      <div className="bg-neutral-dark min-h-screen flex items-center justify-center text-white text-center p-4">
        <div className="max-w-md">
          <h1 className="text-2xl font-bold mb-4">Admin Portal</h1>
          <p className="mb-4">Please log in to continue.</p>

          <button
            onClick={handleManualLogin}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors mb-4"
          >
            Open Login
          </button>

          <div className="text-sm text-gray-400 space-y-2">
            <p>If the login window does not appear:</p>
            <ul className="list-disc list-inside text-left">
              <li>Check your popup blocker settings</li>
              <li>Try clicking the Open Login button above</li>
              <li>Ensure JavaScript is enabled</li>
              <li>Clear your browser cache and reload</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading admin…</div>}>
      <AdminDashboard user={user} onLogout={handleLogoutClick} />
    </Suspense>
  );
};


const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <AdminStateProvider>
    <AdminApp />
  </AdminStateProvider>
);
