// Kendra Bexly — Experiences Design Preview (staging)
// Redesigned experience pages — dev/experience-redesign branch
// Staging safeguards: no booking submissions, no payments, no production bindings

const experiences = [
  {
    slug: "sensual-touch",
    title: "The Sensual Touch",
    index: "01",
    kicker: "THE ART OF UNWINDING",
    description: "A soothing, massage-centered escape created around relaxation, comfort, and personal attention.",
    heroIntro: "A soothing, massage-centered escape created around relaxation, comfort, and personal attention. Let the world fade away as you settle into an experience designed entirely around your well-being — unhurried, warm, and deeply restorative.",
    tags: ["Relaxation", "Sensual massage", "Comfort", "Personal attention"],
    descTitle: "An unhurried escape",
    descText: [
      "Soft lighting, gentle music, and the warm scent of essential oils set the tone from the moment you arrive. Every detail is considered — from the temperature of the room to the pressure of each touch — so you can let go completely and simply breathe.",
      "There is no rush here. No clock-watching, no pressure. Just a quiet, private space where time slows down and your comfort is the only thing that matters. This is your moment, and every minute of it is yours."
    ],
    touches: [
      { icon: "🍯", title: "Light snacks & refreshments", text: "For dates of 90 minutes or longer, enjoy a thoughtful selection of light snacks and refreshing beverages, chosen to complement your experience." },
      { icon: "🎵", title: "Soft music & ambiance", text: "A curated playlist of gentle, calming music sets the perfect backdrop for your relaxation. Every sound is chosen with care." },
      { icon: "✨", title: "Personal attention", text: "Every moment is focused entirely on you — your comfort, your pace, your experience. Nothing is rushed, nothing is overlooked." }
    ],
    heroImg: "https://images.unsplash.com/photo-1600334129128-685c5582fd35?auto=format&fit=crop&w=900&h=1120&q=80",
    atmosphereImg: "https://images.unsplash.com/photo-1600612253971-422e7f7faeb2?auto=format&fit=crop&w=1000&h=800&q=80",
    durations: [["30 minutes", 255, false], ["1 hour", 425, false], ["90 minutes", 640, true], ["2 hours", 850, true]]
  },
  {
    slug: "signature-experience",
    title: "The Signature Experience",
    index: "02",
    kicker: "THE BEAUTY OF CONNECTION",
    description: "A romantic escape filled with feminine charm, playful chemistry, and genuine connection.",
    heroIntro: "A romantic escape filled with feminine charm, playful chemistry, and genuine connection. From the first hello to the last goodbye, every moment is crafted to make you feel seen, appreciated, and completely at ease.",
    tags: ["Romance", "Chemistry", "Connection", "Elegance"],
    descTitle: "Where chemistry meets charm",
    descText: [
      "From the moment you arrive, you will feel the warmth of genuine connection. Easy conversation, playful banter, and a sense of being truly seen — this is an experience built around chemistry, not just companionship.",
      "Whether we are sharing a laugh, a quiet moment, or a deeper conversation, every interaction is natural and unhurried. There is no script, no pressure — just two people enjoying each other's company in a relaxed, beautiful setting."
    ],
    touches: [
      { icon: "🍯", title: "Light snacks & refreshments", text: "For dates of 90 minutes or longer, enjoy a thoughtful selection of light snacks and refreshing beverages, chosen to complement your experience." },
      { icon: "💬", title: "Thoughtful conversation", text: "Genuine connection and playful chemistry in a relaxed, comfortable setting where you can truly be yourself." },
      { icon: "✨", title: "Personal attention", text: "Every moment is tailored to you — your interests, your pace, your enjoyment. This is your time, and it is all about you." }
    ],
    heroImg: "https://images.unsplash.com/photo-1519408299519-5f0b3fe0c0f3?auto=format&fit=crop&w=900&h=1120&q=80",
    atmosphereImg: "https://images.unsplash.com/photo-1528909514045-220c4e3267e0?auto=format&fit=crop&w=1000&h=800&q=80",
    durations: [["30 minutes", 300, false], ["1 hour", 500, false], ["90 minutes", 750, true], ["2 hours", 1000, true], ["4 hours", 1900, true]]
  },
  {
    slug: "grecian-experience",
    title: "The Grecian Experience",
    index: "03",
    kicker: "A LITTLE MORE ADVENTUROUS",
    description: "A playful, adventurous escape for someone who is curious and open to something different.",
    heroIntro: "A playful, adventurous escape for someone who is curious and open to something different. Indulge your senses, embrace the unexpected, and let yourself be swept into an experience that is as thrilling as it is attentive.",
    tags: ["Adventure", "Indulgence", "Chemistry", "Personal attention"],
    descTitle: "For the curious and bold",
    descText: [
      "For those who crave something a little more adventurous, the Grecian Experience is designed to delight and surprise. It is playful, indulgent, and unapologetically bold — the perfect escape for someone who is curious about what is possible.",
      "Every detail is tailored to your comfort and your sense of adventure. Whether you are new to this or a seasoned explorer, you will find an experience that meets you where you are and takes you somewhere wonderful."
    ],
    touches: [
      { icon: "🍯", title: "Light snacks & refreshments", text: "For dates of 90 minutes or longer, enjoy a thoughtful selection of light snacks and refreshing beverages, chosen to complement your experience." },
      { icon: "🏛️", title: "Adventurous touches", text: "A playful, adventurous escape designed for the curious and bold, with every detail tailored to your comfort and sense of adventure." },
      { icon: "✨", title: "Personal attention", text: "Every moment is focused on your comfort and enjoyment — your pace, your boundaries, your experience. Nothing is rushed." }
    ],
    heroImg: "https://images.unsplash.com/photo-1526045478596-90825fe5c2c5?auto=format&fit=crop&w=900&h=1120&q=80",
    atmosphereImg: "https://images.unsplash.com/photo-1508009603885-50cf7c579365?auto=format&fit=crop&w=1000&h=800&q=80",
    durations: [["30 minutes", 400, false], ["1 hour", 700, false], ["90 minutes", 1000, true], ["2 hours", 1300, true], ["4 hours", 2500, true]]
  }
];

