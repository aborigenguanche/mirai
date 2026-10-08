import { describe, it, expect, vi } from 'vitest';
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
const { hasAccess, needsOnboarding, isAdmin } = await import('../supabase');

const future = new Date(Date.now() + 86400000).toISOString();
const past   = new Date(Date.now() - 86400000).toISOString();

describe('hasAccess (misma regla que has_access() en la BD)', () => {
  it('sin perfil → no', () => expect(hasAccess(null)).toBe(false));
  it('admin → siempre', () => expect(hasAccess({ role: 'admin', subscription_status: 'expired' })).toBe(true));
  it('trial vigente / sin fecha → sí', () => {
    expect(hasAccess({ role: 'user', subscription_status: 'trial', trial_ends_at: future })).toBe(true);
    expect(hasAccess({ role: 'user', subscription_status: 'trial', trial_ends_at: null })).toBe(true);
  });
  it('trial vencido → no (aunque el estado siga en "trial")', () =>
    expect(hasAccess({ role: 'user', subscription_status: 'trial', trial_ends_at: past })).toBe(false));
  it('suscripción activa vigente / sin fecha → sí; vencida → no', () => {
    expect(hasAccess({ role: 'user', subscription_status: 'active', subscription_ends_at: future })).toBe(true);
    expect(hasAccess({ role: 'user', subscription_status: 'active', subscription_ends_at: null })).toBe(true);
    expect(hasAccess({ role: 'user', subscription_status: 'active', subscription_ends_at: past })).toBe(false);
  });
  it('expired → no', () => expect(hasAccess({ role: 'user', subscription_status: 'expired' })).toBe(false));
});
describe('helpers de perfil', () => {
  it('needsOnboarding / isAdmin', () => {
    expect(needsOnboarding({ onboarding_completed: false })).toBe(true);
    expect(needsOnboarding({ onboarding_completed: true })).toBe(false);
    expect(isAdmin({ role: 'admin' })).toBe(true); expect(isAdmin({ role: 'user' })).toBe(false);
  });
});
