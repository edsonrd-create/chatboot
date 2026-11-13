import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {sendMetaMenuMedia} from '../src/meta.mjs';

const fakeFetch=(calls)=>async (url,init)=>{
  calls.push({url:String(url),init});
  return new Response(JSON.stringify(calls.length===1?{id:'media-test-001'}:{messages:[{id:'wamid-test-001'}]}),{
    status:200,headers:{'content-type':'application/json'}
  });
};

describe('Meta Cloud: anexos de cardápio PNG/PDF',()=>{
  it('faz upload multipart e envia documento PDF com media_id',async()=>{
    const calls=[];
    const result=await sendMetaMenuMedia({
      phoneId:'1234567890',to:'5541999999999',buffer:Buffer.from('%PDF-1.7\nconteudo'),
      mimeType:'application/pdf',fileName:'cardapio.pdf',caption:'Cardápio aprovado',
      token:'token-test',version:'v25.0',fetchImpl:fakeFetch(calls),
    });
    assert.equal(result.id,'wamid-test-001');
    assert.equal(result.mediaId,'media-test-001');
    assert.equal(calls.length,2);
    assert.match(calls[0].url,/\/media$/);
    assert.equal(calls[0].init.body.get('type'),'application/pdf');
    assert.equal(calls[0].init.body.get('file').type,'application/pdf');
    const sent=JSON.parse(calls[1].init.body);
    assert.equal(sent.type,'document');
    assert.equal(sent.document.id,'media-test-001');
    assert.equal(sent.document.filename,'cardapio.pdf');
    assert.equal(sent.to,'5541999999999');
  });
  it('envia imagem PNG pelo ID de mídia',async()=>{
    const calls=[];
    const result=await sendMetaMenuMedia({
      phoneId:'1234567890',to:'5541999999999',
      buffer:Buffer.from([137,80,78,71,13,10,26,10,0,0]),
      mimeType:'image/png',fileName:'pizza.png',caption:'Veja nossa pizza',
      token:'token-test',fetchImpl:fakeFetch(calls),
    });
    assert.equal(result.type,'image');
    const sent=JSON.parse(calls[1].init.body);
    assert.equal(sent.image.id,'media-test-001');
    assert.equal(sent.image.caption,'Veja nossa pizza');
  });
  it('rejeita arquivo de formato incorreto antes de chamar a Meta',async()=>{
    const calls=[];
    await assert.rejects(sendMetaMenuMedia({
      phoneId:'1234567890',to:'5541999999999',buffer:Buffer.from('%PDF-1.7'),
      mimeType:'image/png',fileName:'falso.png',token:'token-test',fetchImpl:fakeFetch(calls)
    }),/Assinatura/);
    assert.equal(calls.length,0);
  });
});
