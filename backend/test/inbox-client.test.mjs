import test from 'node:test';
import assert from 'node:assert/strict';
import {makeInboxClient} from '../src/chatwoot-inbox.mjs';
const records=[];
const sample={
 '/inboxes':{payload:[{id:11},{id:22}]},
 '/conversations?status=all&assignee_type=all&inbox_id=11&page=1':{data:{payload:[{id:111,inbox_id:11,meta:{sender:{name:'Cliente A'}},unread_count:1},{id:222,inbox_id:22,meta:{sender:{name:'Cliente externo'}}}]}},
 '/conversations/111':{id:111,inbox_id:11},
 '/conversations/222':{id:222,inbox_id:22},
 '/conversations/111/messages':{payload:[{id:1,message_type:'incoming',content:'boa noite',private:false},{id:2,message_type:'outgoing',content:'nota da equipe',private:true},{id:3,message_type:'outgoing',content:'olá',private:false}]}
};
async function fake(url,options){const u=new URL(url),p=u.pathname.replace(/^\/api\/v1\/accounts\/9/,'')+u.search;records.push({path:p,options});if(p==='/conversations/111/messages'&&options.method==='POST')return{ok:true,json:async()=>({id:55})};if(sample[p])return{ok:true,json:async()=>sample[p]};return{ok:false,status:404,json:async()=>({})};}
function connected(){records.length=0;return makeInboxClient({baseUrl:'https://chatwoot.example',apiToken:'test-server-only',accountId:9,allowedInboxIds:[11,22],fetchImpl:fake});}
test('inboxes só ficam configurados com credenciais do servidor',async()=>{assert.equal(makeInboxClient({}).configured,false);assert.equal(connected().configured,true);});
test('valida existência das duas caixas de entrada',async()=>{assert.deepEqual(await connected().verifyChannelIds(),[{id:11,found:true},{id:22,found:true}]);});
test('lista isolada por número, sem contato de outra caixa',async()=>{const c=await connected().conversations(11);assert.deepEqual(c.map(x=>x.id),[111]);assert.equal(c[0].name,'Cliente A');});
test('não permite abrir conversa do segundo número pelo primeiro',async()=>{const c=connected();await assert.rejects(c.conversation(11,222),{status:403});await assert.rejects(c.messages(11,222),{status:403});await assert.rejects(c.reply(11,222,'olá'),{status:403});});
test('nunca aceita ID de inbox adulterado na URL',async()=>{await assert.rejects(connected().conversations('11&inbox_id=22'),{status:403});});
test('esconde notas privadas das conversas e identifica entrada/saída',async()=>{const m=await connected().messages(11,111);assert.deepEqual(m.map(x=>x.content),['boa noite','olá']);assert.deepEqual(m.map(x=>x.type),['incoming','outgoing']);});
test('não envia mensagens vazias, longas ou sem autenticação de inbox',async()=>{const c=connected();await assert.rejects(c.reply(11,111,' '),{status:422});await assert.rejects(c.reply(11,111,'X'.repeat(2001)),{status:422});await assert.rejects(c.reply(9,111,'oi'),{status:403});});
test('resposta manual usa endpoint autorizado, nunca envia token ao cliente',async()=>{const c=connected();assert.equal((await c.reply(11,111,'Boa noite!')).id,55);const call=records.find(x=>x.options.method==='POST');assert.equal(call.path,'/conversations/111/messages');assert.equal(call.options.headers.api_access_token,'test-server-only');assert.deepEqual(JSON.parse(call.options.body),{content:'Boa noite!',message_type:'outgoing',private:false});});
