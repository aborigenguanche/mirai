import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(URL, KEY);

// ─── Auth helpers ──────────────────────────────────────────
export async function getProfile(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return data;
}

export async function signOut() { await supabase.auth.signOut(); }

export const isAdmin     = p => p?.role === 'admin';
export const hasAccess   = p => p?.role === 'admin' || ['trial','active'].includes(p?.subscription_status);
export const needsOnboarding = p => p && !p.onboarding_completed;

// ─── Questions ─────────────────────────────────────────────
const Q_SELECT = `
  id, text, explanation, correct_option_letter, difficulty, year_exam, question_number,
  specialty:specialties(id, name, color, mir_weight),
  options:question_options(letter, text)
`;

export async function fetchQuestions({ specialtyId, difficulty, limit = 20, excludeIds = [], yearExam } = {}) {
  let q = supabase.from('questions').select(Q_SELECT).eq('is_active', true);
  if (specialtyId)       q = q.eq('specialty_id', specialtyId);
  if (difficulty)        q = q.eq('difficulty', difficulty);
  if (yearExam)          q = q.eq('year_exam', yearExam);
  if (excludeIds.length) q = q.not('id', 'in', `(${excludeIds.join(',')})`);
  const { data } = await q.limit(limit);
  return (data || []).map(normalizeQ).sort(() => Math.random() - 0.5);
}

export async function fetchQuestionsByIds(ids) {
  if (!ids.length) return [];
  const { data } = await supabase.from('questions').select(Q_SELECT).in('id', ids).eq('is_active', true);
  return (data || []).map(normalizeQ);
}

export async function fetchAllQuestionsAdmin() {
  const { data } = await supabase
    .from('questions')
    .select(`id, text, difficulty, year_exam, is_active, created_at,
      specialty:specialties(id, name),
      options:question_options(letter, text)`)
    .order('created_at', { ascending: false });
  return (data || []).map(normalizeQ);
}

export function normalizeQ(q) {
  if (!q) return q;
  return { ...q, options: [...(q.options || [])].sort((a,b) => a.letter.localeCompare(b.letter)) };
}

// ─── Specialties ────────────────────────────────────────────
export async function fetchSpecialties() {
  const { data } = await supabase.from('specialties').select('*').order('name');
  return data || [];
}

// ─── Sessions & Responses ──────────────────────────────────
export async function createSession({ userId, mode, specialtyFilter, totalQuestions, timeLimitMinutes }) {
  const { data } = await supabase.from('exam_sessions').insert({
    user_id: userId, mode, specialty_filter: specialtyFilter,
    total_questions: totalQuestions, time_limit_minutes: timeLimitMinutes,
  }).select().single();
  return data;
}

export async function finishSession({ sessionId, numCorrect, numWrong, numBlank, score }) {
  const { data } = await supabase.from('exam_sessions').update({
    finished_at: new Date().toISOString(),
    num_correct: numCorrect, num_wrong: numWrong, num_blank: numBlank, score,
  }).eq('id', sessionId).select().single();
  return data;
}

export async function saveResponses(responses) {
  if (!responses.length) return;
  await supabase.from('exam_responses').insert(responses);
}

// ─── Spaced Repetition ─────────────────────────────────────
export async function getRepasoPendiente(userId, limit = 20) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('user_question_state')
    .select('question_id, interval_days, repetitions, ease_factor, times_wrong')
    .eq('user_id', userId)
    .lte('next_review', today)
    .order('next_review')
    .limit(limit);
  return data || [];
}

