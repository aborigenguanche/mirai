// Crea un usuario desde el panel admin SIN tocar la sesión del admin
// (supabase.auth.signUp desde el navegador sustituiría la sesión del admin por la del nuevo usuario).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'No autenticado' }, 401);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: caller } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (caller?.role !== 'admin') return json({ error: 'Solo admins' }, 403);

    const { email, password, full_name, role = 'user', subscription_status = 'trial' } = await req.json();
    if (!/\S+@\S+\.\S+/.test(email ?? '') || (password ?? '').length < 8) return json({ error: 'Datos no válidos' }, 400);
    if (!['user', 'admin'].includes(role) || !['trial', 'active', 'expired'].includes(subscription_status)) {
      return json({ error: 'Rol o estado no válidos' }, 400);
    }

    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name },
    });
    if (error) return json({ error: error.message }, 400);

    // El trigger on_auth_user_created ya creó el perfil; ajustamos rol y estado
    await admin.from('profiles').update({ role, subscription_status, full_name: full_name || null }).eq('id', data.user.id);
    return json({ ok: true, id: data.user.id });
  } catch (e) {
    console.error(e);
    return json({ error: 'No se pudo crear el usuario' }, 500);
  }
});
