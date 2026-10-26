'use strict';
const $=id=>document.getElementById(id);
async function api(url,options={}){
 const response=await fetch(url,{credentials:'same-origin',headers:{'content-type':'application/json'},...options});
 let data;try{data=await response.json();}catch{throw Error('Resposta inválida do servidor');}
 if(!response.ok)throw new Error(data.error||'Erro HTTP '+response.status);return data;
}
function toast(text,error=false){const el=$('message');el.textContent=text;el.hidden=false;el.style.background=error?'#9e2f2c':'#1b2a40';setTimeout(()=>el.hidden=true,4500);}
function checklistRow(row){const div=document.createElement('div');div.className='check';const icon=document.createElement('span');icon.className='indicator'+(row.ok?' ok':'');icon.textContent=row.ok?'✓':'!';const text=document.createElement('div');const title=document.createElement('strong');title.textContent=row.label;const detail=document.createElement('small');detail.textContent=row.details;text.append(title,detail);div.append(icon,text);return div;}
async function refresh(){
 const d=await api('/api/settings');$('pdvUrl').value=d.pdv.baseUrl;$('pdvEnabled').checked=d.pdv.enabled;
 $('aiStatus').textContent=d.ai.configured?'Chave configurada · falta homologação':'Não configurada';
 for(let i=0;i<2;i++)$('wa'+(i+1)).textContent=d.whatsapp.inboxes[i]?.configured?'Credenciais presentes · não verificado':'Não conectado';
 $('checklist').replaceChildren(...d.readiness.checklist.map(checklistRow));
 $('productionStatus').textContent=d.readiness.ready?'HOMOLOGADO':'NÃO LIBERADO';
 $('pdvResult').className='result';
 $('pdvResult').textContent=d.pdvTest?.ok?'Último teste: '+d.pdvTest.at+' · '+d.pdvTest.items+' itens consultados. Somente leitura.':'Leitura do PDV ainda não verificada.';
}
$('pdvForm').addEventListener('submit',async event=>{
 event.preventDefault();const button=$('save');button.disabled=true;
 try{await api('/api/settings',{method:'PUT',body:JSON.stringify({pdv:{baseUrl:$('pdvUrl').value.trim(),enabled:$('pdvEnabled').checked,ordersMode:'DISABLED'}})});toast('Configuração salva no servidor. Pedidos automáticos permanecem bloqueados.');await refresh();}
 catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
$('test').addEventListener('click',async()=>{
 const button=$('test');button.disabled=true;$('pdvResult').textContent='Consultando PDV…';
 try{const data=await api('/api/pdv/test',{method:'POST'});$('pdvResult').className='result success';$('pdvResult').textContent='PDV respondeu: '+data.items+' itens; loja '+(data.storeOpen?'aberta':'fechada')+'. Leitura validada em '+data.at+'. Pedidos ainda bloqueados.';toast('Consulta de leitura concluída.');}
 catch(error){$('pdvResult').className='result error';$('pdvResult').textContent=error.message;toast('Teste PDV não aprovado.',true);}finally{button.disabled=false;}
});
refresh().catch(error=>{$('pdvResult').className='result error';$('pdvResult').textContent=error.message+' — faça login pelo painel administrativo.';});