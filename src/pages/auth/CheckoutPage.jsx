import { Link } from 'react-router-dom';
export default function CheckoutPage() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="text-4xl mb-4">🔒</div>
        <h1 className="font-display text-2xl font-bold text-ink mb-2">Acceso restringido</h1>
        <p className="text-slate-400 text-sm mb-6">Tu período de prueba ha terminado o tu suscripción no está activa. Contacta con soporte para activar tu cuenta.</p>
        <Link to="/auth/login" className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white rounded-full text-sm font-semibold hover:opacity-90 transition-opacity">← Volver al inicio</Link>
      </div>
    </div>
  );
}
