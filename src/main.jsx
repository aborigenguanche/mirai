import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { supabase } from './lib/supabase';

// 🔥 FIX CRÍTICO: limpiar OAuth hash ANTES de montar React
const hash = window.location.hash;

if (hash.includes('access_token')) {
  // opcional: dejar solo la ruta limpia
  window.history.replaceState({}, document.title, '/app/plan');
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);