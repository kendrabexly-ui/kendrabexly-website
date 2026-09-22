import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(new URL('../public/'+path, import.meta.url), 'utf8');
const portal = read('portal/index.html');
const between = (text, start, end) => {
  const from=text.indexOf(start), to=text.indexOf(end,from);
  assert.ok(from>=0 && to>from);
  return text.slice(from,to);
};

test('all inline scripts parse after markup cleanup', () => {
  for(const path of ['index.html','request.html','complete/index.html','portal/index.html','meet-kendra/index.html','the-muse/index.html','our-time/index.html','etiquette/index.html','pillow-talk/index.html']) {
    const html=read(path);
    assert.ok(!html.includes('>\\n  <'),path);
    for(const [,script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script,{filename:path});
  }
  new vm.Script(read('site-shell.js'));
});

test('analytics identifiers survive blocked browser storage', () => {
  const code=between(read('request.html'),'    const funnelSession =','    function trackFunnel');
  const context=vm.createContext({sessionStorage:{getItem(){throw new Error('blocked');}},crypto:{randomUUID:()=> 'independent-id'}});
  assert.equal(vm.runInContext(code+'\nfunnelSession;',context),'independent-id');
  const writeBlocked=vm.createContext({sessionStorage:{getItem(){return null;},setItem(){throw new Error('blocked');}},crypto:{randomUUID:()=> 'fallback-id'}});
  assert.equal(vm.runInContext(code+'\nfunnelSession;',writeBlocked),'fallback-id');
});

test('private-page analytics never include the access token', async () => {
  const code=between(read('complete/index.html'),'    const analyticsSession =','    function renderSummary');
  let payload;
  const context=vm.createContext({token:'secret-private-token',requestId:2,location:{pathname:'/complete'},crypto:{randomUUID:()=> 'unrelated-id'},fetch:async(_,options)=>{payload=JSON.parse(options.body);}});
  await vm.runInContext(code+'\ntrack("page_test");',context);
  assert.equal(payload.session_id,'unrelated-id');
  assert.ok(!JSON.stringify(payload).includes('secret'));
});

test('verification saves preserve newer edits and serialize concurrent requests', async () => {
  const code=between(portal,'      const saveVerificationDraft=','      const applyVerificationDraft =');
  const section={dataset:{clientId:'1'}};
  let current={name_first:'First',id_details:{}};
  let applied=null, scheduled=0, active=0, maxActive=0;
  const requests=[];
  const context=vm.createContext({
    clearTimeout(){},setTimeout,
    capturePersonaDraft:()=>structuredClone(current),
    setVerificationDraftState:(_,state)=>{section.dataset.draftDirty=state==='saved'?'0':'1';},
    scheduleVerificationDraftSave:()=>scheduled++,
    verificationAuthExpired:()=>false,
    applyVerificationDraft:(_,draft)=>{applied=draft;},
    verificationSafeDraftKey:()=>'',localStorage:{removeItem(){}},
    fetch:(_,options)=>{
      active++;maxActive=Math.max(maxActive,active);
      return new Promise(resolve=>requests.push({payload:JSON.parse(options.body),finish(){active--;resolve({ok:true,json:async()=>({ok:true,draft:JSON.parse(options.body)})});}}));
    }
  });
  const save=vm.runInContext(code+'\nsaveVerificationDraft;',context);
  const first=save(section);
  current.name_first='Newer';
  const second=save(section);
  assert.equal(requests.length,1);
  assert.equal(section.dataset.draftDirty,'1');
  requests[0].finish();
  assert.equal(await first,false);
  assert.equal(applied,null);
  assert.equal(scheduled,1);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,2);
  assert.equal(requests[1].payload.persona_fields.name_first,'Newer');
  requests[1].finish();
  assert.equal(await second,true);
  assert.equal(applied.persona_fields.name_first,'Newer');
  assert.equal(section.dataset.draftDirty,'0');
  assert.equal(maxActive,1);
});
