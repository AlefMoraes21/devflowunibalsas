import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../api/cloud-store.js';
process.env.FLOW_PRIVATE_KEY='unit';process.env.FLOW_PROJECT_ID='unit-project';
test('Firestore create-only, leitura criptografada e updateTime protegem o worker',async()=>{
 let stored,version='v1';
 const store=createStore({request:async(url,options={})=>{
  if(options.method==='POST'){if(stored)return {status:409,json:{}};stored=options.body;assert.ok(!JSON.stringify(stored).includes('unit-candidate'));return {status:200,json:{...stored,updateTime:version}}}
  if(options.method==='PATCH'){
   if(!url.includes('updateTime='+version))return {status:412,json:{}};
   stored=options.body;version='v2';return {status:200,json:{...stored,updateTime:version}};
  }
  return stored?{status:200,json:{...stored,updateTime:version}}:{status:404,json:{}};
 }});
 const record={request:{token:'unit-candidate'},expires:Date.now()+10000};
 assert.equal(await store.create('unit',record),true);assert.equal(await store.create('unit',record),false);
 const found=await store.get('unit');assert.deepEqual(found.record,record);assert.equal(found.version,'v1');
 assert.equal(await store.update('unit',{...record,state:'running'},'v1'),true);assert.equal(await store.update('unit',record,'v1'),false);
});
