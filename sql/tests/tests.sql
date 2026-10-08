\set ON_ERROR_STOP on

-- ═══ A. Datos de partida (superusuario) ═══
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','admin@t.es','{"full_name":"Admin"}'), ('aaaaaaaa-0000-0000-0000-000000000002','ana@t.es','{"name":"Ana"}'),
 ('aaaaaaaa-0000-0000-0000-000000000003','bob@t.es','{}'), ('aaaaaaaa-0000-0000-0000-000000000004','exp@t.es','{}'), ('aaaaaaaa-0000-0000-0000-000000000005','del@t.es','{}'),
 ('aaaaaaaa-0000-0000-0000-000000000006','pay@t.es','{}'), ('aaaaaaaa-0000-0000-0000-000000000007','ghost@t.es','{}');
SELECT test.ok((SELECT count(*) FROM profiles)=7, 'trigger on_auth_user_created crea los 7 perfiles');
SELECT test.ok((SELECT full_name FROM profiles WHERE id='aaaaaaaa-0000-0000-0000-000000000002')='Ana', 'full_name tomado de raw_user_meta_data.name');
SELECT test.ok((SELECT trial_ends_at FROM profiles WHERE id='aaaaaaaa-0000-0000-0000-000000000002') BETWEEN now()+interval '13 days' AND now()+interval '15 days', 'la BD asigna trial de 14 días');
SELECT test.ok((SELECT count(*) FROM events WHERE name='signup')=7, 'evento signup registrado');
UPDATE profiles SET role='admin' WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
UPDATE profiles SET subscription_status='active', subscription_ends_at=now()+interval '30 days' WHERE id='aaaaaaaa-0000-0000-0000-000000000003';
UPDATE profiles SET trial_ends_at=now()-interval '1 day' WHERE id='aaaaaaaa-0000-0000-0000-000000000004';
UPDATE profiles SET subscription_status='active', stripe_subscription_id='sub_123' WHERE id='aaaaaaaa-0000-0000-0000-000000000006';
DO $$ BEGIN FOR k IN 1..12 LOOP
  WITH q AS (INSERT INTO questions(text, explanation, correct_option_letter, difficulty, specialty_id, year_exam)
    VALUES ('Pregunta '||k, 'Expl '||k, (ARRAY['a','b','c','d'])[1 + k % 4], 1 + k % 5,
            CASE WHEN k<=6 THEN 'cardio' ELSE 'neumo' END, 2023) RETURNING id)
  INSERT INTO question_options(question_id, letter, text) SELECT q.id, l, 'Opción '||l FROM q, unnest(ARRAY['a','b','c','d']) l;
END LOOP; END $$;
INSERT INTO questions(text, correct_option_letter, specialty_id, status) VALUES ('Borrador no publicado','a','cardio','draft');
INSERT INTO notifications(user_id,title) VALUES (NULL,'Difusión'), ('aaaaaaaa-0000-0000-0000-000000000002','Solo Ana');
UPDATE notifications SET sent_at = now() + interval '1 minute';

-- ═══ B. ANA (trial vigente): seguridad de perfil ═══
RESET ROLE; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000002',false); SET ROLE authenticated;
SELECT test.ok((SELECT count(*) FROM profiles)=1, 'ana solo ve su propio perfil');
SELECT test.throws($q$UPDATE profiles SET role='admin' WHERE id=auth.uid()$q$, 'ana NO puede hacerse admin');
SELECT test.throws($q$UPDATE profiles SET subscription_status='active' WHERE id=auth.uid()$q$, 'ana NO puede activarse la suscripción');
SELECT test.throws($q$UPDATE profiles SET subscription_plan='premium' WHERE id=auth.uid()$q$, 'ana NO puede asignarse plan');
SELECT test.throws($q$UPDATE profiles SET trial_ends_at=now()+interval '999 days' WHERE id=auth.uid()$q$, 'ana NO puede alargar su trial');
SELECT test.throws($q$UPDATE profiles SET stripe_customer_id='cus_x' WHERE id=auth.uid()$q$, 'ana NO puede tocar campos de Stripe');
UPDATE profiles SET full_name='Ana G', onboarding_completed=true, baseline_score=150 WHERE id=auth.uid();
SELECT test.ok((SELECT full_name FROM profiles)='Ana G' AND (SELECT onboarding_completed FROM profiles), 'ana sí puede editar nombre y onboarding');
WITH d AS (DELETE FROM profiles WHERE id=auth.uid() RETURNING 1) SELECT test.ok((SELECT count(*) FROM d)=0, 'ana NO puede borrar su perfil');

