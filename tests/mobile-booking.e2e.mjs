import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage();let blocked=0,submitted=0;
await page.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.hostname!=='127.0.0.1' && url.hostname!=='localhost'){blocked++;return route.abort();}
 if(url.pathname==='/api/request'){submitted++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});}
 return route.continue();
});
const cases=[
 ['sensual-touch','/explore-sensual-touch/',[255,425,625,825]],
 ['signature','/explore-signature-experience/',[300,500,725,975,1900]],
 ['grecian','/explore-grecian-experience/',[400,700,1000,1300,2500]]
];
for(const [key,path,prices] of cases){
 await page.goto('http://127.0.0.1:8787'+path,{waitUntil:'domcontentloaded'});
 const cards=page.locator('.duration-card');
 assert.equal(await cards.count(),prices.length,key+' card count');
 for(let i=0;i<prices.length;i++){
  await cards.nth(i).click();
  const card=cards.nth(i);
  const dur=await card.getAttribute('data-duration');
  const amount=Number(await card.getAttribute('data-price'));
  assert.equal(amount,prices[i],key+' price '+i);
  assert.equal(await card.getAttribute('aria-pressed'),'true');
  const reserve=page.locator('.appointment-continue').first();
  const href=await reserve.getAttribute('href');
  assert.equal(new URL(href,'http://127.0.0.1:8787').searchParams.get('experience'),key);
  assert.equal(new URL(href,'http://127.0.0.1:8787').searchParams.get('duration'),dur);
  await reserve.click();
  await page.waitForURL(/\/booking\/\?/);
  const panel=page.locator('#preselected-experience');
  assert.equal(await panel.isVisible(),true,key+' preselection');
  const desc=await page.locator('#preselected-description').innerText();
  assert.ok(desc.includes('$'+amount.toLocaleString('en-US')),key+' booking price '+i+' '+desc);
  if(i===0){await page.locator('#change-preselected-experience').click();assert.equal(await panel.isVisible(),false);}
  await page.goto('http://127.0.0.1:8787'+path,{waitUntil:'domcontentloaded'});
 }
}
await page.goto('http://127.0.0.1:8787/booking/?experience=signature&duration=90%20minutes');
assert.equal(await page.locator('input[name="intro_photo"]').count(),1);
const selector=page.locator('#screening-method');
for(const [method,hasID] of [['government-id',true],['linkedin',false],['employment',false]]){
 await selector.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},method);
 const hint=(await page.locator('#intro-photo-instructions').innerText()).toLowerCase();
 assert.equal(hint.includes('holding your valid state'),hasID,method);
}
const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,view:window.innerWidth}));
assert.ok(width.scroll<=width.view+2,'mobile horizontal overflow '+JSON.stringify(width));
assert.equal(submitted,0,'no actual submissions made');
const invalid=await page.locator('#booking').evaluate(form=>{form.noValidate=false;return !form.checkValidity();});
assert.equal(invalid,true,'empty required fields are invalid');
// Supply a genuinely valid form without overriding reportValidity().
await page.route('**/api/public/introduction-terms',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({terms:'Isolated test terms',version:'test-1'})}));
await page.reload({waitUntil:'domcontentloaded'});
await page.locator('#first').fill('Taylor');
await page.locator('#last').fill('Example');
await page.locator('#age').fill('35');
await page.locator('#occupation').fill('Research Test');
await page.locator('#base').selectOption('CA');
await page.locator('#flip-next').click();
await page.locator('#phone').fill('2135550100');
await page.locator('#email').fill('taylor@example.invalid');
await page.locator('#contact-method').selectOption('email');
await page.locator('#flip-done').click();
await page.locator('#screening-method').selectOption('government-id');
await page.locator('#intro-photo').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/JQAAAABJRU5ErkJggg==','base64')});
await page.locator('#flip-photo-done').click();
await page.locator('#intro-location').evaluate(el=>el.value='incall');
await page.locator('#intro-date').evaluate(el=>{el.value='2027-02-10';el.dispatchEvent(new Event('change',{bubbles:true}));});
await page.locator('#intro-time').evaluate(el=>{if(![...el.options].some(o=>o.value==='16:00'))el.add(new Option('4:00 PM','16:00'));el.value='16:00';});
await page.locator('#deposit-preference').selectOption('gift-card');
await page.locator('#terms-accepted').check();
const allValid=await page.locator('#booking').evaluate(form=>form.checkValidity());
assert.equal(allValid,true,'completed form should be valid');
await page.locator('#booking').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
await page.waitForURL(/\/thank-you\//,{timeout:10000});
assert.equal(submitted,1,'exactly one intercepted simulated introduction');

console.log('MOBILE E2E PASS: 14 price/duration handoffs, change option, 3 conditional photo modes, required-field check, mocked thank-you redirect, 390px overflow; requests blocked='+blocked);
await browser.close();
