import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store';

export function useAuth() {
  // FIX: eliminado setLoading — no existe en el store actual.
  // setProfile ya hace set({ profile, loading: false })
  // clearProfile ya hace set({ profile: null, loading: false })
  // El loading: true inicial del store cubre el estado de carga hasta
  // que getSession resuelve y llama a uno de los dos.
  const setProfile   = useAuthStore(s => s.setProfile);
  const clearProfile = useAuthStore(s => s.clearProfile);

  useEffect(() => {
    let active = true;

    async function loadProfile(session) {
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

      if (profile && !error) setProfile(profile);
      else clearProfile();
    }

    // Carga inicial
    supabase.auth.getSession().then(({ data }) => loadProfile(data.session));

    // Cambios de sesión (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => { loadProfile(session); }
    );

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const loading = useAuthStore(s => s.loading);
  return { loading };
}
