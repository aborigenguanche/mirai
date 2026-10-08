-- Esquema ANTIGUO (lo que había antes de esta sesión), con datos
CREATE TABLE specialties (id text primary key, name text, color text, mir_weight int);
INSERT INTO specialties VALUES ('cardio','Cardiología (nombre propio)','#111111',18), ('uro','Urología','#222222',7);
CREATE TABLE profiles (id uuid primary key references auth.users(id), email text, full_name text,
  role text default 'user', subscription_status text default 'trial', subscription_plan text,
  onboarding_completed boolean default false, created_at timestamptz default now());
CREATE TABLE questions (id uuid primary key default gen_random_uuid(), text text, explanation text,
  correct_option_letter character, difficulty int default 3, year_exam int, question_number int,
  specialty_id text references specialties(id), is_active boolean default true, created_at timestamptz default now());
CREATE TABLE question_options (id uuid primary key default gen_random_uuid(), question_id uuid references questions(id), letter character, text text);
CREATE TABLE exam_sessions (id uuid primary key default gen_random_uuid(), user_id uuid references profiles(id), mode text,
  specialty_filter text[], total_questions int, time_limit_minutes int, started_at timestamptz default now(),
  finished_at timestamptz, score numeric, num_correct int, num_wrong int, num_blank int,
  CONSTRAINT exam_sessions_mode_check CHECK (mode IN ('study','exam','simulacro')));
CREATE TABLE exam_responses (id uuid primary key default gen_random_uuid(), session_id uuid references exam_sessions(id),
  question_id uuid references questions(id), selected_option_letter character, is_correct boolean,
  time_taken_seconds int, answered_at timestamptz default now(), user_id uuid references profiles(id));
CREATE TABLE user_question_state (user_id uuid, question_id uuid, interval_days int, repetitions int, ease_factor numeric,
  next_review date, times_wrong int default 0, times_correct int default 0, last_error_type text, updated_at timestamptz,
  PRIMARY KEY (user_id, question_id));
CREATE TABLE notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, body text, type text, read boolean default false, sent_at timestamptz default now());
CREATE TABLE weekly_ranking (user_id uuid, week_start date, questions int, correct int, score numeric, percentile numeric, UNIQUE (user_id, week_start));
-- Antiguas políticas peligrosas y trigger de ranking por fila
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles: solo el propietario" ON profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "questions: lectura pública" ON questions FOR SELECT USING (true);
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') $$;
CREATE FUNCTION update_weekly_ranking() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_weekly_ranking AFTER INSERT ON exam_responses FOR EACH ROW EXECUTE FUNCTION update_weekly_ranking();
-- Datos reales
INSERT INTO auth.users(id,email) VALUES ('bbbbbbbb-0000-0000-0000-000000000001','viejo@t.es'), ('bbbbbbbb-0000-0000-0000-000000000002','admin@t.es');
INSERT INTO profiles(id,email,full_name,role,subscription_status) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001','viejo@t.es','Usuario Antiguo','user','trial'),
  ('bbbbbbbb-0000-0000-0000-000000000002','admin@t.es','Admin','admin','active');
INSERT INTO questions(id,text,correct_option_letter,specialty_id) VALUES ('cccccccc-0000-0000-0000-000000000001','Pregunta antigua','C','cardio');
INSERT INTO question_options(question_id,letter,text) VALUES ('cccccccc-0000-0000-0000-000000000001','a','A'),('cccccccc-0000-0000-0000-000000000001','a','A (duplicada)'),('cccccccc-0000-0000-0000-000000000001','c','C');
INSERT INTO exam_sessions(id,user_id,mode) VALUES ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','study');
INSERT INTO exam_responses(session_id,question_id,user_id,selected_option_letter,is_correct) VALUES
  ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','c',true),
  ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','c',true);

INSERT INTO auth.users(id,email) VALUES ('bbbbbbbb-0000-0000-0000-000000000009','huerfano@t.es');
