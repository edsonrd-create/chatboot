import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initialState,JsonStore} from '../src/storage.mjs';
import {STATES,channelConfig,setChannelConfig,stateOf,listThreads,transition,operationalOverview} from '../src/operations.mjs';

const fixed=()=>Date.parse('2026-10-28T01:00:00Z');
function sample(){
 const d=initialState();
 d.threads={
  '1:554199990001':{id:'1:554199990001',slot:1,customer:'554199990001',customerName:'Cliente Ana',mode:'HUMAN',updatedAt:'2026-10-28T00:10:00Z',unread:2,messages:[{text:'Duas grandes'}]},
  '1:554199990002':{id:'1:554199990002',slot:1,customer:'554199990002',customerName:'Bruno',mode:'HUMAN',updatedAt:'2026-10-28T00:11:00Z',unread:0,messages:[{text:'Obrigado'}]},
  '2:554199990001':{id:'2:554199990001',slot:2,customer:'554199990001',customerName:'Cliente Ana',mode:'HUMAN',updatedAt:'2026-10-28T00:12:00Z',unread:1,messages:[{text:'Pizza doce'}]}
 };return d;
}
test('Estados são explícitos, sem ativar IA por padrão',()=>{
 const d=sample();
 assert.deepEqual(STATES,['HUMAN','WAITING','CLOSED','FAILED']);
 assert.equal(stateOf(d.threads['1:554199990001']),'HUMAN');
 assert.equal(operationalOverview(d).release.production,false);
 assert.equal(operationalOverview(d).release.autoReplyEnabled,false);
});
test('Mesmo telefone em números diferentes não mistura dados',()=>{
 const d=sample();
 assert.equal(listThreads(d,{slot:1}).length,2);
 assert.equal(listThreads(d,{slot:2}).length,1);
 assert.equal(listThreads(d,{slot:0}).length,3);
 assert.deepEqual(operationalOverview(d).channels.map(c=>c.unread),[2,1]);
});
test('Filtros, busca e favoritos independentes',()=>{
 const d=sample();
 const a='1:554199990001',b='2:554199990001';
 transition(d,{id:a,action:'favorite',clock:fixed});
 assert.deepEqual(listThreads(d,{filter:'favorites'}).map(x=>x.id),[a]);
 assert.deepEqual(listThreads(d,{filter:'unread'}).map(x=>x.id),[b,a]);
 assert.deepEqual(listThreads(d,{slot:2,q:'DOCE'}).map(x=>x.id),[b]);
 assert.equal(listThreads(d,{slot:1,q:'DOCE'}).length,0);
});
test('Arquivo não aparece na caixa principal e pode ser restaurado',()=>{
 const d=sample(),id='1:554199990001';
 transition(d,{id,action:'archive',clock:fixed});
 assert.equal(listThreads(d,{slot:1}).length,1);
 assert.equal(listThreads(d,{filter:'archived'}).length,1);
 transition(d,{id,action:'unarchive',clock:fixed});
 assert.equal(listThreads(d,{slot:1}).length,2);
});
test('Fluxo humano, aguardando, falha, finalizado e reabertura',()=>{
 const d=sample(),id='1:554199990001';
 assert.equal(transition(d,{id,action:'wait',clock:fixed}).state,'WAITING');
 assert.equal(transition(d,{id,action:'fail',clock:fixed}).state,'FAILED');
 assert.equal(transition(d,{id,action:'takeover',clock:fixed}).state,'HUMAN');
 assert.equal(transition(d,{id,action:'close',clock:fixed}).state,'CLOSED');
 assert.throws(()=>transition(d,{id,action:'takeover'}),/Reabra/);
 assert.throws(()=>transition(d,{id,action:'wait'}),/Reabra/);
 assert.equal(transition(d,{id,action:'reopen',clock:fixed}).state,'HUMAN');
 assert.equal(d.threads[id].mode,'HUMAN');
});
test('Concorrência exige expectedVersion',()=>{
 const d=sample(),id='1:554199990001';
 const first=transition(d,{id,action:'takeover',expectedVersion:0,clock:fixed});
 assert.equal(first.version,1);
 assert.throws(()=>transition(d,{id,action:'close',expectedVersion:0}),/atualize/);
 assert.equal(d.threads[id].operationalState,'HUMAN');
 assert.equal(transition(d,{id,action:'close',expectedVersion:1,clock:fixed}).version,2);
});
test('Não aceita IDs inexistentes, ações inválidas nem canal inválido',()=>{
 const d=sample();
 assert.throws(()=>transition(d,{id:'1:foo',action:'close'}),/não encontrada/);
 assert.throws(()=>transition(d,{id:'1:554199990001',action:'BOT'}),/desconhecida/);
 assert.throws(()=>listThreads(d,{slot:3}),/inválido/);
 assert.throws(()=>listThreads(d,{filter:'all;drop'}),/inválido/);
 assert.throws(()=>setChannelConfig(d,3,{model:'gemini-2.5-flash'}),/inválido/);
});
test('Configurações Gemini individuais e apenas como intenção de ativação',()=>{
 const d=sample();
 const one=setChannelConfig(d,1,{provider:'gemini',model:'gemini-2.5-flash',instructions:'Respostas curtas',requestedEnabled:true,hours:{start:'15:00',end:'23:45'}},{clock:fixed});
 assert.equal(one.enabled,false);
 assert.equal(one.requestedEnabled,true);
 assert.equal(d.settings.autoReply,false);
 assert.equal(d.settings.approvedForProduction,false);
 assert.equal(channelConfig(d,2).instructions,'');
 assert.equal(channelConfig(d,2).requestedEnabled,false);
 assert.equal(channelConfig(d,1).instructions,'Respostas curtas');
});
test('Entradas inválidas não podem gravar modelo indevido nem segredos',()=>{
 const d=sample();
 for(const bad of [
  {provider:'openai'},
  {model:'gpt-4.1-mini'},
  {model:'gemini-2.5-flash',apiKey:'EXPOSED'},
  {instructions:'x'.repeat(4001)},
  {hours:{start:'25:00',end:'23:45'}},
  {requestedEnabled:'yes'}
 ])assert.throws(()=>setChannelConfig(d,1,bad),/inválid|autoriza|Gemini|Instruções|Horários|Ativação/);
 assert.equal(d.auditLog,undefined);
});
test('Auditoria não armazena telefone, mensagem, token ou nome do cliente',()=>{
 const d=sample(),id='1:554199990001';
 transition(d,{id,action:'takeover',clock:fixed});
 assert.equal(d.auditLog.length,1);
 const serialized=JSON.stringify(d.auditLog);
 assert.ok(!serialized.includes('554199990001'));
 assert.ok(!serialized.includes('Cliente Ana'));
 assert.equal(d.auditLog[0].slot,1);
});
test('Persiste estados e configurações no arquivo JSON sem migrar ou apagar dados antigos',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guto-ops-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 const file=path.join(dir,'state.json');
 const store=new JsonStore(file).init();
 await store.change(d=>{Object.assign(d,sample());transition(d,{id:'1:554199990001',action:'wait',clock:fixed});setChannelConfig(d,2,{personality:'Objetiva e acolhedora'},{clock:fixed});});
 const restored=new JsonStore(file).init();
 assert.equal(stateOf(restored.snapshot().threads['1:554199990001']),'WAITING');
 assert.equal(channelConfig(restored.snapshot(),2).personality,'Objetiva e acolhedora');
 assert.equal(restored.snapshot().threads['1:554199990002'].customerName,'Bruno');
});
test('Auditoria mantém no máximo 500 registros e nenhuma transição liga produção',()=>{
 const d=sample();for(let i=0;i<520;i++)transition(d,{id:'1:554199990001',action:i%2?'reopen':'close',clock:fixed});
 assert.equal(d.auditLog.length,500);
 assert.equal(d.settings.autoReply,false);
 assert.equal(d.settings.approvedForProduction,false);
});