const money = (n) => "$" + n.toLocaleString("en-US");

const style = `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@400;500;600&display=swap');
:root{font-family:'DM Sans',sans-serif;color:#624b57;background:#fffaf8}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#fff9f8,#f9e9e9 67%,#fffaf8)}
a{color:inherit}header{display:flex;align-items:center;justify-content:space-between;padding:21px max(5vw,22px);background:#fffaf8dc;gap:14px;border-bottom:1px solid #eedede;position:sticky;top:0;z-index:20;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.logo{font-family:'Playfair Display',serif;font-size:24px;text-decoration:none}nav{display:flex;gap:18px;font-size:13px;flex-wrap:wrap}nav a{text-decoration:none}
main{max-width:1280px;margin:auto;padding:80px 42px 96px}.eyebrow{font-size:11px;letter-spacing:.25em;font-weight:700;color:#996d81;text-transform:uppercase}
h1,h2,h3{font-family:'Playfair Display',serif;font-weight:400;color:#795165}h1{font-size:clamp(40px,6vw,72px);line-height:1.13;margin:14px 0 22px}h2{font-size:clamp(28px,4vw,42px);margin:12px 0}h3{font-size:20px;margin:0 0 8px}
p{line-height:1.75}.intro{max-width:740px;font-size:17px;margin:0 0 38px}.page-intro{max-width:820px;margin:0 auto 46px;text-align:center}.page-intro h1{margin:14px 0 17px}.page-intro .intro{margin:0 auto;max-width:690px}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px}.card,.details{background:#fffdfb;border:1px solid #f0dce2;border-radius:24px;box-shadow:0 16px 45px #986a7810}
.card{display:flex;flex-direction:column;min-height:470px;overflow:hidden;transition:transform .25s ease,box-shadow .25s ease}.card:hover{transform:translateY(-6px);box-shadow:0 24px 62px #986a7829}.card-body{padding:34px;display:flex;flex-direction:column;flex:1}.card-image{aspect-ratio:4/3;overflow:hidden;background:linear-gradient(135deg,#f5dfe6,#f9e9e9)}.card-image img{display:block;width:100%;height:100%;object-fit:cover;transition:transform .5s ease}.card:hover .card-image img{transform:scale(1.04)}.card .eyebrow{font-size:10px}.card h2{font-size:clamp(26px,3vw,35px);line-height:1.2}.card .price-line{font-size:14px;color:#795165;font-weight:600;margin:6px 0 22px}.card .link{align-self:stretch}.card p{flex:1}.link{background:#9d7087;color:white;border:0;text-align:center;border-radius:80px;padding:13px 20px;text-decoration:none;font-size:14px;display:inline-block;cursor:pointer}
.secondary{background:transparent;color:#825b70;border:1px solid #bf9aaa}.details{max-width:860px;margin:30px auto}
.hero{display:grid;grid-template-columns:1.1fr 1fr;gap:48px;align-items:center;margin-bottom:64px}
.hero-text .eyebrow{margin-bottom:4px}.hero-text h1{margin:10px 0 20px}
.hero-intro{font-size:18px;line-height:1.8;max-width:520px;margin-bottom:22px}
.hero-tags{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
.hero-tag{background:#f5dfe6;color:#795165;border:1px solid #efd7df;border-radius:80px;padding:7px 16px;font-size:13px;letter-spacing:.04em}
.hero-image{position:relative;border-radius:24px;overflow:hidden;box-shadow:0 24px 60px #986a7820;aspect-ratio:4/5;background:linear-gradient(135deg,#f5dfe6,#f9e9e9)}
.hero-image img{width:100%;height:100%;object-fit:cover;display:block}
.hero-image::after{content:'';position:absolute;inset:0;border-radius:24px;box-shadow:inset 0 0 0 1px #f0dce255;pointer-events:none}
.exp-desc{background:#fffdfb;border:1px solid #f0dce2;border-radius:24px;padding:48px;margin-bottom:48px;box-shadow:0 16px 45px #986a7810}
.exp-desc-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.exp-desc-text p{font-size:16px;margin-bottom:16px}.exp-desc-text p:last-child{margin-bottom:0}
.exp-desc-image{border-radius:20px;overflow:hidden;aspect-ratio:5/4;background:linear-gradient(135deg,#f9e9e9,#f5dfe6);box-shadow:0 16px 40px #986a7815}
.exp-desc-image img{width:100%;height:100%;object-fit:cover;display:block}
.duration-section{margin-bottom:48px}
.duration-section>p{max-width:560px;margin-bottom:28px}
.duration-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:18px}
.duration-card{background:#fffdfb;border:1px solid #f0dce2;border-radius:20px;padding:28px 22px;cursor:pointer;text-align:left;font:inherit;color:#624b57;box-shadow:0 12px 36px #986a7808;transition:box-shadow .25s,border-color .25s,transform .15s;display:flex;flex-direction:column;gap:10px}
.duration-card:hover{box-shadow:0 18px 50px #986a7818;transform:translateY(-3px)}
.duration-card .dur-label{font-size:15px;font-weight:600;color:#8c697b;letter-spacing:.02em}
.duration-card .dur-price{font-family:'Playfair Display',serif;font-size:32px;color:#795165;line-height:1}
.duration-card[aria-pressed=true]{background:linear-gradient(135deg,#f5dfe6,#fff6f7);border-color:#9d7087;box-shadow:0 18px 50px #986a7820}
.duration-card[aria-pressed=true] .dur-price{color:#9d7087}
.duration-card .dur-badge{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#996d81;font-weight:700;opacity:0;transition:opacity .25s}
.duration-card[aria-pressed=true] .dur-badge{opacity:1}
.touches{background:#fffdfb;border:1px solid #f0dce2;border-radius:24px;padding:48px;margin-bottom:48px;box-shadow:0 16px 45px #986a7810}
.touch-items{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px;margin-top:28px}
.touch-item{padding:0}
.touch-icon{width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,#f5dfe6,#f9e9e9);display:flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:22px}
.touch-item h3{margin-bottom:10px}.touch-item p{font-size:15px;color:#8c697b}
.touch-highlight{background:#f8edf0;border-radius:16px;padding:16px 20px;margin-top:24px;font-size:14px;color:#795165;line-height:1.7}
.touch-highlight strong{font-family:'Playfair Display',serif;font-weight:500}
.summary-section{background:#fffdfb;border:1px solid #f0dce2;border-radius:24px;padding:48px;box-shadow:0 16px 45px #986a7810;max-width:680px;margin:0 auto 48px}
.summary-card{background:linear-gradient(135deg,#f8edf0,#fff6f7);border-radius:18px;padding:32px;text-align:center}
.summary-card h2{margin:0 0 8px;font-size:28px}
.summary-card .sum-duration{font-size:16px;color:#8c697b;margin-bottom:20px}
.summary-card .sum-duration span{font-weight:600;color:#795165}
.summary-price{display:flex;flex-direction:column;align-items:center;gap:4px;padding-top:20px;border-top:1px solid #efd7df}
.summary-price .eyebrow{margin-bottom:2px}
.summary-price strong{font-family:'Playfair Display',serif;font-size:42px;color:#9d7087;font-weight:500}
.refreshment-note{background:#f5dfe6;border-radius:12px;padding:12px 18px;margin-top:18px;font-size:14px;color:#795165;display:none;align-items:center;gap:8px;justify-content:center}
.refreshment-note.show{display:flex}.refreshment-note .ref-icon{font-size:18px}
.actions{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:24px}
.note{font-size:12px;color:#8c697b;text-align:center;margin-top:16px}
.return-link{display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-size:15px;color:#825b70;border:1px solid #bf9aaa;border-radius:80px;padding:12px 24px;background:transparent;transition:background .2s}
.return-link:hover{background:#f8edf0}
footer{text-align:center;padding:28px;background:#fbf0f1;font-size:12px;color:#876c7a}
@media(max-width:900px){.cards{grid-template-columns:1fr}.card{min-height:0}.card-image{aspect-ratio:16/9}.card h2{font-size:34px}.hero{gap:28px}}
@media(max-width:760px){
  header{align-items:center;flex-direction:row;justify-content:space-between;gap:10px;padding:13px 18px;min-height:64px}header .logo{font-size:22px;white-space:nowrap}header nav{gap:0;font-size:12px}header nav span{display:none}header nav a{padding:7px 10px;border:1px solid #ead9dd;border-radius:100px}main{padding:32px 18px 70px}.page-intro{margin-bottom:28px}.page-intro h1{font-size:clamp(38px,9vw,52px);margin:10px 0 14px}.page-intro .intro{font-size:15px;line-height:1.7}.card-body{padding:24px}.card-image{aspect-ratio:16/10}.card h2{font-size:30px;margin:8px 0 10px}.card p{font-size:15px;line-height:1.65;margin:0 0 14px}.card .price-line{margin:2px 0 18px}.card .link{padding:12px 16px}
  .cards{grid-template-columns:1fr}.card{min-height:unset}
  .details{padding:22px}
  .hero{grid-template-columns:1fr;gap:28px;margin-bottom:40px}
  .hero-image{aspect-ratio:3/4;max-width:340px;margin:0 auto}
  .exp-desc{padding:28px}.exp-desc-grid{grid-template-columns:1fr;gap:24px}
  .exp-desc-image{aspect-ratio:16/10}
  .duration-cards{grid-template-columns:repeat(2,minmax(0,1fr))}
  .duration-card{padding:22px 18px}.duration-card .dur-price{font-size:28px}
  .touches{padding:28px}.touch-items{grid-template-columns:1fr;gap:20px}
  .summary-section{padding:28px}.summary-card{padding:24px}
  .summary-price strong{font-size:36px}
  .actions{flex-direction:column}.actions .link{width:100%}
}`;

