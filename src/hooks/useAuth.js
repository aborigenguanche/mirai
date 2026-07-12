import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store';

export function useAuth() {
  // FIX: el store antiguo usaba setUsuario/clearUsuario/setLoading.
  // El store nuevo usa setProfile/clearProfile (loading está integrado).
  // useAuth no se había actualizado → setUsuario era undefined →
  // TypeError: a is not a function al iniciar la app → crash total.
  const { setProfile, clearProfile, setLoading } = useAuthStore();

  useEffect(() => {
    let active = true;

    const loadProfile = async (session) => {
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

      if (error || !profile) {
        clearProfile();
      } else {
        setProfile(profile);
      }
    };

    const init = async () => {
      setLoading(true);
      const { data } = await supabase.auth.getSession();
      await loadProfile(data.session);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoading(true);
      loadProfile(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const { loading } = useAuthStore();
  return { loading };
}
