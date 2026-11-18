// A API /api/v1/menu não expõe os slots, sabores elegíveis e bebidas selecionáveis do combo.
// Falha fechada: a IA não pode substituir um combo por pizzas avulsas com preço diferente.
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const comboPattern=/\b(combo|combos|promocao|promocoes|oferta familia|familia)\b/;
export function detectUnsupportedComboIntent(message,business){
 const query=normalize(message);
 if(!comboPattern.test(query))return null;
 const combos=(business?.combos||[]).filter(c=>c.available!==false);
 const exact=combos.find(c=>query.includes(normalize(c.label)));
 const family=combos.find(c=>/familia/.test(normalize(c.label)) && /familia/.test(query));
 if(exact||family)return exact||family;
 if(/\bcombo\b/.test(query)&&/\b(familia|big|gigante|super big)\b/.test(query))
  return {label:'combo solicitado',available:false};
 return null; // perguntas genéricas sobre ofertas podem seguir para atendimento informativo
}
export const comboRequiresStaff=session=>Boolean(session?.comboReview);