-- ═══ C. ANA: acceso al banco y escrituras directas bloqueadas ═══
SELECT test.ok((SELECT count(*) FROM questions)=12, 'ana ve 12 preguntas (la de borrador no se publica)');
SELECT test.ok((SELECT count(*) FROM question_options)=48, 'ana ve las 48 opciones');
SELECT test.throws($q$INSERT INTO exam_responses(session_id,question_id,user_id,selected_option_letter,is_correct) VALUES (gen_random_uuid(),(SELECT id FROM questions LIMIT 1),auth.uid(),'a',true)$q$, 'ana NO puede insertar respuestas a mano');
SELECT test.throws($q$INSERT INTO exam_sessions(user_id,mode,score) VALUES (auth.uid(),'study',630)$q$, 'ana NO puede crear sesiones/puntuaciones a mano');
SELECT test.throws($q$INSERT INTO user_question_state(user_id,question_id) VALUES (auth.uid(),(SELECT id FROM questions LIMIT 1))$q$, 'ana NO puede escribir su estado SM-2');
SELECT test.throws($q$INSERT INTO weekly_ranking(user_id,week_start,score) VALUES (auth.uid(),current_date,9999)$q$, 'ana NO puede falsificar el ranking');
SELECT test.throws($q$INSERT INTO notifications(title) VALUES ('spam')$q$, 'ana NO puede crear notificaciones');
SELECT test.throws($q$INSERT INTO questions(text,correct_option_letter) VALUES ('x','a')$q$, 'ana NO puede crear preguntas');

-- ═══ D. Banco de preguntas por RPC (sin la respuesta) ═══
SELECT test.ok(jsonb_array_length(get_new_questions(NULL,NULL,5))=5, 'get_new_questions devuelve 5');
SELECT test.ok(position('correct_option_letter' in get_new_questions(NULL,NULL,12)::text)=0 AND position('explanation' in get_new_questions(NULL,NULL,12)::text)=0, 'get_new_questions NO incluye respuesta ni explicación');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(get_new_questions('cardio',NULL,12)) e WHERE e->'specialty'->>'id' <> 'cardio'), 'filtro por especialidad');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(get_new_questions(NULL,'1-2',12)) e WHERE (e->>'difficulty')::int NOT BETWEEN 1 AND 2), 'filtro de dificultad por rango');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(get_new_questions(NULL,NULL,12)) e WHERE e->>'text' = 'Borrador no publicado'), 'los borradores no se sirven');
SELECT test.ok((SELECT count(DISTINCT x) FROM (SELECT (jsonb_array_elements(get_new_questions(NULL,NULL,4))->>'id') AS x FROM generate_series(1,30)) s) > 4, 'el orden es aleatorio entre llamadas');

