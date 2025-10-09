import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { Buffer } from 'buffer';
import { AppStateProvider } from './state/appState';

// Polyfill Node.js globals for the browser environment.
// jszip relies on 'Buffer'.

// Add 'Buffer' to the global window object.
declare global {
  interface Window {
    Buffer: typeof Buffer;
  }
}
window.Buffer = Buffer;

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </React.StrictMode>
);
