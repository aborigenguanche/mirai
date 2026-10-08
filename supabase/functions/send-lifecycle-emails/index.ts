// Emails de ciclo de vida (bienvenida, trial a punto de acabar, trial acabado) con Resend.
// Se ejecuta a diario (ver sql/optional/cron_emails.sql). Cada email se envía UNA sola vez (tabla email_log).
// Secrets: RESEND_API_KEY, EMAIL_FROM ("MIRai <hola@tudominio.com>"), SITE_URL, CRON_SECRET
// ⚠ Texto legal (baja/consentimiento) pendiente de revisar con un abogado antes de activarlo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const SITE = Deno.env.get('SITE_URL') ?? '';
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const wrap = (title: string, body: string, cta: string) => `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0a0f1a">
  <h2 style="margin:0 0 12px">${title}</h2>${body}
  <p style="margin:24px 0"><a href="${SITE}/app/plan" style="background:#0a0f1a;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none">${cta}</a></p>
  <p style="font-size:12px;color:#64748b">MIRai · Recibes este mensaje porque tienes una cuenta en MIRai.</p>
</div>`;

const TEMPLATES: Record<string, (name: string) => { subject: string; html: string }> = {
  welcome: (n) => ({ subject: 'Bienvenido a MIRai', html: wrap(`Hola${n}, ¡bienvenido!`,
    '<p>Tu plan de estudio ya está listo. Empieza con una sesión corta: la constancia supera a la intensidad.</p>', 'Ir a mi plan de hoy') }),
  trial_ending_4d: (n) => ({ subject: 'Te quedan 4 días de prueba', html: wrap(`Hola${n}`,
    '<p>Tu prueba gratuita termina en 4 días. Elige un plan para no perder tu historial de errores y repasos.</p>', 'Ver planes') }),
  trial_ending_1d: (n) => ({ subject: 'Mañana termina tu prueba', html: wrap(`Hola${n}`,
    '<p>Mañana termina tu prueba gratuita. Tu progreso se conserva: solo tienes que elegir un plan.</p>', 'Seguir estudiando') }),
  trial_expired: (n) => ({ subject: 'Tu prueba ha terminado', html: wrap(`Hola${n}`,
    '<p>Tu prueba ha terminado, pero tu progreso sigue guardado. Reactiva tu acceso cuando quieras.</p>', 'Reactivar mi acceso') }),
};

async function sendTo(kind: string, rows: { id: string; email: string; full_name: string | null }[]) {
  let sent = 0;
  for (const u of rows) {
    if (!u.email) continue;
    const { error } = await admin.from('email_log').insert({ user_id: u.id, kind });
    if (error) continue;                                   // ya enviado (clave única) o fallo → no repetir
    const first = u.full_name?.split(' ')[0];
    const { subject, html } = TEMPLATES[kind](first ? ` ${first}` : '');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: Deno.env.get('EMAIL_FROM'), to: u.email, subject, html }),
    });
    if (res.ok) sent++;
    else await admin.from('email_log').delete().eq('user_id', u.id).eq('kind', kind);   // reintentar mañana
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('forbidden', { status: 403 });
  const cols = 'id, email, full_name';
  const out: Record<string, number> = {};
  const q = (f: (b: any) => any) => f(admin.from('profiles').select(cols).eq('role', 'user'));

  out.welcome = await sendTo('welcome', (await q(b => b.gte('created_at', iso(-1)))).data ?? []);
  out.trial_ending_4d = await sendTo('trial_ending_4d',
    (await q(b => b.eq('subscription_status', 'trial').gte('trial_ends_at', iso(3)).lt('trial_ends_at', iso(4)))).data ?? []);
  out.trial_ending_1d = await sendTo('trial_ending_1d',
    (await q(b => b.eq('subscription_status', 'trial').gte('trial_ends_at', iso(0)).lt('trial_ends_at', iso(1)))).data ?? []);
  out.trial_expired = await sendTo('trial_expired',
    (await q(b => b.in('subscription_status', ['trial', 'expired']).gte('trial_ends_at', iso(-1)).lt('trial_ends_at', iso(0)))).data ?? []);
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
});
