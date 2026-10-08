// Portal de cliente de Stripe: cambiar tarjeta, ver facturas, cancelar.
import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext';
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

    const { data: profile } = await asUser.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
    if (!profile?.stripe_customer_id) return json({ error: 'Aún no tienes suscripción' }, 400);

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2023-10-16', httpClient: Stripe.createFetchHttpClient(),
    });
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id, return_url: `${Deno.env.get('SITE_URL')}/app/perfil`,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error(e);
    return json({ error: 'No se pudo abrir el portal' }, 500);
  }
});