-- ═══ E. Sesión de estudio: respuesta a respuesta ═══
SELECT (start_session('study','{}',5,NULL)->>'id') AS sid \gset
SELECT id AS p1 FROM questions WHERE text='Pregunta 1' \gset
SELECT id AS p2 FROM questions WHERE text='Pregunta 2' \gset
SELECT id AS p3 FROM questions WHERE text='Pregunta 3' \gset
SELECT id AS p4 FROM questions WHERE text='Pregunta 4' \gset
SELECT id AS p5 FROM questions WHERE text='Pregunta 5' \gset
SELECT submit_answer(:'sid', :'p1', 'b', 20) AS r1 \gset
SELECT submit_answer(:'sid', :'p2', 'a', 5)  AS r2 \gset
SELECT test.ok((:'r1'::jsonb->>'is_correct')::boolean AND :'r1'::jsonb->>'correct_letter'='b' AND :'r1'::jsonb->>'explanation'='Expl 1', 'acierto: devuelve is_correct, letra y explicación');
SELECT test.ok(NOT (:'r2'::jsonb->>'is_correct')::boolean AND :'r2'::jsonb->>'correct_letter'='c', 'fallo: devuelve la letra correcta');
SELECT test.ok((SELECT times_correct FROM user_question_state WHERE question_id=:'p1')=1 AND (SELECT next_review FROM user_question_state WHERE question_id=:'p1')=current_date+1, 'SM-2: acierto → repaso en 1 día');
SELECT test.ok((SELECT times_wrong FROM user_question_state WHERE question_id=:'p2')=1 AND (SELECT next_review FROM user_question_state WHERE question_id=:'p2')=current_date+1 AND (SELECT repetitions FROM user_question_state WHERE question_id=:'p2')=0, 'SM-2: fallo → mañana (no hoy)');
SELECT test.ok((SELECT last_error_type FROM user_question_state WHERE question_id=:'p2')='descuido', 'error rápido (<10 s) clasificado como descuido');
SELECT test.ok((submit_answer(:'sid', :'p2', 'a', 5)->>'already_answered')::boolean, 'reintento idempotente');
SELECT test.ok((SELECT times_wrong FROM user_question_state WHERE question_id=:'p2')=1, 'el reintento NO duplica el fallo');
SELECT test.ok((SELECT count(*) FROM exam_responses WHERE session_id=:'sid')=2, 'solo 2 respuestas guardadas');
SELECT test.throws(format($f$SELECT submit_answer(%L, %L, 'z', 10)$f$, :'sid', :'p3'), 'opción inexistente rechazada');
SELECT test.throws(format($f$SELECT submit_answer(%L, %L, 'a', 10)$f$, gen_random_uuid(), :'p3'), 'sesión inexistente rechazada');
SELECT finish_session(:'sid') AS f1 \gset
SELECT test.ok((:'f1'::jsonb->>'correct')::int=1 AND (:'f1'::jsonb->>'wrong')::int=1 AND (:'f1'::jsonb->>'blank')::int=3 AND (:'f1'::jsonb->>'score')::int=2, 'finish_session: 1 acierto, 1 fallo, 3 en blanco, score 2');
SELECT test.ok((finish_session(:'sid')::jsonb)=:'f1'::jsonb, 'finish_session es idempotente');
SELECT test.ok((SELECT questions FROM weekly_ranking WHERE week_start=date_trunc('week',now())::date)=2 AND (SELECT score FROM weekly_ranking WHERE week_start=date_trunc('week',now())::date)=2, 'ranking semanal calculado 1 vez por sesión');
SELECT test.throws(format($f$SELECT submit_answer(%L, %L, 'a', 10)$f$, :'sid', :'p3'), 'no se puede responder en una sesión cerrada');

-- ═══ F. Segunda sesión → especialidades débiles ═══
SELECT (start_session('errores','{}',3,NULL)->>'id') AS sid2 \gset
SELECT submit_answer(:'sid2', :'p3', 'a', 40) \gset
SELECT submit_answer(:'sid2', :'p4', 'b', 40) \gset
SELECT submit_answer(:'sid2', :'p5', 'c', 40) \gset
SELECT test.ok((SELECT last_error_type FROM user_question_state WHERE question_id=:'p3')='conceptual', 'error lejano → conceptual');
SELECT test.ok((SELECT last_error_type FROM user_question_state WHERE question_id=:'p4')='confusion', 'error adyacente → confusión');
SELECT finish_session(:'sid2') \gset
SELECT test.ok((SELECT weak_specialties FROM profiles)=ARRAY['cardio'], 'weak_specialties = {cardio} calculado en el servidor');
SELECT test.ok(jsonb_array_length(get_failed_questions(10))=4, 'get_failed_questions: 4 falladas');
SELECT test.ok(position('correct_option_letter' in get_failed_questions(10)::text)>0, 'las falladas sí incluyen la respuesta (ya las contestó)');
SELECT test.ok(jsonb_array_length(get_due_reviews(10))=0, 'repaso: nada pendiente hoy (todo programado a mañana)');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);
UPDATE user_question_state SET next_review=current_date-1 WHERE question_id IN (SELECT id FROM questions WHERE text='Pregunta 2');


RESET ROLE; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000002',false); SET ROLE authenticated;
SELECT test.ok(jsonb_array_length(get_due_reviews(10))=1, 'repaso: una pendiente cuando vence');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(get_new_questions(NULL,NULL,7)) e WHERE (e->>'id')::uuid IN (SELECT question_id FROM user_question_state)), 'get_new_questions excluye las ya vistas mientras haya nuevas');
SELECT test.ok(jsonb_array_length(get_new_questions(NULL,NULL,12))=12, 'completa con vistas si no hay suficientes nuevas');

