// Um LID do WhatsApp é um ID de roteamento, NÃO é necessariamente telefone.
// Não deduzir nem cortar dígitos de LIDs para formar contato do pedido.
export const validCustomerPhone = value => /^\d{10,13}$/.test(String(value || '').replace(/\D/g, ''));

export function phoneFromWaKey(key = {}) {
  const primary = String(key.remoteJid || '');
  const alt = String(key.remoteJidAlt || '');
  const pn = primary.endsWith('@s.whatsapp.net') ? primary : alt.endsWith('@s.whatsapp.net') ? alt : '';
  const digits = pn.split('@')[0].replace(/\D/g, '');
  return validCustomerPhone(digits) ? digits : '';
}

export function parseCustomerPhoneAnswer(text) {
  // Resposta direta do cliente: não extrair números de endereço, preço ou pedido.
  const raw = String(text || '').trim();
  if (!/^[+\d\s().-]+$/.test(raw)) return '';
  const digits = raw.replace(/\D/g, '');
  return validCustomerPhone(digits) ? digits : '';
}
