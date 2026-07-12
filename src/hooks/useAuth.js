import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store';

export function useAuth() {
  const { setUsuario, clearUsuario, setLoading } = useAuthStore();

  useEffect(() => {
    let active = true;

    const loadProfile = async (session) => {
      if (!active) return;

      // No hay usuario → limpiar estado
      if (!session?.user) {
        clearUsuario();
        setLoading(false);
        return;
      }

      // 👇 LEER DIRECTAMENTE DE profiles (sin capas intermedias)
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (!active) return;

      if (error || !profile) {
        clearUsuario();
      } else {
        setUsuario(profile);
      }

      setLoading(false);
    };

    const init = async () => {
      setLoading(true);

      const { data } = await supabase.auth.getSession();
      await loadProfile(data.session);
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoading(true);
      loadProfile(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return {};
}