import { supabase } from '../lib/supabase';
import { sm2, calcularCalidad, clasificarError } from '../lib/spaced-repetition';

export function useSpacedRepetition(usuarioId) {

  // Obtener preguntas pendientes de repaso hoy
  async function getPendientesHoy(limite = 20) {
    const hoy = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('usuario_preguntas')
      .select('pregunta_id, intervalo, repeticiones, facilidad, veces_fallada, ultimo_error')
      .eq('usuario_id', usuarioId)
      .lte('proxima_revision', hoy)
      .order('proxima_revision', { ascending: true })
      .limit(limite);
    return data || [];
  }

  // Obtener IDs de preguntas ya vistas (para no repetir en modo "nuevas")
  async function getIdsVistos() {
    const { data } = await supabase
      .from('usuario_preguntas')
      .select('pregunta_id')
      .eq('usuario_id', usuarioId);
    return new Set(data?.map(d => d.pregunta_id) || []);
  }

  // Obtener preguntas más falladas
  async function getMasFalladas(limite = 20) {
    const { data } = await supabase
      .from('usuario_preguntas')
      .select(`
        pregunta_id, veces_fallada, veces_acertada, ultimo_error,
        pregunta:preguntas(id, enunciado, especialidad, dificultad, respuesta_correcta, opcion_a, opcion_b, opcion_c, opcion_d, opcion_e, explicacion, referencia)
      `)
      .eq('usuario_id', usuarioId)
      .gt('veces_fallada', 0)
      .order('veces_fallada', { ascending: false })
      .limit(limite);
    return data || [];
  }

  // Registrar resultado y actualizar SM-2
  async function registrarResultado({ preguntaId, esCorrecta, respuestaCorrecta, respuestaDada, tiempoSecs }) {
    const calidad   = calcularCalidad(esCorrecta, tiempoSecs);
    const tipoError = clasificarError(esCorrecta, respuestaCorrecta, respuestaDada, tiempoSecs);

    // Obtener estado actual de la tarjeta
    const { data: existing } = await supabase
      .from('usuario_preguntas')
      .select('*')
      .eq('usuario_id', usuarioId)
      .eq('pregunta_id', preguntaId)
      .maybeSingle();

    const estadoActual = existing || { intervalo: 1, repeticiones: 0, facilidad: 2.5 };
    const nuevoEstado  = sm2(estadoActual, calidad);

    const upsertData = {
      usuario_id:       usuarioId,
      pregunta_id:      preguntaId,
      intervalo:        nuevoEstado.intervalo,
      repeticiones:     nuevoEstado.repeticiones,
      facilidad:        nuevoEstado.facilidad,
      proxima_revision: nuevoEstado.proximaRevision,
      ultimo_error:     tipoError,
      veces_fallada:    (existing?.veces_fallada || 0) + (esCorrecta ? 0 : 1),
      veces_acertada:   (existing?.veces_acertada || 0) + (esCorrecta ? 1 : 0),
      updated_at:       new Date().toISOString(),
    };

    await supabase.from('usuario_preguntas').upsert(upsertData, { onConflict: 'usuario_id,pregunta_id' });

    // Actualizar tipo_error en el intento más reciente
    if (tipoError) {
      const { data: ultimoIntento } = await supabase
        .from('intentos')
        .select('id')
        .eq('usuario_id', usuarioId)
        .eq('pregunta_id', preguntaId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (ultimoIntento) {
        await supabase.from('intentos').update({ tipo_error: tipoError }).eq('id', ultimoIntento.id);
      }
    }

    return { nuevoEstado, tipoError, calidad };
  }

  // Estadísticas de errores del usuario
  async function getEstadisticasErrores() {
    const { data } = await supabase
      .from('intentos')
      .select('tipo_error, es_correcto, tiempo_segundos, created_at, pregunta:preguntas(especialidad)')
      .eq('usuario_id', usuarioId)
      .not('tipo_error', 'is', null);

    const errores = data || [];
    const porTipo = {
      conceptual: errores.filter(e => e.tipo_error === 'conceptual').length,
      confusion:  errores.filter(e => e.tipo_error === 'confusion').length,
      descuido:   errores.filter(e => e.tipo_error === 'descuido').length,
    };
    const total = Object.values(porTipo).reduce((a, b) => a + b, 0);

    // Errores por especialidad
    const espMap = {};
    errores.forEach(e => {
      const esp = e.pregunta?.especialidad;
      if (!esp) return;
      if (!espMap[esp]) espMap[esp] = { conceptual: 0, confusion: 0, descuido: 0, total: 0 };
      espMap[esp][e.tipo_error]++;
      espMap[esp].total++;
    });

    const tipoMasFrecuente = Object.entries(porTipo).sort((a,b) => b[1]-a[1])[0]?.[0] || null;

    return {
      porTipo, total, tipoMasFrecuente,
      porEspecialidad: Object.entries(espMap)
        .map(([nombre, d]) => ({ nombre, ...d }))
        .sort((a,b) => b.total - a.total),
    };
  }

  // Preguntas pendientes de repaso (conteo para el badge)
  async function countPendientesHoy() {
    const hoy = new Date().toISOString().split('T')[0];
    const { count } = await supabase
      .from('usuario_preguntas')
      .select('*', { count: 'exact', head: true })
      .eq('usuario_id', usuarioId)
      .lte('proxima_revision', hoy);
    return count || 0;
  }

  return { getPendientesHoy, getIdsVistos, getMasFalladas, registrarResultado, getEstadisticasErrores, countPendientesHoy };
}
