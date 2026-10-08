import { Component } from 'react';
import { reportError } from '../lib/supabase';

// Evita la pantalla en blanco: registra el fallo (tabla client_errors) y ofrece recargar.
export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { reportError(error, info?.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <h2 className="font-display font-bold text-xl text-ink mb-2">Algo ha fallado</h2>
          <p className="text-sm text-slate-500 mb-5">Hemos registrado el error. Tu progreso está guardado; recarga la página para continuar.</p>
          <button onClick={() => window.location.reload()}
            className="px-6 py-2.5 bg-ink text-white rounded-full text-sm font-bold">Recargar</button>
        </div>
      </div>
    );
  }
}
