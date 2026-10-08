import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(URL, KEY);

// ─── Manejo de errores ─────────────────────────────────────
// must(): para ESCRITURAS y operaciones críticas → lanza el error (nunca se traga).
// soft(): para LECTURAS de apoyo → registra el error en consola y devuelve un valor por defecto.
function must(res, label) {
  if (res.error) {
    const err = new Error(res.error.message || label);
    err.code = res.error.code; err.label = label;
    throw err;
  }
  return res.data;
}
function soft(res, label, fallback) {
  if (res.error) { console.error(`[MIRai] ${label}:`, res.error.message); return fallback; }
  return res.data ?? fallback;
}

// ─── Auth helpers ──────────────────────────────────────────
export async function getProfile(userId) {
  const res = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return soft(res, 'getProfile', null);
}

export async function signOut() {
  // Limpia sesiones de examen guardadas en este navegador (otro usuario podría entrar después)
  try {
    Object.keys(localStorage).filter(k => k.startsWith('mirai-') || k.startsWith('mirai:'))
      .forEach(k => localStorage.removeItem(k));
  } catch { /* sin localStorage */ }
  await supabase.auth.signOut();
}

export const isAdmin         = p => p?.role === 'admin';
export const needsOnboarding = p => p && !p.onboarding_completed;
// Misma regla que has_access() en la base de datos (la BD es quien lo hace cumplir de verdad)
export const hasAccess = p => {
  if (!p) return false;
  if (p.role === 'admin') return true;
  const now = new Date();
  if (p.subscription_status === 'active')
    return !p.subscription_ends_at || new Date(p.subscription_ends_at) > now;
  if (p.subscription_status === 'trial')
    return !p.trial_ends_at || new Date(p.trial_ends_at) > now;
  return false;
};

// ─── Seguimiento de producto y errores (tablas events / client_errors) ───
export function track(name, props = {}) {
  supabase.rpc('track_event', { p_name: name, p_props: props }).then(() => {}, () => {});
}
export function reportError(error, extra) {
  const message = (error && error.message) || String(error);
  console.error('[MIRai]', message, extra || '');
  supabase.rpc('log_client_error', {
    p_message: message, p_stack: (error && error.stack) || null, p_url: window.location.href,
  }).then(() => {}, () => {});
}
export function installGlobalErrorHandlers() {
  window.addEventListener('error', e => reportError(e.error || e.message));
  window.addEventListener('unhandledrejection', e => reportError(e.reason));
}

// ─── Preguntas (el servidor NO envía la respuesta correcta) ──
export function normalizeQ(q) {
  if (!q) return q;
  return { ...q, options: [...(q.options || [])].sort((a, b) => a.letter.localeCompare(b.letter)) };
}

