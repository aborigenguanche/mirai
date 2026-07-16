import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store';

export function useAuth() {
  const setProfile   = useAuthStore(s => s.setProfile);
  const clearProfile = useAuthStore(s => s.clearProfile);

  useEffect(() => {
    let active = true;

    async function loadProfile(session, retry = 0) {
      if (!active) return;
      if (!session?.user) { clearProfile(); return; }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!active) return;

      if (profile) {
        setProfile(profile);
      } else if (retry < 5) {
        await new Promise(r => setTimeout(r, 800));
        await loadProfile(session, retry + 1);
      } else {
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
