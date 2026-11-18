// SAIR deve funcionar mesmo quando a IA está desligada, fora de horário ou em atendimento humano.
const norm=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[.!?,;:]+$/,'').replace(/\s+/g,' ');
export function isMarketingOptOut(text){
 const t=norm(text);
 return /^(sair|parar|pare|cancelar propaganda|cancelar promocoes|nao quero mais propaganda|nao quero mais promocoes|nao quero receber ofertas|descadastrar|remover meu numero|stop)$/.test(t);
}
export function optOutMessage(ok){
 return ok?
  '✅ Sua opção foi registrada. Você não receberá mais promoções nem mensagens de aniversário da Guto Express. Se precisar fazer um pedido, pode continuar falando normalmente por aqui.':
  'Recebi seu pedido para parar mensagens promocionais. Não consegui confirmar a atualização no cadastro agora; encaminhei para a equipe verificar. Você pode continuar pedindo normalmente.';
}