function layout(body, title) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} | Kendra Bexly — Design Preview</title><style>${style}</style></head><body>
  <header><a href="/our-time/" class="logo">Kendra Bexly</a><nav><a href="/our-time/">Experiences</a><span>Private design preview</span></nav></header>
  <main>${body}</main><footer>Design preview only · No appointments or payments accepted here</footer></body></html>`;
}

function overview() {
  const cards = experiences.map((e) => `<article class="card"><div class="card-image"><img src="${e.heroImg}" alt="${e.title} — atmospheric editorial image" loading="lazy"></div><div class="card-body"><div class="eyebrow">${e.index} · ${e.kicker}</div><h2>${e.title}</h2><p>${e.description}</p><div class="price-line">Starting at ${money(e.durations[0][1])}</div><a class="link" href="/explore-${e.slug}/">Explore the experience</a></div></article>`).join("");
  return layout(`<section class="page-intro"><div class="eyebrow">Your Invitation to Something More</div><h1>Our Time Together</h1><p class="intro">A little romance, a little indulgence, and plenty of attention just for you. Every experience has its own charm. Discover the one that speaks to you.</p></section><section class="cards">${cards}</section>`, "Our Time Together");
}

function enhancedDetail(e) {
  const durationCards = e.durations.map(([duration, price, refreshments], i) => `<button type="button" class="duration-card" data-duration="${duration}" data-price="${price}" data-refreshments="${refreshments}" aria-pressed="${i === 0}"><span class="dur-label">${duration}</span><span class="dur-price">${money(price)}</span><span class="dur-badge">${refreshments ? "Includes refreshments" : "&nbsp;"}</span></button>`).join("");
  const touchItems = e.touches.map((t) => `<div class="touch-item"><div class="touch-icon">${t.icon}</div><h3>${t.title}</h3><p>${t.text}</p></div>`).join("");
  const descParas = e.descText.map((p) => `<p>${p}</p>`).join("");
  const tagPills = e.tags.map((t) => `<span class="hero-tag">${t}</span>`).join("");
  return layout(`
  <section class="hero">
    <div class="hero-text">
      <div class="eyebrow">${e.index} · ${e.kicker}</div>
      <h1>${e.title}</h1>
      <p class="hero-intro">${e.heroIntro}</p>
      <div class="hero-tags">${tagPills}</div>
    </div>
    <div class="hero-image"><img src="${e.heroImg}" alt="${e.title} — editorial photography" loading="eager" referrerpolicy="no-referrer" onerror="this.style.display='none'"></div>
  </section>
  <section class="exp-desc">
    <div class="exp-desc-grid">
      <div class="exp-desc-text"><div class="eyebrow">The Atmosphere</div><h2>${e.descTitle}</h2>${descParas}</div>
      <div class="exp-desc-image"><img src="${e.atmosphereImg}" alt="${e.title} — atmosphere" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'"></div>
    </div>
  </section>
  <section class="duration-section">
    <div class="eyebrow">Choose Your Time</div>
    <h2>A little time just for you</h2>
    <p>Select the duration that feels right for you. Each option includes the same attentive, unhurried care — the only difference is how long you get to enjoy it.</p>
    <div class="duration-cards" role="group" aria-label="Appointment duration">${durationCards}</div>
  </section>
  <section class="touches">
    <div class="eyebrow">Thoughtful Touches</div>
    <h2>Little extras, just because</h2>
    <div class="touch-items">${touchItems}</div>
    <div class="touch-highlight"><strong>Complimentary refreshments</strong> are included with all dates of 90 minutes or longer — a little something to enjoy before, during, or after your time together.</div>
  </section>
  <section class="summary-section">
    <div class="eyebrow" style="text-align:center;margin-bottom:20px">Your Selected Experience</div>
    <div class="summary-card" aria-live="polite">
      <h2>${e.title}</h2>
      <p class="sum-duration">Duration: <span id="duration">${e.durations[0][0]}</span></p>
      <div class="summary-price"><span class="eyebrow">Investment</span><strong id="investment">${money(e.durations[0][1])}</strong></div>
      <div class="refreshment-note" id="refreshment-note"><span class="ref-icon">🍯</span><span>Includes light snacks and refreshments</span></div>
    </div>
    <div class="actions">
      <button class="link" type="button" disabled title="Booking disabled on staging" style="opacity:.65;cursor:not-allowed">Continue to introduction (preview only)</button>
      <a class="link secondary" href="/our-time/">View all experiences</a>
    </div>
    <p class="note">This staging site cannot submit an introduction, create a booking, or process a payment.</p>
  </section>
  <div style="text-align:center"><a href="/our-time/" class="return-link">← Return to Our Time Together</a></div>
  <script>(function(){var cards=document.querySelectorAll('.duration-card');var d=document.getElementById('duration'),p=document.getElementById('investment'),r=document.getElementById('refreshment-note');var f=cards[0];if(f&&f.dataset.refreshments==='true')r.classList.add('show');cards.forEach(function(c){c.addEventListener('click',function(){cards.forEach(function(x){x.setAttribute('aria-pressed','false')});c.setAttribute('aria-pressed','true');d.textContent=c.dataset.duration;p.textContent=String.fromCharCode(36)+Number(c.dataset.price).toLocaleString('en-US');if(c.dataset.refreshments==='true')r.classList.add('show');else r.classList.remove('show')})})})()</script>
  `, e.title);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = (url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname) || "/";
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Read-only staging preview.", { status: 405 });
    let html;
    if (path === "/our-time" || path === "/") html = overview();
    else {
      const experience = experiences.find((e) => path === "/explore-" + e.slug);
      if (experience) html = enhancedDetail(experience);
    }
    if (!html) return new Response("Not available in isolated design preview.", { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(request.method === "HEAD" ? null : html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https://images.unsplash.com; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      }
    });
  }
};