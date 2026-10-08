// Crea una sesión de Stripe Checkout para el plan elegido.
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_ANNUAL, STRIPE_PRICE_PREMIUM, SITE_URL
// Plan "annual" = PAGO ÚNICO con acceso hasta el MIR (lo fija el webhook). monthly/premium = suscripción.
import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json } from '../_shared/cors.ts';

const PRICES: Record<string, string | undefined> = {
  monthly: Deno.env.get('STRIPE_PRICE_MONTHLY'),
  annual:  Deno.env.get('STRIPE_PRICE_ANNUAL'),
  premium: Deno.env.get('STRIPE_PRICE_PREMIUM'),
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'No autenticado' }, 401);

    const { plan } = await req.json();
    const price = PRICES[plan];
    if (!price) return json({ error: 'Plan no disponible' }, 400);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: profile } = await admin.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2023-10-16', httpClient: Stripe.createFetchHttpClient(),
    });

    let customer = profile?.stripe_customer_id as string | undefined;
    if (!customer) {
      customer = (await stripe.customers.create({ email: user.email!, metadata: { user_id: user.id } })).id;
      await admin.from('profiles').update({ stripe_customer_id: customer }).eq('id', user.id);
    }

    const site = Deno.env.get('SITE_URL')!;
    const oneTime = plan === 'annual';
    const meta = { user_id: user.id, plan };
    const session = await stripe.checkout.sessions.create({
      mode: oneTime ? 'payment' : 'subscription',
      customer,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,                       // cupones de embajadores
      metadata: meta,
      ...(oneTime ? { payment_intent_data: { metadata: meta } } : { subscription_data: { metadata: meta } }),
      ...(Deno.env.get('STRIPE_TAX') === '1' ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' } } : {}),
      success_url: `${site}/app/plan?checkout=success`,
      cancel_url:  `${site}/app/plan?checkout=cancel`,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error(e);
    return json({ error: 'No se pudo iniciar el pago' }, 500);
  }
});
