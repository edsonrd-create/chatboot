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

// Validação pura do layout: os conteúdos remotos jamais podem invadir painel, barra ou outra sessão.
function parseDesktopLayout(value, viewport){
  if(!value||typeof value!=='object'||!['single','split'].includes(value.mode)||!validSlot(value.active)||!value.panes||typeof value.panes!=='object')return null;
  const slots=value.mode==='split'?SLOTS:[value.active];
  const panes={};
  for(const slot of slots){
    const raw=value.panes[slot];
    const rect=normalizeBounds(raw,viewport);
    if(!rect||!raw)return null;
    // Recusar limites fora da área renderizada em vez de permitir sobreposição em controles sensíveis.
    if(Math.abs(rect.x-raw.x)>3||Math.abs(rect.y-raw.y)>3||Math.abs(rect.width-raw.width)>3||Math.abs(rect.height-raw.height)>3)return null;
    panes[slot]=rect;
  }
  if(value.mode==='split'){
    const a=panes[1],b=panes[2];
    // Layout lado a lado e com separação visual mínima.
    if(a.x+a.width+4>b.x||Math.abs(a.y-b.y)>4||Math.abs(a.height-b.height)>4)return null;
  }
  return {mode:value.mode,active:value.active,panes};
}

function safeDraftText(value) {
  if (typeof value !== 'string') throw new TypeError('O resumo deve ser texto');
  const content = value.trim();
  if (!content || content.length > 9000) throw new RangeError('Resumo vazio ou muito extenso');
  return content;
}

module.exports = {WHATSAPP_ORIGIN, SLOTS, PARTITIONS, validSlot, isWhatsAppUrl, normalizeBounds, safeDraftText, parseDesktopLayout};
