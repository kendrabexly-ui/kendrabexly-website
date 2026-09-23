import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const portal=fs.readFileSync(new URL('../public/portal/index.html',import.meta.url),'utf8');
const start=portal.indexOf('<div id="x-agent-boundary">');
const end=portal.indexOf('<!-- /x-agent-boundary -->',start);
const markup=portal.slice(start,end);

test('X Agent panels remain inside the boundary and every tab has a view',()=>{
  assert.ok(start>=0 && end>start);
  const stack=[],views=new Set();
  for(const match of markup.matchAll(/<(\/?)((?:div|details|summary))\b([^>]*)>/g)){
    const [,closing,tag,attrs]=match;
    if(closing){
      assert.equal(stack.pop()?.tag,tag,'X Agent markup closes '+tag+' out of order');
      continue;
    }
    if(stack.length===1 && /\bclass="[^"]*\bpanel\b/.test(attrs)){
      const view=attrs.match(/\bdata-x-view="([^"]+)"/)?.[1];
      if(view)views.add(view);
    }
    stack.push({tag});
  }
  assert.equal(stack.length,0,'X Agent boundary is closed after every panel');
  for(const [,view] of markup.matchAll(/data-x-jump="([^"]+)"/g)){
    assert.ok(views.has(view),'No visible panel for '+view);
  }
  assert.match(markup,/id="x-content-library-note"[^>]*data-x-view="library"[\s\S]*id="x-tweet-bank-panel"/);
});
