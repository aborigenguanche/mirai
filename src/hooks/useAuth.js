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

      const user = session.user;

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!active) return;

      if (profile) {
        // Perfil encontrado — flujo normal
        setProfile(profile);
      } else if (retry < 3) {
        // Espera al trigger de Supabase (puede tardar ~500ms)
        await new Promise(r => setTimeout(r, 800));
        await loadProfile(session, retry + 1);
      } else {
        // El trigger no creó el perfil — lo creamos nosotros directamente
        // Esto cubre casos donde el trigger falla silenciosamente
        const { data: newProfile, error } = await supabase
          .from('profiles')
          .upsert({
            id:                   user.id,
            email:                user.email,
            full_name:            user.user_metadata?.full_name
                               || user.user_metadata?.name
                               || null,
            role:                 'user',
            subscription_status:  'trial',
            onboarding_completed: false,
          }, { onConflict: 'id' })
          .select()
          .single();

        if (!active) return;
        if (newProfile) setProfile(newProfile);
        else clearProfile();
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
