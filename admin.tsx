import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import AdminDashboard from './components/AdminDashboard';
import './index.css';
import { Buffer } from 'buffer';
import { AdminStateProvider } from './state/adminState';

// Polyfill Node.js globals for the browser environment.
// jszip relies on 'Buffer'.

// Add 'Buffer' to the global window object.
declare global {
  interface Window {
    Buffer: typeof Buffer;
    netlifyIdentity: any;
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
    const handleInit = (user: NetlifyUser | null) => {
      log('info', 'Netlify Identity init event.', { hasUser: !!user });
      setUser(user);
      if (!user) {
        // If no user on init, open the login modal.
        window.netlifyIdentity.open();
      }
    };

    const handleLogin = (loggedInUser: NetlifyUser) => {
      log('info', 'Netlify Identity login event.', { userEmail: loggedInUser.email });
      setUser(loggedInUser);
      window.netlifyIdentity.close();
    };
    
    const handleLogout = () => {
      log('info', 'Netlify Identity logout event.');
      setUser(null);
      // Re-open the login modal after logging out.
      window.netlifyIdentity.open();
    };
    
    if (window.netlifyIdentity) {
      // Register event listeners first
      window.netlifyIdentity.on('init', handleInit);
      window.netlifyIdentity.on('login', handleLogin);
      window.netlifyIdentity.on('logout', handleLogout);

      // Then initialize the widget. This will trigger the 'init' event.
      window.netlifyIdentity.init();
    }

    // Cleanup listeners on component unmount
    return () => {
      if (window.netlifyIdentity) {
        window.netlifyIdentity.off('init', handleInit);
        window.netlifyIdentity.off('login', handleLogin);
        window.netlifyIdentity.off('logout', handleLogout);
      }
    };
  }, []); // Empty dependency array ensures this effect runs only once.

  const handleLogoutClick = () => {
    if (window.netlifyIdentity) {
      window.netlifyIdentity.logout();
    }
  };

  if (!user) {
    return (
      <div className="bg-neutral-dark min-h-screen flex items-center justify-center text-white text-center p-4">
        <div>
          <h1 className="text-2xl font-bold mb-4">Admin Portal</h1>
          <p>Please log in to continue.</p>
          <p className="text-sm text-gray-400 mt-2">(If the login window doesn't appear, please check your popup blocker)</p>
        </div>
      </div>
    );
  }

  return <AdminDashboard user={user} onLogout={handleLogoutClick} />;
};


const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AdminStateProvider>
      <AdminApp />
    </AdminStateProvider>
  </React.StrictMode>
);
