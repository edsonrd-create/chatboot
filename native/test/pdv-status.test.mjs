import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPdvStatus} from '../src/pdv-status.mjs';

for(const [code,mode,reason] of [
 [401,null,'TOKEN_REJECTED'],
 [403,null,'PDV_DISABLED'],
 [404,null,'ROUTE_NOT_FOUND'],
 [500,null,'HTTP_ERROR'],
 [200,'invalid','INVALID_PDV_MODE'],
]){
 test('PDV status '+code+' ('+String(mode)+') => '+reason,()=>{
   const result=classifyPdvStatus(code,mode);
   assert.equal(result.ok,false);
   assert.equal(result.reason,reason);
   assert.equal(result.mode,null);
 });
}
for(const mode of ['off','test','active']){
 test('PDV autenticado informa modo real '+mode,()=>{
   assert.deepEqual(classifyPdvStatus(200,mode),{ok:true,reason:'OK',mode});
 });
}
