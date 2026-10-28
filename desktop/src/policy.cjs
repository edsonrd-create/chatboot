'use strict';

const WHATSAPP_ORIGIN = 'https://web.whatsapp.com';
const SLOTS = Object.freeze([1, 2]);
const PARTITIONS = Object.freeze({1: 'persist:guto-express-whatsapp-01', 2: 'persist:guto-express-whatsapp-02'});

function validSlot(value) {
  return Number.isInteger(value) && SLOTS.includes(value);
}

function isWhatsAppUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === WHATSAPP_ORIGIN && (url.protocol === 'https:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

function normalizeBounds(raw, viewport) {
  if (!raw || !viewport) return null;
  const fields = ['x', 'y', 'width', 'height'];
  if (![...fields.map(k => raw[k]), viewport.width, viewport.height].every(n => typeof n === 'number' && Number.isFinite(n))) return null;
  const x = Math.max(0, Math.min(Math.round(raw.x), Math.max(0, Math.round(viewport.width) - 300)));
  const y = Math.max(64, Math.min(Math.round(raw.y), Math.max(64, Math.round(viewport.height) - 260)));
  const width = Math.min(Math.round(raw.width), Math.round(viewport.width) - x);
  const height = Math.min(Math.round(raw.height), Math.round(viewport.height) - y);
  if (width < 300 || height < 260) return null;
  return {x, y, width, height};
}

function safeDraftText(value) {
  if (typeof value !== 'string') throw new TypeError('O resumo deve ser texto');
  const content = value.trim();
  if (!content || content.length > 9000) throw new RangeError('Resumo vazio ou muito extenso');
  return content;
}

module.exports = {WHATSAPP_ORIGIN, SLOTS, PARTITIONS, validSlot, isWhatsAppUrl, normalizeBounds, safeDraftText};