export async function upsertQuestionState(userId, questionId, state) {
  await supabase.from('user_question_state').upsert(
    { user_id: userId, question_id: questionId, ...state, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,question_id' }
  );
}

export async function countRepasoPendiente(userId) {
  const today = new Date().toISOString().split('T')[0];
  const { count } = await supabase
    .from('user_question_state')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .lte('next_review', today);
  return count || 0;
}

export async function getMostFailed(userId, limit = 30) {
  const { data } = await supabase
    .from('user_question_state')
    .select(`question_id, times_wrong, times_correct, last_error_type,
      question:questions(${Q_SELECT.trim()})`)
    .eq('user_id', userId)
    .gt('times_wrong', 0)
    .order('times_wrong', { ascending: false })
    .limit(limit);
  return (data || []).map(d => ({ ...d, question: d.question ? normalizeQ(d.question) : null }));
}

// ─── Notes ─────────────────────────────────────────────────
export async function getNote(userId, questionId) {
  const { data } = await supabase.from('notes')
    .select('*').eq('user_id', userId).eq('question_id', questionId).maybeSingle();
  return data;
}

export async function upsertNote(userId, questionId, content) {
  const { data } = await supabase.from('notes')
    .upsert({ user_id: userId, question_id: questionId, content, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,question_id' })
    .select().single();
  return data;
}

export async function getUserNotes(userId) {
  const { data } = await supabase.from('notes')
    .select(`*, question:questions(id, text, specialty:specialties(name))`)
    .eq('user_id', userId).order('updated_at', { ascending: false });
  return data || [];
}

// ─── Notifications ─────────────────────────────────────────
export async function getNotifications(userId) {
  const { data } = await supabase.from('notifications')
    .select('*')
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order('sent_at', { ascending: false }).limit(20);
  return data || [];
}

export async function markRead(id) {
  await supabase.from('notifications').update({ read: true }).eq('id', id);
}

export async function sendNotification({ userIds, title, body, type }) {
  const rows = userIds.length === 0
    ? [{ title, body, type }]                                 // broadcast
    : userIds.map(id => ({ user_id: id, title, body, type }));
  await supabase.from('notifications').insert(rows);
}

// ─── Rankings ───────────────────────────────────────────────
export async function getWeeklyRanking(limit = 50) {
  const { data } = await supabase.from('weekly_ranking')
    .select('user_id, questions, correct, score, percentile')
    .eq('week_start', weekStart())
    .order('score', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function getUserRank(userId) {
  const { data } = await supabase.from('weekly_ranking')
    .select('score, percentile, questions, correct')
    .eq('user_id', userId).eq('week_start', weekStart()).maybeSingle();
  return data;
}

function weekStart() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().split('T')[0];
}

// ─── Analytics ─────────────────────────────────────────────
export async function getUserAnalytics(userId, days = 30) {
  const { data } = await supabase.rpc('get_user_analytics', { p_user_id: userId, p_days: days });
  return data;
}

export async function getSessionHistory(userId, limit = 50) {
  const { data } = await supabase.from('exam_sessions')
    .select('*').eq('user_id', userId)
    .not('finished_at', 'is', null)
    .order('started_at', { ascending: false }).limit(limit);
  return data || [];
}

export async function getResponsesBySession(sessionId) {
  const { data } = await supabase.from('exam_responses')
    .select(`*, question:questions(id, text, specialty:specialties(name), correct_option_letter)`)
    .eq('session_id', sessionId);
  return data || [];
}

// ─── Simulacro ─────────────────────────────────────────────
export async function getHistoricalCutoffs(year) {
  let q = supabase.from('historical_cutoffs')
    .select('*, specialty:specialties(id, name, color)').order('min_score', { ascending: false });
  if (year) q = q.eq('year', year);
  const { data } = await q;
  return data || [];
}

// ─── Import ────────────────────────────────────────────────
export async function createImportLog(adminId, filename, total) {
  const { data } = await supabase.from('import_logs')
    .insert({ admin_id: adminId, filename, total, status: 'processing' })
    .select().single();
  return data;
}

export async function updateImportLog(id, updates) {
  await supabase.from('import_logs').update(updates).eq('id', id);
}

export async function getImportLogs() {
  const { data } = await supabase.from('import_logs')
    .select('*').order('created_at', { ascending: false }).limit(20);
  return data || [];
}

export async function insertQuestion(question, options) {
  const { data: q, error } = await supabase.from('questions').insert(question).select().single();
  if (error) throw error;
  if (options?.length) {
    await supabase.from('question_options').insert(options.map(o => ({ ...o, question_id: q.id })));
  }
  return q;
}
