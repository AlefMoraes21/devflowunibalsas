import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentLedger} from '../api/document-ledger.js';
import {createStore} from '../api/cloud-store.js';
function memory(){const map=new Map();return {map,async create(id,record,collection){assert.equal(collection,'flowDocumentOperations');if(map.has(id))return false;map.set(id,{record:structuredClone(record),version:1});return true},async get(id,collection){assert.equal(collection,'flowDocumentOperations');return structuredClone(map.get(id)??null)},async update(id,record,version,collection){assert.equal(collection,'flowDocumentOperations');const previous=map.get(id);if(previous.version!==version)return false;map.set(id,{record:structuredClone(record),version:version+1});return true}}}
const upload={cpf:'11144477735',processId:'20383',applymentId:'777',documentId:'28',mediaHash:'opaque-media-hash'};
test('document lock atomically protects concurrent claims across sessions and new media',async()=>{
 const store=memory(),ledger=createDocumentLedger({store});const claims=await Promise.all([ledger.claim(upload),ledger.claim({...upload,mediaHash:'new-upload'})]);assert.equal(claims.filter(c=>c.claimed).length,1);assert.equal(claims[0].id,claims[1].id);
 const stored=JSON.stringify([...store.map.values()]);assert.ok(!stored.includes(upload.cpf));assert.ok(!stored.includes(upload.mediaHash));assert.equal((await ledger.claim({...upload,mediaHash:'third-upload'})).claimed,false);
});
test('restart recovers received receipt without another upload',async()=>{
 const store=memory(),first=createDocumentLedger({store});const claim=await first.claim(upload);await first.transition(claim.id,'received',{receipt:{primaryKey:'receipt-1'}});
 const second=createDocumentLedger({store}),again=await second.claim({...upload,mediaHash:'another-file'});assert.equal(again.claimed,false);assert.equal(again.state,'received');assert.deepEqual(again.receipt,{primaryKey:'receipt-1'});
});
test('uncertain or expired present records require reconciliation and never grant a new claim',async()=>{
 const store=memory();let now=1000;const ledger=createDocumentLedger({store,clock:()=>now});const claim=await ledger.claim(upload);await ledger.transition(claim.id,'uncertain',{reason:'upstream_timeout'});now+=31*86400000;
 const again=await ledger.claim({...upload,mediaHash:'fresh-file'});assert.equal(again.claimed,false);assert.equal(again.expired,true);assert.equal(again.requiresReconciliation,true);await assert.rejects(ledger.transition(claim.id,'rejected'),/conferência/);
});
test('only proven rejection allows one corrected upload and clears old receipt',async()=>{
 const store=memory(),ledger=createDocumentLedger({store});const first=await ledger.claim(upload);await ledger.transition(first.id,'rejected',{reason:'prewrite_validation'});
 const claims=await Promise.all([ledger.claim({...upload,mediaHash:'corrected'}),ledger.claim({...upload,mediaHash:'another-corrected'})]);assert.equal(claims.filter(c=>c.claimed).length,1);assert.equal(store.map.get(first.id).record.attempt,2);
});
test('authoritative reconciliation can confirm receipt or allow corrected rejected upload',async()=>{
 const ledger=createDocumentLedger({store:memory()});const claim=await ledger.claim(upload);await ledger.transition(claim.id,'uncertain');await ledger.reconcile(claim.id,'received',{receipt:'authoritative-read'});assert.equal((await ledger.claim(upload)).state,'received');
 await ledger.reconcile(claim.id,'rejected',{reason:'rejected_by_team'});assert.equal((await ledger.claim({...upload,mediaHash:'corrected'})).claimed,true);
});
test('different inscription or document uses an independent operation and invalid identity is rejected',async()=>{
 const ledger=createDocumentLedger({store:memory()}),a=await ledger.claim(upload),b=await ledger.claim({...upload,applymentId:'778'}),c=await ledger.claim({...upload,documentId:'10'});assert.notEqual(a.id,b.id);assert.notEqual(a.id,c.id);await assert.rejects(ledger.claim({...upload,applymentId:''}));await assert.rejects(ledger.transition(a.id,'running'));
});
test('Firestore custom collection update retains encryption and version precondition',async()=>{
 process.env.FLOW_PRIVATE_KEY='ledger-unit-key';process.env.FLOW_PROJECT_ID='unit-project';let stored,version='v1';const urls=[];
 const store=createStore({request:async(url,options={})=>{urls.push(url);if(options.method==='POST'){stored=options.body;return {status:200,json:{...stored,updateTime:version}}}if(options.method==='PATCH'){assert.match(url,/flowDocumentOperations\/[^?]+\?currentDocument.updateTime=v1/);stored=options.body;version='v2';return {status:200,json:{...stored,updateTime:version}}}return {status:200,json:{...stored,updateTime:version}}}});
 const ledger=createDocumentLedger({store}),claim=await ledger.claim(upload);await ledger.transition(claim.id,'received',{receipt:'safe-receipt'});assert.ok(urls.every(u=>u.includes('/flowDocumentOperations')));assert.ok(!JSON.stringify(stored).includes('safe-receipt'));
});

test('new session lookup restores original uncertain document baseline without media',async()=>{
 const store=memory(),first=createDocumentLedger({store});const context={documentId:'28',name:'original.pdf',previousPath:'/before.pdf',previousFilesDigest:'before-files-digest'};
 const claim=await first.claim({...upload,context});await first.transition(claim.id,'uncertain',{reason:'timeout'});
 const second=createDocumentLedger({store}),{mediaHash,...identity}=upload;const found=await second.lookup(identity);assert.equal(found.id,claim.id);assert.equal(found.claimed,false);assert.equal(found.state,'uncertain');assert.deepEqual(found.context,context);
 const blocked=await second.claim({...upload,mediaHash:'new-upload',context:{...context,name:'different.pdf',previousPath:'/different-baseline'}});assert.equal(blocked.claimed,false);assert.deepEqual(blocked.context,context);assert.deepEqual((await second.lookup(identity)).context,context);
});
test('lookup missing document is null and rejected retry records the new baseline',async()=>{
 const ledger=createDocumentLedger({store:memory()}),{mediaHash,...identity}=upload;assert.equal(await ledger.lookup(identity),null);const first=await ledger.claim({...upload,context:{documentId:'28',name:'old.pdf'}});await ledger.transition(first.id,'rejected');const corrected=await ledger.claim({...upload,mediaHash:'new-upload',context:{documentId:'28',name:'corrected.pdf',previousPath:'',previousFilesDigest:'new-baseline'}});assert.equal(corrected.claimed,true);assert.equal((await ledger.lookup(identity)).context.name,'corrected.pdf');
});
test('ledger context accepts bounded metadata only and excludes raw media or CPF fields',async()=>{
 const store=memory(),ledger=createDocumentLedger({store});const result=await ledger.claim({...upload,context:{documentId:'28',name:'safe.pdf',cpf:upload.cpf,arquivo:'raw-file-bytes',encryption_metadata:{key:'secret'}}});assert.deepEqual(result.context,{documentId:'28',name:'safe.pdf'});const stored=JSON.stringify([...store.map.values()]);assert.ok(!stored.includes(upload.cpf));assert.ok(!stored.includes('raw-file-bytes'));assert.ok(!stored.includes('secret'));
 for(const context of [{name:'a'.repeat(256)},{previousPath:'a'.repeat(2049)},{previousFilesDigest:'a'.repeat(129)},{name:'line\nbreak.pdf'},{documentId:'99'},{previousPath:{url:'invalid'}},[]])await assert.rejects(ledger.claim({...upload,context}),/acompanhamento/);
});