// Preguntas nuevas (no vistas primero), aleatorias. difficulty: "3" | "1-2" | "4-5"
export async function fetchQuestions({ specialtyId, difficulty, limit = 20 } = {}) {
  const res = await supabase.rpc('get_new_questions', {
    p_specialty: specialtyId || null, p_difficulty: difficulty ? String(difficulty) : null, p_limit: limit,
  });
  return must(res, 'fetchQuestions').map(normalizeQ).sort(() => Math.random() - 0.5);
}
export async function fetchSimulacroQuestions(total = 210) {
  const res = await supabase.rpc('get_simulacro_questions', { p_total: total });
  return must(res, 'fetchSimulacroQuestions').map(normalizeQ).sort(() => Math.random() - 0.5);
}
export async function fetchQuestionsByIds(ids) {
  if (!ids?.length) return [];
  const res = await supabase.rpc('get_questions_by_ids', { p_ids: ids });
  return must(res, 'fetchQuestionsByIds').map(normalizeQ);
}
// Admin: todo el banco, paginando (PostgREST devuelve máx. 1000 filas por petición)
export async function fetchAllQuestionsAdmin() {
  const out = [], PAGE = 1000;
  for (let from = 0; from < 100000; from += PAGE) {
    const res = await supabase.from('questions')
      .select(`id, text, difficulty, year_exam, is_active, status, source, image_url, subtopic, created_at,
               specialty:specialties(id, name), options:question_options(letter, text)`)
      .order('created_at', { ascending: false }).range(from, from + PAGE - 1);
    const rows = soft(res, 'fetchAllQuestionsAdmin', []);
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out.map(normalizeQ);
}

// ─── Especialidades (caché de sesión) ──────────────────────
let _specialtiesCache = null;
export async function fetchSpecialties() {
  if (_specialtiesCache) return _specialtiesCache;
  const res = await supabase.from('specialties').select('*').order('name');
  _specialtiesCache = soft(res, 'fetchSpecialties', []);
  return _specialtiesCache;
}
export function invalidateSpecialtiesCache() { _specialtiesCache = null; }

// ─── Sesiones y respuestas (todo pasa por RPC transaccionales) ──
export async function startSession({ mode, specialtyFilter = [], total, timeLimitMinutes = null }) {
  const res = await supabase.rpc('start_session', {
    p_mode: mode, p_specialty_filter: specialtyFilter, p_total: total, p_time_limit: timeLimitMinutes,
  });
  return must(res, 'startSession');
}
// Compatibilidad con el nombre antiguo
export const createSession = ({ mode, specialtyFilter, totalQuestions, timeLimitMinutes }) =>
  startSession({ mode, specialtyFilter, total: totalQuestions, timeLimitMinutes });

export async function submitAnswer(sessionId, questionId, letter, timeSecs) {
  const res = await supabase.rpc('submit_answer', {
    p_session_id: sessionId, p_question_id: questionId, p_letter: letter, p_time_secs: timeSecs,
  });
  return must(res, 'submitAnswer');            // { is_correct, correct_letter, explanation }
}
export async function finishSession({ sessionId }) {
  const res = await supabase.rpc('finish_session', { p_session_id: sessionId });
  return must(res, 'finishSession');           // { correct, wrong, blank, score }
}
export async function submitSession(sessionId, answers) {
  const res = await supabase.rpc('submit_session', { p_session_id: sessionId, p_answers: answers });
  return must(res, 'submitSession');           // { correct, wrong, blank, score, results[] }
}
// Eliminadas: la escritura directa de resultados la bloquea la BD (RLS)
export const saveResponses = () => { throw new Error('saveResponses ya no existe: usa submitAnswer / submitSession'); };
export const upsertQuestionState = () => { throw new Error('upsertQuestionState ya no existe: el SM-2 se calcula en el servidor'); };

// ─── Repetición espaciada (lectura) ────────────────────────
export async function getRepasoPendiente(_userId, limit = 20) {
  const res = await supabase.rpc('get_due_reviews', { p_limit: limit });
  return soft(res, 'getRepasoPendiente', []);
}
export async function countRepasoPendiente(userId) {
  const today = new Date().toISOString().split('T')[0];
  const { count, error } = await supabase.from('user_question_state')
    .select('*', { count: 'exact', head: true }).eq('user_id', userId).lte('next_review', today);
  if (error) console.error('[MIRai] countRepasoPendiente:', error.message);
  return count || 0;
}
export async function countFailedQuestions(userId) {
  const { count, error } = await supabase.from('user_question_state')
    .select('*', { count: 'exact', head: true }).eq('user_id', userId).gt('times_wrong', 0);
  if (error) console.error('[MIRai] countFailedQuestions:', error.message);
  return count || 0;
}
export async function getMostFailed(_userId, limit = 30) {
  const res = await supabase.rpc('get_failed_questions', { p_limit: limit });
  return soft(res, 'getMostFailed', []).map(d => ({ ...d, question: d.question ? normalizeQ(d.question) : null }));
}

// ─── Notas ─────────────────────────────────────────────────
export async function getNote(userId, questionId) {
  const res = await supabase.from('notes').select('*').eq('user_id', userId).eq('question_id', questionId).maybeSingle();
  return soft(res, 'getNote', null);
}
export async function upsertNote(userId, questionId, content) {
  const res = await supabase.from('notes')
    .upsert({ user_id: userId, question_id: questionId, content, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,question_id' }).select().single();
  return must(res, 'upsertNote');
}
export async function getUserNotes(userId) {
  const res = await supabase.from('notes')
    .select('*, question:questions(id, text, specialty:specialties(name))')
    .eq('user_id', userId).order('updated_at', { ascending: false });
  return soft(res, 'getUserNotes', []);
}

// ─── Notificaciones (leído por usuario) ────────────────────
export async function getNotifications() {
  const res = await supabase.rpc('get_my_notifications');
  return soft(res, 'getNotifications', []);
}
export async function markRead(id) {
  must(await supabase.rpc('mark_notification_read', { p_id: id }), 'markRead');
}
export async function sendNotification({ userIds, title, body, type }) {
  const rows = userIds.length === 0
    ? [{ title, body, type }]
    : userIds.map(id => ({ user_id: id, title, body, type }));
  must(await supabase.from('notifications').insert(rows), 'sendNotification');
}

// ─── Ranking ───────────────────────────────────────────────
function weekStart() {            // lunes de la semana actual en UTC (igual que date_trunc('week') en la BD)
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export async function getWeeklyRanking(limit = 50) {
  const res = await supabase.from('weekly_ranking')
    .select('user_id, questions, correct, score, percentile')
    .eq('week_start', weekStart()).order('score', { ascending: false }).limit(limit);
  return soft(res, 'getWeeklyRanking', []);
}
export async function getUserRank(userId) {
  const res = await supabase.from('weekly_ranking')
    .select('score, percentile, questions, correct').eq('user_id', userId).eq('week_start', weekStart()).maybeSingle();
  return soft(res, 'getUserRank', null);
}

// ─── Analíticas / histórico ────────────────────────────────
// Compatibilidad: la RPC no existe; devuelve null sin romper páginas antiguas.
export async function getUserAnalytics(userId, days = 30) {
  const { data, error } = await supabase.rpc('get_user_analytics', { p_user_id: userId, p_days: days });
  return error ? null : data;
}
export async function getSessionHistory(userId, limit = 50) {
  const res = await supabase.from('exam_sessions').select('*').eq('user_id', userId)
    .not('finished_at', 'is', null).order('started_at', { ascending: false }).limit(limit);
  return soft(res, 'getSessionHistory', []);
}
export async function getResponsesBySession(sessionId) {
  const res = await supabase.from('exam_responses')
    .select('*, question:questions(id, text, specialty:specialties(name), correct_option_letter)')
    .eq('session_id', sessionId);
  return soft(res, 'getResponsesBySession', []);
}
export async function getHistoricalCutoffs(year) {
  let q = supabase.from('historical_cutoffs').select('*, specialty:specialties(id, name, color)')
    .order('min_score', { ascending: false });
  if (year) q = q.eq('year', year);
  return soft(await q, 'getHistoricalCutoffs', []);
}

// ─── Configuración global ──────────────────────────────────
const _configCache = {};
export async function getAppConfig(key) {
  if (_configCache[key] !== undefined) return _configCache[key];
  const res = await supabase.from('app_config').select('value').eq('key', key).maybeSingle();
  _configCache[key] = soft(res, 'getAppConfig', null)?.value || null;
  return _configCache[key];
}
export function invalidateAppConfig(key) { delete _configCache[key]; }

// ─── Cuenta del usuario ────────────────────────────────────
export async function exportMyData() { return must(await supabase.rpc('export_my_data'), 'exportMyData'); }
export async function deleteMyAccount() { must(await supabase.rpc('delete_my_account'), 'deleteMyAccount'); }

// ─── Reportes de preguntas ─────────────────────────────────
export async function reportQuestion({ questionId, userId, reason, comment }) {
  must(await supabase.from('question_reports').insert({
    question_id: questionId, user_id: userId, reason, comment: comment?.trim() || null,
  }), 'reportQuestion');
}

// ─── Administración ────────────────────────────────────────
export const adminAnalytics     = async days => must(await supabase.rpc('admin_analytics', { p_days: days }), 'adminAnalytics');
export const adminUserStats     = async id   => must(await supabase.rpc('admin_user_stats', { p_user_id: id }), 'adminUserStats');
export const adminFunnel        = async ()   => must(await supabase.rpc('admin_funnel'), 'adminFunnel');
export const adminQuestionStats = async (minAttempts = 20, limit = 30) =>
  must(await supabase.rpc('admin_question_stats', { p_min_attempts: minAttempts, p_limit: limit }), 'adminQuestionStats');
export const adminDeleteUser    = async id   => must(await supabase.rpc('admin_delete_user', { target_user_id: id }), 'adminDeleteUser');

export async function createImportLog(adminId, filename, total) {
  const res = await supabase.from('import_logs').insert({ admin_id: adminId, filename, total, status: 'processing' }).select().single();
  return must(res, 'createImportLog');
}
export async function updateImportLog(id, updates) {
  must(await supabase.from('import_logs').update(updates).eq('id', id), 'updateImportLog');
}
export async function getImportLogs() {
  const res = await supabase.from('import_logs').select('*').order('created_at', { ascending: false }).limit(20);
  return soft(res, 'getImportLogs', []);
}
export async function insertQuestion(question, options) {
  const { data: q, error } = await supabase.from('questions').insert(question).select().single();
  if (error) throw error;
  if (options?.length) {
    const { error: optErr } = await supabase.from('question_options')
      .insert(options.map(o => ({ ...o, question_id: q.id })));
    if (optErr) {                                  // no dejar preguntas huérfanas sin opciones
      await supabase.from('questions').delete().eq('id', q.id);
      throw optErr;
    }
  }
  return q;
}
