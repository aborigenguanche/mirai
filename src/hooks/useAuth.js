import { useEffect } from 'react';
import { supabase, getProfile } from '../lib/supabase';
import { useAuthStore } from '../store';

export function useAuth() {
  const { profile, loading, setProfile, clearProfile } = useAuthStore();

  useEffect(() => {
    // Sesión inicial
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const p = await getProfile(session.user.id);
        p ? setProfile(p) : clearProfile();
      } else {
        clearProfile();
      }
    });

    // Cambios en tiempo real
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          const p = await getProfile(session.user.id);
          p ? setProfile(p) : clearProfile();
        } else {
          clearProfile();
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return { profile, loading };
}
