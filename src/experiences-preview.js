// Standalone, read-only design preview. No production Worker imports, service
// bindings, D1/R2, cron, outbound services, or booking submission.
const experiences = [
  { slug: "sensual-touch", title: "The Sensual Touch", index: "01", kicker: "THE ART OF UNWINDING",
    description: "A soothing, massage-centered escape created around relaxation, comfort, and personal attention.",
    durations: [["30 minutes",255],["1 hour",425],["1½ hours",640],["2 hours",850]] },
  { slug: "signature-experience", title: "The Signature Experience", index: "02", kicker: "THE BEAUTY OF CONNECTION",
    description: "A romantic escape filled with feminine charm, playful chemistry, and genuine connection.",
    durations: [["30 minutes",300],["1 hour",500],["1½ hours",750],["2 hours",1000],["4 hours",1900]] },
  { slug: "grecian-experience", title: "The Grecian Experience", index: "03", kicker: "A LITTLE MORE ADVENTUROUS",
    description: "A playful, adventurous escape for someone who's curious and open to something different.",
    durations: [["30 minutes",400],["1 hour",700],["1½ hours",1000],["2 hours",1300],["4 hours",2500]] }
];
const money = n => "$" + n.toLocaleString("en-US");
const style = `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@400;500;600&display=swap');
:root{font-family:'DM Sans',sans-serif;color:#624b57;background:#fffaf8}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#fff9f8,#f9e9e9 67%,#fffaf8)}
a{color:inherit}header{display:flex;align-items:center;justify-content:space-between;padding:21px max(5vw,22px);background:#fffaf8cc;gap:14px;border-bottom:1px solid #eedede}
.logo{font-family:'Playfair Display',serif;font-size:24px;text-decoration:none}nav{display:flex;gap:18px;font-size:13px;flex-wrap:wrap}nav a{text-decoration:none}
main{max-width:1140px;margin:auto;padding:54px 22px 85px}.eyebrow{font-size:11px;letter-spacing:.25em;font-weight:700;color:#996d81;text-transform:uppercase}
h1,h2{font-family:'Playfair Display',serif;font-weight:400;color:#795165}h1{font-size:clamp(40px,6vw,72px);line-height:1.13;margin:14px 0 22px}h2{font-size:clamp(28px,4vw,42px);margin:12px 0}
p{line-height:1.75}.intro{max-width:740px;font-size:17px;margin-bottom:34px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}.card,.details{background:#fffdfb;border:1px solid #f0dce2;border-radius:22px;padding:30px;box-shadow:0 16px 45px #986a7810}
.card{display:flex;flex-direction:column;min-height:355px}.card p{flex:1}.link{background:#9d7087;color:white;border:0;text-align:center;border-radius:80px;padding:13px 20px;text-decoration:none;font-size:14px;display:inline-block;cursor:pointer}
.secondary{background:transparent;color:#825b70;border:1px solid #bf9aaa}.details{max-width:860px;margin:30px auto}.prices{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:12px;margin:25px 0}.price{background:#fff6f7;color:#755163;border:1px solid #efd7df;border-radius:16px;padding:18px 12px;cursor:pointer;text-align:left;font:inherit}
.price strong{display:block;font-size:22px;margin-top:10px}.price[aria-pressed=true]{background:#f5dfe6;outline:2px solid #9d7087}
.summary{background:#f8edf0;padding:22px;border-radius:16px;margin:22px 0}.summary strong{font-size:25px}.note{font-size:12px;color:#8c697b}.actions{display:flex;gap:12px;flex-wrap:wrap}footer{text-align:center;padding:28px;background:#fbf0f1;font-size:12px;color:#876c7a}
@media(max-width:760px){header{align-items:flex-start;flex-direction:column}main{padding-top:35px}.cards{grid-template-columns:1fr}.card{min-height:unset}.details{padding:22px}.prices{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
function layout(body,title) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} | Kendra Bexly — Design Preview</title><style>${style}</style></head><body>
  <header><a href="/our-time/" class="logo">Kendra Bexly</a><nav><a href="/our-time/">Experiences</a><span>Private design preview</span></nav></header>
  <main>${body}</main><footer>Design preview only · No appointments or payments accepted here</footer></body></html>`;
}
function overview() {
  const cards=experiences.map(e=>`<article class="card"><div class="eyebrow">${e.index} · ${e.kicker}</div><h2>${e.title}</h2><p>${e.description}</p><p>Starting at ${money(e.durations[0][1])}</p><a class="link" href="/explore-${e.slug}/">Explore the experience</a></article>`).join("");
  return layout(`<div class="eyebrow">Your Invitation to Something More</div><h1>Our Time Together</h1><p class="intro">A little romance, a little indulgence, and plenty of attention just for you. Every experience has its own charm. Discover the one that speaks to you.</p><section class="cards">${cards}</section>`,"Our Time Together");
}
function detail(e) {
  const buttons=e.durations.map(([duration,price],i)=>`<button type="button" class="price" data-duration="${duration}" data-price="${price}" aria-pressed="${i===0}">${duration}<strong>${money(price)}</strong></button>`).join("");
  return layout(`<div class="eyebrow">${e.kicker}</div><h1>${e.title}</h1><p class="intro">${e.description}</p><section class="details"><div class="eyebrow">Choose your time</div><h2>A little time just for you</h2><div class="prices" role="group" aria-label="Appointment duration">${buttons}</div>
  <div class="summary" aria-live="polite"><div class="eyebrow">Your selected experience</div><p>${e.title} · <span id="duration">${e.durations[0][0]}</span></p><strong id="investment">${money(e.durations[0][1])}</strong></div>
  <div class="actions"><button class="link" type="button" disabled title="Booking disabled on staging" style="opacity:.65;cursor:not-allowed">Continue to introduction (preview only)</button><a class="link secondary" href="/our-time/">View all experiences</a></div>
  <p class="note">This staging site cannot submit an introduction, create a booking, or process a payment.</p></section>
  <script>document.querySelectorAll('.price').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.price').forEach(x=>x.setAttribute('aria-pressed','false'));b.setAttribute('aria-pressed','true');document.getElementById('duration').textContent=b.dataset.duration;document.getElementById('investment').textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(b.dataset.price));}));</script>`,e.title);
}
export default {async fetch(request){
  const url=new URL(request.url);
  const path=(url.pathname.endsWith("/") ? url.pathname.slice(0,-1) : url.pathname)||"/";
  if(!["GET","HEAD"].includes(request.method)) return new Response("Read-only staging preview.",{status:405});
  let html;
  if(path==="/our-time"||path==="/") html=overview();
  else {const experience=experiences.find(e=>path==="/explore-"+e.slug);if(experience) html=detail(experience);}
  if(!html)return new Response("Not available in isolated design preview.",{status:404,headers:{"Cache-Control":"no-store"}});
  return new Response(request.method==="HEAD"?null:html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
}};
