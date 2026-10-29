'use strict';
// Central no estilo WhatsApp Web: usa somente a API autenticada do próprio servidor.
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const st = {slot: 0, filter: 'all', q: '', list: [], sel: null, thread: null, messages: [], view: 'chats', revision: null, qr: null, seenUnread: null, autoReply: false};

async function api(url, opt = {}) {
  const r = await fetch(url, {credentials: 'same-origin', ...opt, headers: {'content-type': 'application/json', ...(opt.headers || {})}});
  let data = {}; try { data = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), {status: r.status});
  return data;
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3500); }

const COLORS = ['#25a366', '#e17055', '#0984e3', '#a55eea', '#fd9644', '#20bf6b', '#eb3b5a', '#4b7bec', '#8854d0', '#0fb9b1'];
// Foto de perfil real do WhatsApp (quando o contato permite); senão, iniciais coloridas como no WhatsApp Web.
function photo(node, t) {
  avatar(node, t.customerName || t.customer, t.id);
  if (t.via !== 'qr') return;
  const img = new Image(); img.alt = ''; img.decoding = 'async';
  img.onload = () => { node.textContent = ''; node.style.background = 'none'; node.append(img); };
  img.src = '/api/avatar?id=' + encodeURIComponent(t.id);
}
function avatar(node, name, id) {
  const clean = String(name || '').replace(/[^\p{L}\p{N} ]/gu, '').trim();
  const letters = clean.split(/\s+/).filter(w => /^\p{L}/u.test(w)).slice(0, 2).map(w => w[0]).join('');
  node.textContent = letters ? letters.toUpperCase() : '👤';
  let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  node.style.background = COLORS[h % COLORS.length];
}
const fmtPhone = n => { const d = String(n || '').replace(/\D/g, ''); return d.length >= 12 && d.startsWith('55') ? `+55 ${d.slice(2, 4)} ${d.slice(4, -4)}-${d.slice(-4)}` : (d ? '+' + d : ''); };
const sameDay = (a, b) => a.toDateString() === b.toDateString();
function listTime(iso) {
  if (!iso) return ''; const d = new Date(iso), now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit', year: '2-digit'});
}
function dayLabel(d) {
  const now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return 'HOJE'; if (sameDay(d, y)) return 'ONTEM';
  return d.toLocaleDateString('pt-BR', {day: '2-digit', month: 'long', year: 'numeric'}).toUpperCase();
}

// ---------- Lista de conversas ----------
async function loadList() {
  const r = await api('/api/conversations'); st.list = r.items || [];
  renderList(); notifyNew();
  if (st.sel) await loadThread(st.sel, false);
}
function renderList() {
  const list = $('list'); list.replaceChildren();
  const q = st.q.toLowerCase();
  const items = st.list.filter(t => (!st.slot || t.slot === st.slot) && !t.archived
    && (st.filter !== 'unread' || t.unread) && (st.filter !== 'bot' || t.mode === 'BOT') && (st.filter !== 'human' || t.mode !== 'BOT')
    && (!q || `${t.customerName} ${t.customer} ${t.lastText}`.toLowerCase().includes(q)));
  for (const t of items) {
    const row = el('button', 'row' + (t.id === st.sel ? ' sel' : '') + (t.unread ? ' unread' : '')); row.type = 'button';
    const av = el('div', 'avatar'); photo(av, t);
    const meta = el('div', 'meta'), top = el('div', 'top'), bot = el('div', 'bot');
    top.append(el('span', 'name', t.customerName && t.customerName !== t.customer ? t.customerName : fmtPhone(t.customer)), el('span', 'time', listTime(t.updatedAt)));
    const tags = el('span', 'tags');
    if (!st.slot) tags.append(el('span', 'tag s', '0' + t.slot));
    tags.append(el('span', 'tag' + (t.mode === 'BOT' ? '' : ' h'), t.mode === 'BOT' ? 'IA' : 'ATEND.'));
    if (t.unread) tags.append(el('span', 'count', String(t.unread)));
    const last = el('span', 'last' + (t.typing ? ' typing' : ''));
    if (t.typing) last.textContent = t.typing === 'recording' ? 'gravando áudio…' : 'digitando…';
    else { if (t.lastDirection === 'outgoing') last.append(ticks(t.lastDelivery)); last.append(document.createTextNode(t.lastText || '')); }
    bot.append(last, tags);
    meta.append(top, bot); row.append(av, meta);
    row.onclick = () => openThread(t.id);
    list.append(row);
  }
  if (!items.length) list.append(el('div', 'empty', st.list.length ? 'Nenhuma conversa neste filtro.' : 'Nenhuma conversa ainda. Conecte o WhatsApp e as mensagens aparecem aqui.'));
  const total = st.list.reduce((n, t) => n + (t.unread || 0), 0);
  $('rail-unread').hidden = !total; $('rail-unread').textContent = total > 99 ? '99+' : String(total);
  document.title = (total ? `(${total}) ` : '') + 'WhatsApp · Auto Atendimento Express';
}

