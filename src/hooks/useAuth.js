import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store';

export function useAuth() {
  const setProfile   = useAuthStore(s => s.setProfile);
  const clearProfile = useAuthStore(s => s.clearProfile);

  useEffect(() => {
    let active = true;

    async function loadProfile(session) {
      if (!active) return;
      if (!session?.user) { clearProfile(); return; }

      const user = session.user;

      // 1. Buscar perfil existente
      const { data: existing } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!active) return;

      if (existing) {
        // Perfil encontrado — flujo normal
        setProfile(existing);
        return;
      }

      // 2. No existe — crearlo directamente
      // Cubre: nuevos usuarios, usuarios con perfil borrado por admin
      const { data: created, error } = await supabase
        .from('profiles')
        .insert({
          id:                   user.id,
          email:                user.email,
          full_name:            user.user_metadata?.full_name
                             || user.user_metadata?.name
                             || null,
          role:                 'user',
          subscription_status:  'trial',
          onboarding_completed: false,
        })
        .select()
        .single();

      if (!active) return;

      if (created) setProfile(created);
      else { console.error('Error creando perfil:', error); clearProfile(); }
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
