import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store';

export function useAuth() {
  const setProfile   = useAuthStore(s => s.setProfile);
  const clearProfile = useAuthStore(s => s.clearProfile);

  useEffect(() => {
    let active = true;

    // FIX race condition en nuevos usuarios:
    // Cuando Google OAuth crea un usuario por primera vez, onAuthStateChange
    // puede disparar ANTES de que el trigger haya creado el perfil en profiles.
    // Con reintentos esperamos hasta 3 segundos antes de rendirse.
    async function loadProfile(session, retry = 0) {
      if (!active) return;

      if (!session?.user) {
        clearProfile();
        return;
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (!active) return;

      if (profile && !error) {
        setProfile(profile);
      } else if (retry < 5) {
        // Reintenta cada 600ms — el trigger tarda < 1s normalmente
        await new Promise(r => setTimeout(r, 600));
        loadProfile(session, retry + 1);
      } else {
        // Después de 3s sin perfil → limpiar sesión
        clearProfile();
      }
    }

    supabase.auth.getSession().then(({ data }) => loadProfile(data.session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => { loadProfile(session); }
    );

    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  const loading = useAuthStore(s => s.loading);
  return { loading };
}