-- ═══ G. Simulacro: corrección en servidor ═══
SELECT (start_session('simulacro','{}',12,235)->>'id') AS sid3 \gset
SELECT get_simulacro_questions(12) AS simq \gset
SELECT test.ok(jsonb_array_length(:'simq'::jsonb)=12 AND (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(:'simq'::jsonb) e)=12, 'simulacro: 12 preguntas distintas');
SELECT test.ok((SELECT count(DISTINCT e->'specialty'->>'id') FROM jsonb_array_elements(:'simq'::jsonb) e)=2, 'simulacro reparte entre especialidades');
SELECT test.ok(position('correct_option_letter' in :'simq')=0, 'simulacro NO envía las respuestas');
SELECT test.throws(format($f$SELECT submit_answer(%L, %L, 'a', 10)$f$, :'sid3', :'p1'), 'submit_answer no vale para simulacro');
SELECT jsonb_agg(jsonb_build_object('question_id', e->>'id', 'letter', CASE WHEN ord <= 3 THEN NULL ELSE 'a' END, 'time_secs', 40)) AS ans
  FROM jsonb_array_elements(:'simq'::jsonb) WITH ORDINALITY AS t(e, ord) \gset
SELECT submit_session(:'sid3', :'ans'::jsonb) AS sub \gset
SELECT test.ok((:'sub'::jsonb->>'correct')::int + (:'sub'::jsonb->>'wrong')::int + (:'sub'::jsonb->>'blank')::int = 12, 'aciertos + fallos + blancos = 12');
SELECT test.ok((:'sub'::jsonb->>'blank')::int >= 3, 'las 3 sin responder cuentan como blanco');
SELECT test.ok((:'sub'::jsonb->>'score')::int = (:'sub'::jsonb->>'correct')::int*3 - (:'sub'::jsonb->>'wrong')::int, 'puntuación MIR +3 / -1 / 0');
SELECT test.ok((SELECT count(*) FROM exam_responses r JOIN questions q ON q.id=r.question_id WHERE r.session_id=:'sid3' AND r.selected_option_letter=q.correct_option_letter) = (:'sub'::jsonb->>'correct')::int, 'corrección verificada de forma independiente');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'sub'::jsonb->'results') r WHERE r->>'correct_letter' IS NULL), 'al entregar se revelan todas las soluciones');
SELECT test.ok((submit_session(:'sid3', :'ans'::jsonb)->>'already_submitted')::boolean, 'entrega idempotente (reintento por red)');
SELECT test.ok((SELECT num_correct FROM exam_sessions WHERE id=:'sid3')=(:'sub'::jsonb->>'correct')::int AND (SELECT finished_at FROM exam_sessions WHERE id=:'sid3') IS NOT NULL, 'sesión cerrada con sus contadores');
SELECT test.throws(format($f$SELECT submit_session(%L, '[]')$f$, :'sid'), 'submit_session no vale para modo estudio');

-- ═══ H. Otros usuarios ═══
RESET ROLE; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000003',false); SET ROLE authenticated;
SELECT test.ok((SELECT count(*) FROM questions)=12, 'bob (suscripción activa) ve el banco');
SELECT test.ok((SELECT count(*) FROM exam_sessions)=0 AND (SELECT count(*) FROM user_question_state)=0, 'bob no ve datos de ana');
SELECT test.throws(format($f$SELECT submit_answer(%L, %L, 'a', 10)$f$, :'sid2', :'p1'), 'bob NO puede usar la sesión de ana');
SELECT test.ok((SELECT count(*) FROM get_my_notifications())=1 AND NOT (SELECT read FROM get_my_notifications() LIMIT 1), 'bob ve la difusión sin leer (no la de ana)');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000004',false); SET ROLE authenticated;
SELECT test.ok(NOT has_access(), 'trial vencido → has_access() = false al instante (sin esperar al cron)');
SELECT test.ok((SELECT count(*) FROM questions)=0, 'usuario caducado NO puede leer el banco');
SELECT test.ok((SELECT count(*) FROM question_options)=0, '…ni las opciones');
SELECT test.throws($q$SELECT get_new_questions(NULL,NULL,5)$q$, 'caducado: get_new_questions rechazada');
SELECT test.throws($q$SELECT start_session('study','{}',5,NULL)$q$, 'caducado: no puede iniciar sesión de estudio');
SELECT test.ok((SELECT count(*) FROM profiles)=1, 'caducado sí puede leer su perfil (para ver el paywall)');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE anon;
SELECT test.throws($q$SELECT count(*) FROM questions$q$, 'anon NO puede leer preguntas');
SELECT test.throws($q$SELECT count(*) FROM profiles$q$, 'anon NO puede leer perfiles');
SELECT test.throws($q$SELECT get_new_questions(NULL,NULL,5)$q$, 'anon NO puede llamar a las RPC');
SELECT test.throws($q$SELECT count(*) FROM specialties$q$, 'anon NO puede leer especialidades');

