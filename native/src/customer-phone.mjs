// Um LID do WhatsApp é um ID de roteamento, NÃO é necessariamente telefone.
// Não deduzir nem cortar dígitos de LIDs para formar contato do pedido.
export const validCustomerPhone = value => {
  const digits=String(value||'').replace(/\D/g,'');
  if(!/^\d{10,13}$/.test(digits))return false;
  const local=(digits.startsWith('55')&&(digits.length===12||digits.length===13))
    ? digits.slice(4) : digits.slice(2);
  // Celular brasileiro tem nove dígitos, começando por 9.
  // Se vier um celular aparente com 8 dígitos, pedir correção. Jamais acrescentar 9 por suposição.
  return !(local.startsWith('9') && local.length!==9);
};

export function phoneFromWaKey(key = {}) {
  const primary = String(key.remoteJid || '');
  const alt = String(key.remoteJidAlt || '');
  const pn = primary.endsWith('@s.whatsapp.net') ? primary : alt.endsWith('@s.whatsapp.net') ? alt : '';
  const digits = pn.split('@')[0].split(':')[0].replace(/\D/g, '');
  return validCustomerPhone(digits) ? digits : '';
}

export function parseCustomerPhoneAnswer(text) {
  // Resposta direta do cliente: não extrair números de endereço, preço ou pedido.
  const raw = String(text || '').trim();
  if (!/^[+\d\s().-]+$/.test(raw)) return '';
  const digits = raw.replace(/\D/g, '');
  return validCustomerPhone(digits) ? digits : '';
}
