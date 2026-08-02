import React from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './admin/AdminApp.jsx';
import { SiteConfigProvider } from './lib/site-config.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SiteConfigProvider surface="admin">
      <AdminApp />
    </SiteConfigProvider>
  </React.StrictMode>,
);