-- ═══ I. Notificaciones por usuario ═══
RESET ROLE; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000002',false); SET ROLE authenticated;
SELECT test.ok((SELECT count(*) FROM get_my_notifications())=2, 'ana ve 2 notificaciones');
SELECT mark_notification_read((SELECT id FROM get_my_notifications() WHERE user_id IS NULL));
SELECT test.ok((SELECT read FROM get_my_notifications() WHERE user_id IS NULL), 'ana marca la difusión como leída');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000003',false); SET ROLE authenticated;
SELECT test.ok(NOT (SELECT read FROM get_my_notifications() WHERE user_id IS NULL), 'para bob sigue SIN leer (antes era global)');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000002',false); SET ROLE authenticated;
WITH u AS (UPDATE notifications SET title='hack' RETURNING 1) SELECT test.ok((SELECT count(*) FROM u)=0, 'ana NO puede modificar notificaciones');

-- ═══ J. Reportes, eventos, exportación ═══
INSERT INTO question_reports(question_id,user_id,reason,comment) VALUES (:'p1', auth.uid(), 'wrong_answer', 'Creo que es la c');
SELECT test.ok((SELECT count(*) FROM question_reports)=1, 'ana reporta una pregunta');
SELECT test.throws($q$INSERT INTO question_reports(question_id,user_id,reason) VALUES ((SELECT id FROM questions LIMIT 1),'aaaaaaaa-0000-0000-0000-000000000003','typo')$q$, 'ana NO puede reportar en nombre de otro');
SELECT track_event('paywall_shown', '{"from":"test"}'); SELECT track_event('DROP TABLE', '{}');
SELECT test.ok((SELECT count(*) FROM events)=0, 'ana no lee la tabla de eventos (solo admin)');
SELECT export_my_data() AS exp \gset
SELECT test.ok(:'exp'::jsonb ? 'perfil' AND jsonb_array_length(:'exp'::jsonb->'sesiones')=3 AND NOT (:'exp'::jsonb->'perfil' ? 'stripe_customer_id'), 'export_my_data: perfil + 3 sesiones, sin ids de Stripe');
SELECT test.throws($q$SELECT admin_analytics(30)$q$, 'ana NO puede ver analíticas de admin');
SELECT test.throws($q$SELECT admin_delete_user('aaaaaaaa-0000-0000-0000-000000000003')$q$, 'ana NO puede borrar usuarios');
SELECT test.throws($q$SELECT find_similar_questions('x')$q$, 'ana NO puede usar el buscador de duplicados');
SELECT test.throws($q$SELECT admin_get_question((SELECT id FROM questions LIMIT 1))$q$, 'ana NO puede pedir la solución por la vía de admin');

