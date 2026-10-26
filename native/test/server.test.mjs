import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createNativeServer} from '../src/server.mjs';
const env={ADMIN_PASSWORD:'secure-test-password-123',APP_SECRET:'this-is-only-for-testing-very-long-32',META_APP_SECRET:'META_SECRET_TEST',META_VERIFY_TOKEN:'VERIFY_TOKEN_TEST',META_PHONE_ID_1:'12345678',META_PHONE_ID_2:'87654321',META_TOKEN_1:'TEST_TOKEN_NUMBER_1',META_TOKEN_2:'TEST_TOKEN_NUMBER_2',META_GRAPH_VERSION:'v25.0',NODE_ENV:'test'};
const phone=(phoneId,from,id='wamid.incoming.1',text='Boa noite')=>({object:'whatsapp_business_account',entry:[{id:'333',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:phoneId},contacts:[{wa_id:from,profile:{name:'Cliente Teste'}}],messages:[{id,from,type:'text',text:{body:text},timestamp:'1793052000'}]}}]}]});
const sig=b=>'sha256='+crypto.createHmac('sha256',env.META_APP_SECRET).update(b).digest('hex');
const mockGraph=async(url,opt)=>{
 const id=url.includes('/12345678')?'12345678':'87654321';
 if(url.includes('phone_numbers'))return {ok:true,text:async()=>JSON.stringify({data:[{id:'12345678'},{id:'87654321'}]})};
 if(url.includes('/messages'))return {ok:true,text:async()=>JSON.stringify({messages:[{id:`wamid.out.${id}`}]})};
 return {ok:true,text:async()=>JSON.stringify({id,display_phone_number:'+55 41 99999-0000',verified_name:'Guto Express'})};
};
async function fixture(t,fetchImpl=mockGraph){const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'native-guto-'));const app=createNativeServer({env,dataFile:path.join(tmp,'state.json'),fetchImpl});const addr=await app.start(0);const origin=`http://127.0.0.1:${addr.port}`;t.after(async()=>{await app.stop();fs.rmSync(tmp,{recursive:true,force:true});});
 const request=(url,opts={})=>fetch(origin+url,{...opts,redirect:'manual'});
 const login=async()=>{const response=await request('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:env.ADMIN_PASSWORD})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
 return {app,request,login,origin};}
async function hook(request,data,sign=true){const bytes=JSON.stringify(data);return request('/webhooks/meta',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':sign?sig(bytes):'sha256='+ '00'.repeat(32)},body:bytes});}
test('webhook: challenge GET token correto e token errado',async t=>{const {request}=await fixture(t);const r=await request('/webhooks/meta?hub.mode=subscribe&hub.verify_token=VERIFY_TOKEN_TEST&hub.challenge=123456');assert.equal(r.status,200);assert.equal(await r.text(),'123456');const bad=await request('/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123456');assert.equal(bad.status,403);});
test('webhook: assinatura inválida é rejeitada sem salvar mensagens',async t=>{const {request,app}=await fixture(t);const r=await hook(request,phone('12345678','5541999999999'),false);assert.equal(r.status,401);assert.equal(Object.keys(app.store.snapshot().threads).length,0);});
test('webhook: os dois números isolam histórico, deduplicam mensagens e não acionam IA',async t=>{const {request,app}=await fixture(t);let r=await hook(request,phone('12345678','5541999999999'));assert.equal(r.status,200);r=await hook(request,phone('12345678','5541999999999'));assert.equal((await r.json()).accepted,0);r=await hook(request,phone('87654321','5541999999999','wamid.incoming.2','Outro pedido'));assert.equal((await r.json()).accepted,1);const d=app.store.snapshot();assert.deepEqual(Object.keys(d.threads).sort(),['1:5541999999999','2:5541999999999']);assert.equal(d.threads['1:5541999999999'].messages.length,1);assert.equal(d.threads['2:5541999999999'].messages[0].text,'Outro pedido');assert.equal(Object.keys(d.outbox).length,0);});
test('webhook: número desconhecido é ignorado',async t=>{const {request,app}=await fixture(t);const r=await hook(request,phone('55555555','5541999999999'));assert.equal((await r.json()).accepted,0);assert.equal(Object.keys(app.store.snapshot().threads).length,0);});
test('painel: exige autenticação, login e impede resposta sem validar canal',async t=>{const {request,login}=await fixture(t);assert.equal((await request('/api/conversations')).status,401);assert.equal((await request('/api/login',{method:'POST',body:JSON.stringify({password:'wrong'})})).status,401);const cookie=await login();await hook(request,phone('12345678','5541999999999'));const conv=await request('/api/conversations',{headers:{cookie}});assert.equal((await conv.json()).items.length,1);const r=await request('/api/reply',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({id:'1:5541999999999',text:'Olá!'})});assert.equal(r.status,409);});
test('painel: resposta humana usa somente o canal correto e evento status atualiza entrega',async t=>{const {request,login,app}=await fixture(t);const cookie=await login();const header={cookie,'content-type':'application/json'};for(const slot of [1,2]){const r=await request(`/api/channels/${slot}/verify`,{method:'POST',headers:header,body:'{}'});assert.equal(r.status,200);}
 await hook(request,phone('12345678','5541999999999','wamid.in.11'));await hook(request,phone('87654321','5541888888888','wamid.in.12'));
 const r=await request('/api/reply',{method:'POST',headers:header,body:JSON.stringify({id:'2:5541888888888',text:'Oi, atendemos sim!'})});assert.equal(r.status,202);await app.pump();const out=Object.values(app.store.snapshot().outbox);assert.equal(out.length,1);assert.equal(out[0].slot,2);assert.equal(out[0].state,'sent');assert.equal(out[0].metaMessageId,'wamid.out.87654321');
 const evt={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'87654321'},statuses:[{id:out[0].metaMessageId,status:'delivered',timestamp:'123',recipient_id:'5541888888888'}]}}]}]};await hook(request,evt);assert.equal(Object.values(app.store.snapshot().outbox)[0].delivery,'delivered');
});
test('regras: nenhum BOT ativo, pedido PDV desativado e simulação sem chave não mente',async t=>{const {request,login}=await fixture(t);const cookie=await login();const hdr={cookie,'content-type':'application/json'};
 const status=await (await request('/api/status',{headers:{cookie}})).json();assert.equal(status.ready,false);assert.equal(status.integration.chatwoot,false);assert.equal(status.autoReplyEnabled,false);
 assert.equal((await request('/api/thread/mode',{method:'POST',headers:hdr,body:JSON.stringify({id:'any',mode:'BOT'})})).status,409);
 assert.equal((await request('/api/simulate',{method:'POST',headers:hdr,body:JSON.stringify({text:'Me vê uma grande'})})).status,503);
 const settings=await request('/api/settings',{headers:{cookie}});assert.equal((await settings.json()).pdv.ordersMode,'DISABLED');
});
test('segurança: alteração de origem cruzada e rota arbitrária rejeitadas',async t=>{const {request,login}=await fixture(t);const cookie=await login();const bad=await request('/api/settings',{method:'PUT',headers:{cookie,origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify({pdv:{enabled:true,baseUrl:'https://evil.example',ordersMode:'DISABLED'}})});assert.equal(bad.status,403);const wrong=await request('/api/settings',{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({pdv:{enabled:true,baseUrl:'https://evil.example',ordersMode:'DISABLED'}})});assert.equal(wrong.status,422);});
test('estático: painel tem módulos separados, resposta HTML e CSS',async t=>{const {request}=await fixture(t);for(const p of ['/','/app.js','/app.css']){const r=await request(p);assert.equal(r.status,200);const txt=await r.text();assert.ok(txt.length>500);}const html=await (await request('/')).text();assert.match(html,/Central de Atendimento Própria/);assert.match(html,/screen-settings/);assert.match(html,/screen-testing/);});
test('dados: painel nunca expõe tokens Meta e mantém configurações persistentes',async t=>{
 const {request,login,app}=await fixture(t);const cookie=await login();const hdr={cookie,'content-type':'application/json'};
 const cfg=await request('/api/settings',{headers:{cookie}});const txt=await cfg.text();assert.equal(txt.includes('TEST_TOKEN_NUMBER_1'),false);assert.equal(txt.includes(env.META_APP_SECRET),false);
 const payload={pdv:{enabled:true,baseUrl:'https://pdvgutoexpress.com.br',ordersMode:'DISABLED'}};
 const saved=await request('/api/settings',{method:'PUT',headers:hdr,body:JSON.stringify(payload)});assert.equal(saved.status,200);assert.equal(app.store.snapshot().settings.pdv.enabled,true);assert.equal(app.store.snapshot().settings.approvedForProduction,false);
 const malicious=await request('/api/settings',{method:'PUT',headers:hdr,body:JSON.stringify({pdv:{enabled:true,baseUrl:'https://pdvgutoexpress.com.br@evil.example',ordersMode:'DISABLED'}})});assert.equal(malicious.status,422);
});
test('segurança: a janela de envio de 24h é individual por cliente, não por número',async t=>{
 const {request,login,app}=await fixture(t);const cookie=await login();const hdr={cookie,'content-type':'application/json'};
 await request('/api/channels/1/verify',{method:'POST',headers:hdr,body:'{}'});
 await hook(request,phone('12345678','5541999999999','wamid.first'));await hook(request,phone('12345678','5541888888888','wamid.second'));
 await app.store.change(d=>{d.threads['1:5541999999999'].lastInboundAt='2020-01-01T00:00:00Z';});
 const b=await request('/api/reply',{method:'POST',headers:hdr,body:JSON.stringify({id:'1:5541999999999',text:'mensagem antiga'})});assert.equal(b.status,409);
 const g=await request('/api/reply',{method:'POST',headers:hdr,body:JSON.stringify({id:'1:5541888888888',text:'mensagem atual'})});assert.equal(g.status,202);
});
test('conexão manual: verifica correspondência WABA e criptografa token sem expor senha',async t=>{
 const {request,login,app}=await fixture(t);const cookie=await login();const hdr={cookie,'content-type':'application/json'};
 const token='EAA_authorized_long_test_token_value_x012345';
 const r=await request('/api/channels/1/configure',{method:'POST',headers:hdr,body:JSON.stringify({phoneId:'12345678',wabaId:'99999999',token})});assert.equal(r.status,200);
 const c=app.store.snapshot().channels[0];assert.ok(c.tokenEncrypted);assert.equal(c.tokenEncrypted.includes(token),false);
 const st=await request('/api/status',{headers:{cookie}});const s=JSON.stringify(await st.json());assert.equal(s.includes(token),false);assert.equal(s.includes(c.tokenEncrypted),false);
});
