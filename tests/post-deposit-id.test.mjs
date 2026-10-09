import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
function handler(path,next) {
  const start=source.indexOf('    if (url.pathname === "'+path+'"');
  const end=source.indexOf('    if (url.pathname === "'+next+'"',start+1);
  assert.ok(start>=0 && end>start);
  return vm.runInNewContext('(async function(request,env){const url=new URL(request.url);'+source.slice(start,end)+'})',{
    URL,File,Uint8Array,Date,crypto:globalThis.crypto,console,
    bookingCorsJson:(body,options={})=>({body,status:options.status||200}),
    ensureSiteContentTables:async()=>{},ensureClientVerificationAuditsTable:async()=>{},ensureClientIdDocumentsTable:async()=>{},
    sha256Hex:async()=> 'hash',idDocumentDate:value=>String(value),verificationAgeOnDate:()=>40,
    idDocumentToday:()=> '2026-10-01',recordBookingFunnelEvent:async()=>{}
  });
}
const combined=handler('/api/booking/continuation/combined','/api/booking/continuation/identity');
const identity=handler('/api/booking/continuation/identity','/api/booking/continuation');
function database(row) {
  const writes=[];
  return {writes,prepare(sql){return {sql,values:[],bind(...values){this.values=values;return this;},
    async first(){if(sql.includes('FROM booking_continuations')) return row;return null;},
    async run(){writes.push({sql,values:this.values});return {success:true};}};},
    async batch(statements){for(const statement of statements) await statement.run();}};
}
const row={date_request_id:1,client_id:2,combined_step:1,completed_at:null,status:'screening_pending',expires_at:'2099-01-01',notes:'',deposit_amount:125,deposit_paid:0,id_received:0};
function request(path,fields={}){
  const form=new FormData();form.set('token','a'.repeat(64));
  for(const [key,value] of Object.entries(fields)) form.set(key,value);
  return new Request('https://example.com'+path,{method:'POST',body:form});
}
test('booking and deposit selection succeeds without ID or private storage',async()=>{
  const DB=database({...row});
  const response=await combined(request('/api/booking/continuation/combined',{birthdate:'1980-01-01',deposit_payment_method:'stripe',deposit_step_acknowledged:'yes'}),{DB});
  assert.equal(response.status,200);assert.equal(response.body.deposit_amount,137.5);
  assert.ok(DB.writes.some(write=>write.sql.includes('deposit_step_acknowledged=1')));
  assert.ok(!DB.writes.some(write=>write.sql.includes('INSERT INTO client_id_documents')));
});
test('initial ID upload requires an actual image file',async()=>{
  let put=false;const DB=database({...row});
  const response=await identity(request('/api/booking/continuation/identity'),{DB,ID_DOCUMENTS:{put:async()=>{put=true;}}});
  assert.equal(response.status,400);assert.equal(put,false);assert.equal(DB.writes.length,0);
});
test('initial upload rejects disguised image bytes',async()=>{
  let put=false;const DB=database({...row,deposit_paid:1});
  const file=new File(['invalid image'],'id.png',{type:'image/png'});
  const response=await identity(request('/api/booking/continuation/identity',{id_document:file}),{DB,ID_DOCUMENTS:{put:async()=>{put=true;}}});
  assert.equal(response.status,400);assert.equal(put,false);
});
test('initial client ID upload saves privately for review without final approval',async()=>{
  const DB=database({...row});let objectKey;
  const file=new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])],'id.png',{type:'image/png'});
  const response=await identity(request('/api/booking/continuation/identity',{id_document:file}),{DB,ID_DOCUMENTS:{put:async key=>{objectKey=key;},delete:async()=>{}}});
  assert.equal(response.status,200);assert.match(objectKey,/^clients\/2\/id-documents\//);
  assert.ok(DB.writes.some(write=>write.sql.includes("'pending_review'")));
  assert.ok(DB.writes.some(write=>write.sql.includes('SET id_received=1')));
  assert.ok(!DB.writes.some(write=>write.sql.includes('final_approval=1')));
});

test('client profile refreshes its private ID preview when reopened',()=>{
  const portal=fs.readFileSync(new URL('../public/portal/index.html',import.meta.url),'utf8');
  assert.match(portal,/loadIdDocument\(verificationSection, true\)/);
  assert.match(portal,/loadIdDocument\(section,true\)/);
  assert.match(portal,/\/api\/admin\/clients\/id-document\/image\?client_id=/);
});