-- ═══ K. ADMIN ═══
RESET ROLE; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false); SET ROLE authenticated;
SELECT test.ok((SELECT count(*) FROM profiles)=7, 'admin ve todos los perfiles');
SELECT test.ok((SELECT count(*) FROM questions)=13, 'admin ve también los borradores');
SELECT test.ok((SELECT count(*) FROM events WHERE name='paywall_shown')=1 AND (SELECT count(*) FROM events WHERE name='DROP TABLE')=0, 'track_event registra eventos válidos y descarta los inválidos');
SELECT test.ok((SELECT count(*) FROM exam_responses)>=5, 'admin ve las respuestas de todos (analíticas fiables)');
SELECT admin_analytics(30) AS an \gset
SELECT test.ok((:'an'::jsonb->>'total')::int>=5 AND (:'an'::jsonb->'subs'->>'trial')::int>=1 AND jsonb_array_length(:'an'::jsonb->'crecimiento')=30, 'admin_analytics devuelve estructura completa');
SELECT test.ok((admin_user_stats('aaaaaaaa-0000-0000-0000-000000000002')->>'total')::int>=5 AND jsonb_array_length(admin_user_stats('aaaaaaaa-0000-0000-0000-000000000002')->'actividad')=30, 'admin_user_stats: 30 días de actividad');
SELECT test.ok((admin_funnel()->>'registrados')::int=6 AND (admin_funnel()->>'primera_sesion')::int=1 AND (admin_funnel()->>'de_pago')::int=2, 'admin_funnel: 6 registrados, 1 con sesión, 2 de pago');
SELECT test.ok(jsonb_typeof(admin_question_stats(1,10))='array', 'admin_question_stats devuelve lista');
SELECT test.ok(admin_get_question((SELECT id FROM questions WHERE text='Pregunta 1'))->>'correct_option_letter'='b' AND (admin_get_question((SELECT id FROM questions WHERE text='Pregunta 1'))->'options') IS NOT NULL, 'admin_get_question devuelve solución y opciones');
UPDATE profiles SET subscription_status='active', subscription_ends_at=now()+interval '30 days' WHERE id='aaaaaaaa-0000-0000-0000-000000000004';
SELECT test.ok((SELECT subscription_status FROM profiles WHERE id='aaaaaaaa-0000-0000-0000-000000000004')='active', 'admin SÍ puede activar suscripciones');
UPDATE questions SET status='draft' WHERE text='Pregunta 12';
SELECT test.ok((SELECT count(*) FROM questions WHERE status='published')=11, 'admin puede despublicar');
UPDATE questions SET status='published' WHERE text='Pregunta 12';
SELECT test.throws($q$SELECT admin_delete_user(auth.uid())$q$, 'admin NO puede borrarse a sí mismo');
SELECT admin_delete_user('aaaaaaaa-0000-0000-0000-000000000003');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);
SELECT test.ok(NOT EXISTS (SELECT 1 FROM auth.users WHERE id='aaaaaaaa-0000-0000-0000-000000000003') AND NOT EXISTS (SELECT 1 FROM profiles WHERE id='aaaaaaaa-0000-0000-0000-000000000003'), 'admin_delete_user borra de auth.users Y de profiles');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM notification_reads WHERE user_id='aaaaaaaa-0000-0000-0000-000000000003'), '…y en cascada sus datos');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false); SET ROLE authenticated;
SELECT test.throws($q$SELECT delete_my_account()$q$, 'un admin NO puede autoeliminarse con delete_my_account');

-- ═══ L. Cuenta propia (RGPD) ═══
RESET ROLE; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000005',false); SET ROLE authenticated;
SELECT delete_my_account();
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);
SELECT test.ok(NOT EXISTS (SELECT 1 FROM auth.users WHERE id='aaaaaaaa-0000-0000-0000-000000000005') AND NOT EXISTS (SELECT 1 FROM profiles WHERE id='aaaaaaaa-0000-0000-0000-000000000005'), 'delete_my_account elimina al usuario por completo');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000006',false); SET ROLE authenticated;
SELECT test.throws($q$SELECT delete_my_account()$q$, 'con suscripción activa de Stripe NO puede eliminarse sin cancelar');

-- ═══ M. Inserción de perfil (respaldo de useAuth) ═══
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);
DELETE FROM profiles WHERE id='aaaaaaaa-0000-0000-0000-000000000007';
RESET ROLE; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000007',false); SET ROLE authenticated;
SELECT test.throws($q$INSERT INTO profiles(id,email,role) VALUES (auth.uid(),'ghost@t.es','admin')$q$, 'no puede reinsertar su perfil como admin');
SELECT test.throws($q$INSERT INTO profiles(id,email,subscription_status) VALUES (auth.uid(),'ghost@t.es','active')$q$, 'no puede reinsertar su perfil como activo');
SELECT test.throws($q$INSERT INTO profiles(id,email,trial_ends_at) VALUES (auth.uid(),'ghost@t.es',now()+interval '999 days')$q$, 'no puede reinsertarse con trial infinito');
INSERT INTO profiles(id,email,role,subscription_status) VALUES (auth.uid(),'ghost@t.es','user','trial');
SELECT test.ok((SELECT count(*) FROM profiles)=1, 'sí puede reinsertarse como usuario en trial');

-- ═══ N. Seguridad de funciones ═══
RESET ROLE; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000002',false); SET ROLE authenticated;
SELECT test.throws($q$SELECT fn_apply_review(auth.uid(), (SELECT id FROM questions LIMIT 1), true, 'a', 'a', 10)$q$, 'fn_apply_review (interna) NO es invocable por usuarios');
SELECT test.throws($q$SELECT fn_purge_user(auth.uid())$q$, 'fn_purge_user (interna) NO es invocable por usuarios');
SELECT test.throws($q$SELECT expire_access()$q$, 'expire_access NO es invocable por usuarios');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);
SELECT test.ok(expire_access() >= 0, 'expire_access sí funciona desde el servidor');
RESET ROLE;
