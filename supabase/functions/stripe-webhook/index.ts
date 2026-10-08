// ÚNICO sitio que concede o retira acceso de pago. Verifica la firma de Stripe y es idempotente.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET. Desplegar con --no-verify-jwt.
import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16', httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const DAY = 86_400_000;

// Pago único "hasta el MIR": acceso hasta 7 días después del examen (mínimo 30 días desde hoy)
async function accessUntilMir(): Promise<string> {
  const { data } = await admin.from('app_config').select('value').eq('key', 'fecha_mir').maybeSingle();
  const mir = data?.value ? new Date(data.value).getTime() : null;
  const min = Date.now() + 30 * DAY;
  return new Date(mir ? Math.max(mir + 7 * DAY, min) : Date.now() + 365 * DAY).toISOString();
}

async function userIdFor(obj: { metadata?: Record<string, string> | null; customer?: unknown }): Promise<string | null> {
  if (obj.metadata?.user_id) return obj.metadata.user_id;
  const customer = typeof obj.customer === 'string' ? obj.customer : (obj.customer as { id?: string })?.id;
  if (!customer) return null;
  const { data } = await admin.from('profiles').select('id').eq('stripe_customer_id', customer).maybeSingle();
  return data?.id ?? null;
}

async function applySubscription(sub: Stripe.Subscription) {
  const uid = await userIdFor(sub);
  if (!uid) return;
  const alive = ['active', 'trialing', 'past_due'].includes(sub.status);   // past_due: Stripe reintenta el cobro
  await admin.from('profiles').update({
    subscription_status: alive ? 'active' : 'expired',
    subscription_plan: sub.metadata?.plan ?? undefined,
    subscription_ends_at: new Date(sub.current_period_end * 1000 + 2 * DAY).toISOString(),
    stripe_subscription_id: sub.id,
  }).eq('id', uid);
}

Deno.serve(async (req) => {
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, req.headers.get('stripe-signature')!, Deno.env.get('STRIPE_WEBHOOK_SECRET')!, undefined, cryptoProvider);
  } catch (e) {
    return new Response(`Firma no válida: ${(e as Error).message}`, { status: 400 });
  }

  // Idempotencia: Stripe puede reenviar el mismo evento
  const { error: dup } = await admin.from('stripe_events').insert({ id: event.id, type: event.type });
  if (dup?.code === '23505') return new Response('ya procesado', { status: 200 });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const uid = s.client_reference_id ?? s.metadata?.user_id;
        if (!uid) break;
        if (s.mode === 'payment') {                     // plan anual de pago único
          if (s.payment_status === 'paid') {
            await admin.from('profiles').update({
              subscription_status: 'active', subscription_plan: s.metadata?.plan ?? 'annual',
              subscription_ends_at: await accessUntilMir(),
            }).eq('id', uid);
          }
        } else if (s.subscription) {
          await applySubscription(await stripe.subscriptions.retrieve(s.subscription as string));
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await applySubscription(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const uid = await userIdFor(sub);
        if (uid) await admin.from('profiles').update({ subscription_status: 'expired' }).eq('id', uid);
        break;
      }
      case 'invoice.payment_failed':
        console.warn('Pago fallido', (event.data.object as Stripe.Invoice).customer);
        break;
    }
  } catch (e) {
    await admin.from('stripe_events').delete().eq('id', event.id);   // permitir el reintento de Stripe
    console.error(e);
    return new Response('error', { status: 500 });
  }
  return new Response('ok', { status: 200 });
});
