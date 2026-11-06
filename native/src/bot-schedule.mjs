// Horário de atendimento da IA (resposta automática) + chave manual.
// mode: 'auto' = segue o horário | 'on' = sempre ligada | 'off' = sempre desligada (só atendente).
// Horários no fuso de Brasília (America/Sao_Paulo). Faixa que passa da meia-noite (ex.: 18:00–02:00) é aceita.

export const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultSchedule() {
  const days = {};
  for (let d = 0; d < 7; d++) days[d] = [{start: '18:00', end: '23:30'}];
  return {mode: 'on', tz: 'America/Sao_Paulo', days, updatedAt: null};
}

/** Valida e normaliza o que vem do painel. Lança erro com mensagem clara. */
export function normalizeSchedule(input, previous = defaultSchedule()) {
  const mode = String(input?.mode ?? previous.mode);
  if (!['auto', 'on', 'off'].includes(mode)) throw new Error('Modo inválido (use auto, on ou off)');
  const days = {};
  const src = input?.days ?? previous.days ?? {};
  for (let d = 0; d < 7; d++) {
    const list = Array.isArray(src[d]) ? src[d] : [];
    if (list.length > 3) throw new Error(`${DAY_NAMES[d]}: no máximo 3 faixas de horário`);
    days[d] = list.map(r => {
      const start = String(r?.start || ''), end = String(r?.end || '');
      if (!HHMM.test(start) || !HHMM.test(end)) throw new Error(`${DAY_NAMES[d]}: horário inválido (use HH:MM)`);
      if (start === end) throw new Error(`${DAY_NAMES[d]}: início e fim iguais`);
      return {start, end};
    });
  }
  return {mode, tz: 'America/Sao_Paulo', days, updatedAt: new Date().toISOString()};
}

const toMin = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** Dia da semana (0-6) e minuto do dia no fuso de Brasília. */
export function localClock(date, tz = 'America/Sao_Paulo') {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(date);
  const get = t => parts.find(p => p.type === t)?.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {day, minute: Number(get('hour')) * 60 + Number(get('minute'))};
}

/** A IA deve responder agora? */
export function isBotActive(schedule, date = new Date()) {
  const s = schedule || defaultSchedule();
  if (s.mode === 'on') return true;
  if (s.mode === 'off') return false;
  const {day, minute} = localClock(date, s.tz);
  // Faixas do dia de hoje.
  for (const r of s.days?.[day] || []) {
    const a = toMin(r.start), b = toMin(r.end);
    if (a < b ? minute >= a && minute < b : minute >= a) return true;
  }
  // Faixa de ontem que atravessou a meia-noite (ex.: sexta 18:00–02:00 vale sábado até 02:00).
  for (const r of s.days?.[(day + 6) % 7] || []) {
    const a = toMin(r.start), b = toMin(r.end);
    if (a > b && minute < b) return true;
  }
  return false;
}

/** Texto curto para o painel: "Ligada agora (horário 18:00–23:30)". */
export function describeSchedule(schedule, date = new Date()) {
  const s = schedule || defaultSchedule();
  const active = isBotActive(s, date);
  if (s.mode === 'on') return {active, label: 'IA ligada (manual)'};
  if (s.mode === 'off') return {active, label: 'IA desligada (manual)'};
  const {day} = localClock(date, s.tz);
  const today = (s.days?.[day] || []).map(r => `${r.start}–${r.end}`).join(', ') || 'sem horário hoje';
  return {active, label: `${active ? 'IA ligada' : 'IA fora do horário'} · hoje ${today}`};
}
