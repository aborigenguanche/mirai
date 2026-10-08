# Edge Functions de MIRai

| Función | Qué hace | JWT |
|---|---|---|
| `create-checkout-session` | Abre Stripe Checkout (anual = pago único hasta el MIR) | sí |
| `create-portal-session` | Portal de cliente de Stripe (tarjeta, facturas, cancelar) | sí |
| `stripe-webhook` | **Único** que concede/retira acceso de pago | **no** |
| `admin-create-user` | Crea usuarios desde el admin sin cambiar tu sesión | sí |
| `send-lifecycle-emails` | Emails de bienvenida / fin de trial (Resend), 1 vez cada uno | **no** (usa `CRON_SECRET`) |

## Despliegue
```bash
supabase link --project-ref <tu-ref>
supabase functions deploy create-checkout-session create-portal-session admin-create-user
supabase functions deploy stripe-webhook send-lifecycle-emails --no-verify-jwt

supabase secrets set SITE_URL=https://tu-dominio \
  STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... \
  STRIPE_PRICE_MONTHLY=price_... STRIPE_PRICE_ANNUAL=price_... STRIPE_PRICE_PREMIUM=price_... \
  RESEND_API_KEY=re_... EMAIL_FROM="MIRai <hola@tu-dominio>" CRON_SECRET=<aleatorio>
```
En Stripe: crea 3 precios (el anual como **pago único**), activa el Portal de cliente y añade el
webhook `https://<ref>.supabase.co/functions/v1/stripe-webhook` con los eventos
`checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_failed`.
Prueba primero con claves `sk_test_` y la CLI: `stripe listen --forward-to .../stripe-webhook`.

> ⚠ Estas funciones están escritas pero **no se han podido ejecutar contra Stripe/Resend reales**
> (requieren tus cuentas). Pruébalas en modo test antes de cobrar.
