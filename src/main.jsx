import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { SiteConfigProvider } from './lib/site-config.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SiteConfigProvider surface="teacher">
      <App />
    </SiteConfigProvider>
  </React.StrictMode>,
);