function ticks(delivery) {
  const span = el('span', 'ck' + (delivery === 'read' ? ' read' : ''));
  span.textContent = delivery === 'failed' ? '⚠' : delivery === 'queued' ? '🕓' : (delivery === 'delivered' || delivery === 'read') ? '✓✓' : '✓';
  span.title = {read: 'Lida', delivered: 'Entregue', sent: 'Enviada', failed: 'Falhou', queued: 'Na fila'}[delivery] || 'Enviada';
  return span;
}

// ---------- Conversa ----------
async function openThread(id) {
  st.sel = id; setView('chats'); $('app').classList.add('open');
  await loadThread(id, true); renderList();
  api('/api/thread/read', {method: 'POST', body: JSON.stringify({id})}).then(() => { const t = st.list.find(x => x.id === id); if (t) { t.unread = 0; renderList(); } }).catch(() => {});
}
async function loadThread(id, scroll) {
  let r; try { r = await api('/api/thread?id=' + encodeURIComponent(id)); } catch { return; }
  if (st.sel !== id) return;
  const box = $('messages'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  st.thread = r.thread; st.messages = r.messages || [];
  $('intro').hidden = true; $('qr').hidden = true; $('chat').hidden = false;
  const t = st.thread;
  if (st.avatarFor !== t.id) { photo($('chat-avatar'), t); st.avatarFor = t.id; }
  $('chat-name').textContent = t.customerName && t.customerName !== t.customer ? t.customerName : fmtPhone(t.customer);
  $('chat-sub').textContent = t.typing ? (t.typing === 'recording' ? 'gravando áudio…' : 'digitando…') : `${fmtPhone(t.customer)} · WhatsApp 0${t.slot}`;
  $('chat-sub').classList.toggle('typing', Boolean(t.typing));
  const bot = t.mode === 'BOT';
  $('chat-mode').textContent = bot ? '🤖 IA atendendo' : '👤 Atendente';
  $('chat-mode').className = 'mode' + (bot ? '' : ' h');
  $('toggle-mode').textContent = bot ? 'Assumir conversa' : 'Devolver à IA';
  renderMessages();
  if (scroll || atBottom) { box.scrollTop = box.scrollHeight; box.querySelectorAll('img,video').forEach(m => m.addEventListener('load', () => { box.scrollTop = box.scrollHeight; }, {once: true})); }
}
function renderMessages() {
  const box = $('messages'); box.replaceChildren();
  let lastDay = '', lastDir = '';
  for (const m of st.messages) {
    const d = new Date(m.at);
    const day = dayLabel(d);
    if (day !== lastDay) { box.append(el('div', 'day', day)); lastDay = day; lastDir = ''; }
    const out = m.direction === 'outgoing';
    const b = el('div', 'bubble ' + (out ? 'out' : 'in') + (lastDir !== m.direction ? ' first' : ''));
    if (out && m.source) { const human = /Atendente|Celular/.test(m.source); b.append(el('span', 'src' + (human ? ' h' : ''), /IA/.test(m.source) ? '🤖 ' + m.source : m.source)); }
    const src = m.media ? '/api/media?f=' + encodeURIComponent(m.media) : '';
    let caption = m.text || '';
    if (src && (m.type === 'image' || m.type === 'sticker')) {
      const img = el('img', m.type === 'sticker' ? 'sticker' : 'photo'); img.src = src; img.alt = m.type === 'sticker' ? 'Figurinha' : 'Foto'; img.loading = 'lazy';
      img.onclick = () => window.open(src, '_blank', 'noopener');
      b.append(img); b.classList.toggle('media', true);
      caption = m.type === 'sticker' ? '' : caption.replace(/^📷 ?(Foto)?/, '').trim();
    } else if (src && m.type === 'video') {
      const v = el('video', 'photo'); v.src = src; v.controls = true; v.preload = 'metadata'; b.append(v); b.classList.add('media');
      caption = caption.replace(/^🎥 ?(Vídeo)?/, '').trim();
    } else if (src && m.type === 'audio') {
      const a = el('audio', 'voice'); a.src = src; a.controls = true; a.preload = 'metadata'; b.append(a);
      caption = caption.replace(/^[🎤🔊] ?(Áudio)?/u, '').trim();
      if (caption) caption = (out ? '🔊 ' : '📝 ') + caption;
    }
    if (caption) b.append(el('span', 'txt', caption));
    const time = el('span', 't', d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}));
    if (out) time.append(ticks(m.delivery));
    b.append(time); box.append(b); lastDir = m.direction;
  }
}
async function send() {
  const text = $('text').value.trim(); if (!text || !st.sel) return;
  $('send').disabled = true;
  try { await api('/api/reply', {method: 'POST', body: JSON.stringify({id: st.sel, text})}); $('text').value = ''; grow(); await loadThread(st.sel, true); loadList(); }
  catch (e) { toast('Não enviou: ' + e.message); }
  finally { $('send').disabled = false; $('text').focus(); }
}
async function toggleMode() {
  if (!st.thread) return;
  const mode = st.thread.mode === 'BOT' ? 'HUMAN' : 'BOT';
  try { await api('/api/thread/mode', {method: 'POST', body: JSON.stringify({id: st.thread.id, mode})}); toast(mode === 'BOT' ? 'A IA voltou a atender esta conversa.' : 'Você assumiu a conversa. A IA não responde mais aqui.'); await loadList(); }
  catch (e) { toast(e.message); }
}
const EMOJIS = '😀 😃 😄 😁 😆 😅 😂 🙂 😉 😊 😍 😘 😋 😎 🤩 🥳 😏 😌 🤔 🙄 😴 😢 😭 😡 🙏 👍 👎 👏 🙌 💪 👌 ✌️ 🤝 ❤️ 💚 🔥 ⭐ ✅ ❌ ⏰ 🛵 🚗 🏠 📍 💳 💵 🧾 🍕 🥤 🍺 🧀 🍅 🌶️ 🍫 🎉 🎁'.split(' ');
function buildEmoji() {
  const box = $('emoji-box');
  for (const e of EMOJIS) { const b = el('button', '', e); b.type = 'button'; b.onclick = () => { const t = $('text'), i = t.selectionStart ?? t.value.length; t.value = t.value.slice(0, i) + e + t.value.slice(t.selectionEnd ?? i); t.focus(); t.selectionStart = t.selectionEnd = i + e.length; grow(); }; box.append(b); }
}
function grow() { const t = $('text'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px'; $('send').classList.toggle('idle', !t.value.trim()); }

function highlight(q) {
  q = q.trim().toLowerCase(); let first = null;
  document.querySelectorAll('#messages .bubble').forEach(b => { const hit = q && b.textContent.toLowerCase().includes(q); b.classList.toggle('hit', Boolean(hit)); if (hit && !first) first = b; });
  first?.scrollIntoView({block: 'center'});
}

// ---------- QR ----------
async function loadQr() {
  let r; try { r = await api('/api/qr/status'); } catch { return; }
  st.qr = r; st.autoReply = r.autoReply;
  for (const s of r.slots || []) {
    $('dot-' + s.slot)?.classList.toggle('on', s.state === 'connected');
    const card = document.querySelector(`[data-qr="${s.slot}"]`); if (!card) continue;
    const state = card.querySelector('.qr-state'), box = card.querySelector('.qr-box');
    state.className = 'qr-state' + (s.state === 'connected' ? ' ok' : '');
    state.textContent = s.state === 'connected' ? `Conectado · ${fmtPhone(s.number)}` : s.state === 'qr' ? 'Aguardando leitura do QR Code…' : s.state === 'connecting' ? 'Conectando…' : (s.error || 'Desconectado');
    box.replaceChildren();
    if (s.qr) { const img = el('img'); img.src = s.qr; img.alt = 'QR Code'; box.append(img); }
    else box.append(el('span', '', s.state === 'connected' ? '✅ Conectado' : 'Clique em Gerar QR Code'));
    card.querySelector('.qr-start').hidden = s.state === 'connected';
  }
  $('qr-info').textContent = !r.enabled ? 'Conexão por QR desativada no servidor.' : r.autoReply ? `IA automática ligada${r.testNumbersOnly ? ' (somente números de teste)' : ''}${r.voice ? ' · entende e responde áudio' : ''}.` : 'IA automática desligada: as mensagens chegam aqui para o atendente responder.';
}
let qrTimer = null;
function setView(v) {
  st.view = v;
  document.querySelectorAll('.rail-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'qr') { $('intro').hidden = true; $('chat').hidden = true; $('qr').hidden = false; $('app').classList.add('open'); loadQr(); clearInterval(qrTimer); qrTimer = setInterval(loadQr, 3000); }
  else { clearInterval(qrTimer); qrTimer = setInterval(loadQr, 30000); $('qr').hidden = true; if (!st.sel) $('app').classList.remove('open'); if (!st.sel) $('intro').hidden = false; else $('chat').hidden = false; }
}

// ---------- Notificações ----------
function beep() { try { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.value = .08; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + .15); } catch {} }
function notifyNew() {
  const total = st.list.reduce((n, t) => n + (t.unread || 0), 0);
  if (st.seenUnread !== null && total > st.seenUnread) {
    beep();
    const t = st.list.find(x => x.unread);
    if (t && document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(t.customerName || fmtPhone(t.customer), {body: t.lastText || 'Nova mensagem', icon: 'logo.png', tag: t.id});
  }
  st.seenUnread = total;
}

// ---------- Tempo real ----------
function live() {
  if (typeof EventSource !== 'function') { setInterval(loadList, 5000); return; }
  const src = new EventSource('/api/operations/events');
  src.addEventListener('revision', e => { let r; try { r = JSON.parse(e.data).revision; } catch { return; } if (r !== st.revision) { st.revision = r; loadList().catch(() => {}); } });
  setInterval(() => loadList().catch(() => {}), 20000);
}

// ---------- Início ----------
function bind() {
  document.querySelectorAll('.acc').forEach(b => b.onclick = () => { st.slot = Number(b.dataset.slot); document.querySelectorAll('.acc').forEach(x => x.classList.toggle('on', x === b)); renderList(); });
  document.querySelectorAll('.chip').forEach(b => b.onclick = () => { st.filter = b.dataset.filter; document.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); renderList(); });
  $('search').oninput = e => { st.q = e.target.value; renderList(); };
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('send').onclick = send;
  $('text').addEventListener('input', grow);
  $('text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('toggle-mode').onclick = toggleMode;
  buildEmoji(); grow();
  $('emoji').onclick = e => { e.stopPropagation(); $('emoji-box').hidden = !$('emoji-box').hidden; };
  document.addEventListener('click', e => { if (!$('emoji-box').contains(e.target)) $('emoji-box').hidden = true; });
  $('chat-search-btn').onclick = () => { const i = $('chat-search'); i.hidden = !i.hidden; if (!i.hidden) i.focus(); else { i.value = ''; highlight(''); } };
  $('chat-search').oninput = e => highlight(e.target.value);
  $('back').onclick = () => { $('app').classList.remove('open'); st.sel = null; renderList(); };
  document.querySelectorAll('[data-qr]').forEach(card => {
    const slot = card.dataset.qr;
    card.querySelector('.qr-start').onclick = async () => { try { await api(`/api/qr/${slot}/start`, {method: 'POST', body: '{}'}); loadQr(); } catch (e) { toast(e.message); } };
    card.querySelector('.qr-logout').onclick = async () => { if (!confirm('Desconectar este WhatsApp da central?')) return; try { await api(`/api/qr/${slot}/logout`, {method: 'POST', body: '{}'}); loadQr(); } catch (e) { toast(e.message); } };
  });
  document.addEventListener('click', () => { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }, {once: true});
  $('login-form').onsubmit = async e => {
    e.preventDefault(); $('login-error').textContent = '';
    try { await api('/api/login', {method: 'POST', body: JSON.stringify({password: $('password').value})}); $('password').value = ''; start(); }
    catch (err) { $('login-error').textContent = err.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Senha incorreta.'; }
  };
}
async function start() {
  try { await api('/api/status'); } catch { $('login').hidden = false; $('app').hidden = true; return; }
  $('login').hidden = true; $('app').hidden = false;
  await Promise.all([loadList(), loadQr()]);
  setView('chats'); live();
}
bind(); start();
