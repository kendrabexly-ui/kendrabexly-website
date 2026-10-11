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
    heroIntro: "A softer kind of escape, where a soothing sensual massage, warm attention, and a calming atmosphere invite you to unwind. Settle in, get comfortable, and let me take care of the little details.",
    tags: ["Relaxation", "Sensual massage", "Comfort", "Personal attention"],
    descTitle: "An unhurried escape",
    descText: [
      "Soft lighting, calming music, and a cozy setting make it easy to settle in. The focus is on a soothing massage and the pleasure of having a little time set aside just for you.",
      "Whether you prefer a brief escape or a longer moment to unwind, you'll be met with warmth, care, and an easy, welcoming atmosphere."
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
    heroIntro: "A little romance, a little playful chemistry, and plenty of attention just for you. Think easy conversation, feminine charm, and the pleasure of enjoying each other's company.",
    tags: ["Romance", "Chemistry", "Connection", "Elegance"],
    descTitle: "Where chemistry meets charm",
    descText: [
      "The best moments often begin with a smile and a little spark. Expect a warm welcome, playful conversation, and space to enjoy the connection as it unfolds.",
      "Stay a little longer and we'll have more room for the small pleasures: a relaxed pace, thoughtful touches, and time to settle into the moment."
    ],
    touches: [
      { icon: "🍯", title: "Light snacks & refreshments", text: "For dates of 90 minutes or longer, enjoy a thoughtful selection of light snacks and refreshing beverages, chosen to complement your experience." },
      { icon: "💬", title: "Thoughtful conversation", text: "Genuine connection and playful chemistry in a relaxed, comfortable setting where you can truly be yourself." },
      { icon: "✨", title: "Personal attention", text: "Every moment is tailored to you — your interests, your pace, your enjoyment. This is your time, and it is all about you." }
    ],
    heroImg: "https://images.unsplash.com/photo-1528909514045-220c4e3267e0?auto=format&fit=crop&w=900&h=1120&q=80",
    atmosphereImg: "https://images.unsplash.com/photo-1528909514045-220c4e3267e0?auto=format&fit=crop&w=1000&h=800&q=80",
    durations: [["30 minutes", 300, false], ["1 hour", 500, false], ["90 minutes", 750, true], ["2 hours", 1000, true], ["4 hours", 1900, true]]
  },
  {
    slug: "grecian-experience",
    title: "The Grecian Experience",
    index: "03",
    kicker: "A LITTLE MORE ADVENTUROUS",
    description: "A playful, adventurous escape for someone who is curious and open to something different.",
    heroIntro: "Feeling a little adventurous? The Grecian Experience pairs playful energy with a soft, attentive atmosphere. Bring your curiosity; I'll bring the feminine charm and thoughtful details.",
    tags: ["Adventure", "Indulgence", "Chemistry", "Personal attention"],
    descTitle: "For the curious and bold",
    descText: [
      "A touch bolder than Signature, Grecian makes room for curiosity, playful chemistry, and a more adventurous mood, all within a welcoming setting.",
      "There's no need to rush the experience. Choose the time that feels right and enjoy a relaxed pace, personal attention, and those little details that make a date feel special."
    ],
    touches: [
      { icon: "🍯", title: "Light snacks & refreshments", text: "For dates of 90 minutes or longer, enjoy a thoughtful selection of light snacks and refreshing beverages, chosen to complement your experience." },
      { icon: "🏛️", title: "Adventurous touches", text: "A playful, adventurous escape designed for the curious and bold, with every detail tailored to your comfort and sense of adventure." },
      { icon: "✨", title: "Personal attention", text: "Every moment is focused on your comfort and enjoyment — your pace, your boundaries, your experience. Nothing is rushed." }
    ],
    heroImg: "https://images.unsplash.com/photo-1508009603885-50cf7c579365?auto=format&fit=crop&w=900&h=1120&q=80",
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
}
/* October 10 editorial finishing pass */
:root{--kb-plum:#795165;--kb-mauve:#9d7087;--kb-cream:#fffaf8;--kb-blush:#f9e9e9}
body{color:#624b57;background:linear-gradient(180deg,#fffaf8 0%,#f9e9e9 62%,#fffaf8 100%)}
h1,h2,h3{letter-spacing:-.015em}h1{line-height:1.14}h2{line-height:1.22}p{letter-spacing:.005em}
.card,.exp-desc,.touches,.summary-section{border-color:#eadce0;box-shadow:0 16px 45px #986a7810}
.card p{color:#715e67}.card .price-line{margin-top:14px}.card .link,.actions .link:not(.secondary){background:#9d7087;color:#fff}
.link:hover:not(:disabled){background:#866074}.link:focus-visible,.return-link:focus-visible,.duration-card:focus-visible,nav a:focus-visible{outline:3px solid #a77b92;outline-offset:3px}
.duration-section>p{color:#715e67}.duration-card{min-height:132px}.duration-card[aria-pressed=true]{border-width:2px}.dur-badge{min-height:14px}
.touches h2,.duration-section h2{max-width:760px}.exp-desc-text p{color:#715e67}
.summary-card{background:linear-gradient(140deg,#f8edf0,#fff9f8)}
@media(max-width:760px){h2{font-size:clamp(27px,7vw,34px)}.hero-intro{font-size:16px;line-height:1.7}.hero{margin-bottom:32px}.exp-desc,.touches,.duration-section{margin-bottom:32px}.exp-desc,.touches,.summary-section{padding:26px 23px}.duration-cards{gap:12px}.duration-card{padding:18px 14px;min-height:125px}.duration-card .dur-price{font-size:26px}.duration-card .dur-label{font-size:14px}.hero-tag{font-size:12px;padding:6px 11px}.summary-card{padding:22px}}
@media(prefers-reduced-motion:reduce){.card,.card-image img,.duration-card{transition:none}.card:hover,.duration-card:hover{transform:none}}

/* Signature Experience — October 10 approved editorial reference */
.signature-page{background:#fffaf8;color:#66555c}
.signature-page .signature-hero{margin:-80px -42px 0;background:linear-gradient(180deg,#f9e7ed 0%,#faedf0 100%);padding:74px 24px 42px;text-align:center}
.signature-page .signature-hero .eyebrow{font-size:11px;letter-spacing:.16em}
.signature-page .signature-hero h1{font-size:clamp(35px,5.4vw,60px);margin:16px auto 10px;line-height:1.16;max-width:760px}
.signature-page .signature-hero p{font-size:clamp(17px,2vw,21px);font-style:italic;max-width:600px;margin:0 auto;line-height:1.6}
.signature-editorial{max-width:720px;margin:0 auto;padding:30px 8px 0}
.signature-editorial .eyebrow{letter-spacing:.14em;font-size:11px;color:#976f80}
.signature-editorial h2{font-family:'DM Sans',sans-serif;font-size:clamp(27px,3.3vw,36px);font-weight:700;line-height:1.28;letter-spacing:-.035em;color:#614a55;margin:12px 0 22px}
.signature-editorial p{font-size:clamp(16px,1.65vw,18px);line-height:1.67;margin:0 0 18px;color:#6c5961}
.signature-rendezvous{background:#f5e6eb;border-radius:20px;padding:23px 24px 18px;margin:20px 0 28px}
.signature-rendezvous h3{font-family:'DM Sans',sans-serif;font-size:clamp(20px,2.4vw,25px);font-weight:700;letter-spacing:-.025em;color:#674d5b;margin:12px 0}
.signature-rendezvous p{margin:0;line-height:1.57}
.signature-down{display:flex;align-items:center;gap:12px;margin:26px 0 44px;color:#916d80}
.signature-down:before,.signature-down:after{content:'';height:1px;flex:1;background:#e6d6dc}
.signature-down span{display:grid;place-items:center;height:44px;width:44px;border-radius:50%;background:#fffaf8;box-shadow:0 4px 16px #986a7812;font-size:22px}
.signature-page .duration-section{max-width:920px;margin:0 auto 48px}
.signature-page .summary-section{margin-bottom:48px}
@media(max-width:760px){.signature-page .signature-hero{margin:-32px -18px 0;padding:54px 16px 26px}.signature-page .signature-hero h1{font-size:clamp(31px,8.6vw,40px)}.signature-page .signature-hero p{font-size:17px}.signature-editorial{padding:24px 0 0}.signature-editorial h2{font-size:26px;margin:12px 0 19px}.signature-editorial p{font-size:16px;line-height:1.57;margin-bottom:16px}.signature-rendezvous{padding:18px 17px;margin:18px 0 24px}.signature-rendezvous h3{font-size:21px}.signature-down{margin:24px 0 40px}}

/* Signature October 10 duration and selection reference */
.signature-page .duration-section{text-align:center;max-width:780px;margin:0 auto 24px}
.signature-page .duration-section .eyebrow{letter-spacing:.12em}
.signature-page .duration-section h2{font-family:'DM Sans',sans-serif;font-weight:700;font-size:clamp(27px,3.5vw,36px);color:#58404d;line-height:1.22;margin:12px auto 12px;max-width:440px}
.signature-page .duration-section>p{font-size:16px;max-width:none;margin:0 auto 22px}
.signature-page .duration-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;text-align:left}
.signature-page .duration-card{position:relative;min-height:145px;gap:10px;padding:18px 16px;border-radius:22px;border:1.5px solid #e3cbd4;box-shadow:none;color:#573f4b}
.signature-page .duration-card .dur-label{font-size:17px;color:#543e49}
.signature-page .duration-card .dur-price{font-family:'DM Sans',sans-serif;font-size:29px;font-weight:700;color:#543b49}
.signature-page .duration-card .dur-badge{display:block;min-height:0;margin-top:auto;font-size:14px;line-height:1.4;letter-spacing:0;text-transform:none;font-weight:400;opacity:1;color:#715b66}
.signature-page .duration-card[aria-pressed=true]{background:#e6ccd8;border:2px solid #85556e;box-shadow:0 0 0 1px #85556e}
.signature-page .duration-card[aria-pressed=true] .dur-price{color:#503746}
.signature-page .selected-check{display:none;position:absolute;right:15px;top:15px;border:1px solid #835870;color:#835870;width:17px;height:17px;border-radius:50%;font-size:11px;text-align:center;line-height:15px}
.signature-page .duration-card[aria-pressed=true] .selected-check{display:block}
.signature-selection{max-width:780px;margin:24px auto 44px;background:#efdae3;border-radius:22px;padding:24px;color:#58424e}
.signature-selection .eyebrow{letter-spacing:.07em;font-size:12px}
.signature-selection h3{font-family:'DM Sans',sans-serif;font-weight:700;font-size:clamp(24px,3vw,29px);margin:12px 0 10px;color:#503947}
.signature-selection p{font-size:16px;line-height:1.55;margin:0 0 26px}
.signature-selection hr{border:0;border-top:1px solid #dbc2cd;margin:26px 0}
.signature-selection>strong{font-size:16px}.signature-includes{list-style:none;padding:0;margin:18px 0 24px;display:grid;gap:15px}
.signature-includes li{font-size:16px;line-height:1.5;display:flex;gap:12px;align-items:flex-start}.signature-includes li span{font-size:22px;color:#996a81;min-width:23px;line-height:1}
.signature-includes li[hidden]{display:none}
.selection-total{border-top:1px solid #dbc2cd;padding-top:18px;font-size:17px}.selection-total strong{font-size:23px;color:#503947}
.signature-next{display:flex;flex-direction:column;gap:16px;align-items:center;margin:0 auto 55px}.signature-next button:disabled{opacity:.65;cursor:not-allowed}.signature-next .note{margin:0}
@media(max-width:760px){.signature-page .duration-section h2{font-size:27px;max-width:340px}.signature-page .duration-card{padding:15px 12px;min-height:132px;border-radius:19px}.signature-page .duration-card .dur-label{font-size:16px}.signature-page .duration-card .dur-price{font-size:26px}.signature-page .duration-card .dur-badge{font-size:13px}.signature-selection{padding:20px 17px;border-radius:20px}.signature-selection h3{font-size:23px}.signature-selection p,.signature-includes li{font-size:15px}}

/* Reference-matched Signature lower sections */
.signature-page .signature-selection{margin-bottom:22px;padding-bottom:20px;background:#eedbe4}
.signature-page .signature-selection .signature-includes{margin-bottom:0}
.signature-page .signature-appointment{max-width:780px;margin:0 auto 22px;background:#fffdfb;border:1.5px solid #e2d2d9;border-radius:22px;padding:19px 22px 16px;text-align:center;color:#58424e}
.signature-appointment .eyebrow{font-size:12px;letter-spacing:.07em}
.signature-appointment h2{font-family:'DM Sans',sans-serif;font-size:clamp(26px,3.2vw,32px);font-weight:700;color:#513b48;margin:8px 0 22px}
.appointment-detail{display:flex;justify-content:space-between;align-items:center;text-align:left;gap:12px;padding:22px 0 0;border-top:1px solid #e4d5db;font-size:16px}
.appointment-detail+.appointment-detail{border-top:0;padding:18px 0 20px}
.appointment-investment strong{font-size:28px;color:#4f3644}
.appointment-continue{display:flex;align-items:center;justify-content:center;gap:20px;width:100%;background:#211f20;color:#fff;border:0;border-radius:90px;padding:14px 20px;font:600 15px 'DM Sans',sans-serif;opacity:.9;cursor:not-allowed}
.signature-explore{max-width:780px;margin:0 auto 48px;text-align:center}.signature-explore>.eyebrow{margin:18px 0 14px}
.signature-crosslinks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.signature-crosslinks a{background:#fffdfb;border:1.5px solid #e3d3da;border-radius:19px;padding:17px;text-align:left;text-decoration:none;min-height:118px;display:flex;flex-direction:column;justify-content:space-between}
.signature-crosslinks strong{font-size:16px;line-height:1.3;color:#553d4b}.signature-crosslinks a span{font-size:14px;color:#856775}.signature-crosslinks a b{float:right;font-weight:400}
.signature-back{display:block;margin-top:12px;border:1.5px solid #e3d3da;border-radius:60px;padding:13px;text-decoration:none;color:#624b57}
@media(max-width:760px){.signature-page .signature-appointment{padding:17px 16px}.signature-appointment h2{font-size:26px}.appointment-detail{font-size:15px}.appointment-investment strong{font-size:26px}.signature-crosslinks a{padding:14px;min-height:110px}.signature-crosslinks strong{font-size:15px}}

/* Master recording 2026-10-11: matching editorial experience styling */
.editorial-companion .signature-rendezvous.custom-table{background:#fffdfc;border:1px solid #e4ced8;text-align:left;padding:20px;margin-top:24px}
.editorial-companion .custom-table p{margin:14px 0}
.editorial-companion .custom-table .table-refreshments{background:#f3e2e9;padding:16px;border-radius:15px}
.editorial-companion .signature-includes [hidden]{display:none}

/* Four-page master video: photo-first vertically stacked editorial layout */
.overview-master{max-width:760px;margin:0 auto}
.overview-photo{height:240px;overflow:hidden;border-radius:18px 18px 0 0;background:#f0e1e6}
.overview-photo img{display:block;width:100%;height:100%;object-fit:cover}
.overview-master .page-intro{background:#f3e4eb;padding:34px 18px;margin:0 0 28px}
.overview-master .page-intro h1{font-family:'DM Sans',sans-serif;font-size:clamp(29px,4vw,37px);font-weight:700;color:#563f4c;margin:10px auto}
.overview-master .page-intro .intro{font-size:16px;line-height:1.5}
.collection-intro{text-align:center;margin:22px 0 24px}
.collection-intro h2{font-family:'DM Sans',sans-serif;font-size:clamp(25px,3vw,32px);font-weight:700;color:#553c4a;margin:9px 0}
.collection-intro p{margin:0;font-size:16px;line-height:1.5}
.overview-master .cards{grid-template-columns:1fr;max-width:760px;gap:18px}
.overview-master .card{min-height:0;border-radius:22px}
.overview-master .card:hover{transform:none}
.overview-master .card-image{aspect-ratio:1.5}
.overview-master .card-body{padding:19px}
.overview-master .card h2{font-family:'DM Sans',sans-serif;font-size:25px;font-weight:700;color:#503c48;margin:10px 0}
.overview-master .card p{font-size:16px;line-height:1.5;margin:0 0 12px}
.overview-master .card .price-line{margin:0 0 15px;font-weight:400;font-size:14px}
.overview-master .card .link{background:#191919;color:white;font-size:14px;padding:13px}
.reference-detail-photo{width:100%;height:260px;overflow:hidden;background:#f5e5eb}
.reference-detail-photo img{display:block;width:100%;height:100%;object-fit:cover}
.signature-page .reference-detail-photo+.signature-hero{margin-top:0;padding-top:30px}
@media(max-width:760px){.overview-photo{height:195px}.overview-master .page-intro{padding:22px 15px}.overview-master .card-image{aspect-ratio:1.48}.reference-detail-photo{height:220px}.signature-page .reference-detail-photo+.signature-hero{margin:0 -18px;padding:22px 18px}}

/* Screenshot 08:08 AM — Sensual Touch personal introduction and custom table */
.editorial-companion .signature-editorial{background:#fffaf8;padding:24px 16px 0}
.editorial-companion .signature-editorial>.eyebrow{font-size:11px;letter-spacing:.13em;margin-bottom:11px}
.editorial-companion .signature-editorial>h2{font-family:'DM Sans',sans-serif;font-weight:700;font-size:clamp(24px,3vw,30px);line-height:1.23;letter-spacing:-.02em;margin:0 0 17px;color:#513945}
.editorial-companion .signature-editorial>p{font-family:'DM Sans',sans-serif;font-size:16px;line-height:1.52;color:#715c66;margin:0 0 17px}
.editorial-companion .signature-rendezvous.custom-table{background:#fffdfb;border:1px solid #dfc7d3;border-radius:19px;padding:17px 15px 14px;box-shadow:none;margin:21px 0 27px}
.editorial-companion .custom-table .eyebrow{font-size:10px;letter-spacing:.11em;color:#94717e}
.editorial-companion .custom-table h3{font-family:'DM Sans',sans-serif;color:#543b48;font-size:clamp(22px,3vw,27px);font-weight:700;line-height:1.25;margin:11px 0}
.editorial-companion .custom-table p{font-family:'DM Sans',sans-serif;font-size:16px;line-height:1.5;color:#735e68;margin:12px 0}
.editorial-companion .custom-table .table-refreshments{font-size:15px;line-height:1.5;padding:13px 16px 13px 40px;border-radius:12px;background:#f1e0e7;position:relative}
.editorial-companion .custom-table .table-refreshments:before{content:'♧';position:absolute;left:13px;top:12px;color:#90677c;font-size:20px}
@media(max-width:760px){.editorial-companion .signature-editorial{padding:24px 0 0}.editorial-companion .signature-editorial>h2{font-size:24px}.editorial-companion .signature-editorial>p{font-size:16px;line-height:1.5}.editorial-companion .custom-table h3{font-size:23px}.editorial-companion .signature-rendezvous.custom-table{padding:15px 13px}}
.signature-page a.appointment-continue{display:flex;text-decoration:none;cursor:pointer;opacity:1}.signature-page a.appointment-continue:focus-visible{outline:3px solid #96647e;outline-offset:3px}
.signature-page .reserve-section{max-width:780px;margin:20px auto 28px}.signature-page .reserve-section .appointment-continue{width:100%;min-height:54px;text-align:center}.signature-page .reserve-section .appointment-continue span{margin-left:12px}
/* Editorial luxury selection refinement — isolated staging only */
.signature-page .duration-section{max-width:800px;margin-left:auto;margin-right:auto}
.signature-page .duration-cards{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;max-width:730px;margin-left:auto;margin-right:auto}
.signature-page .duration-card{display:grid;grid-template-columns:minmax(0,1fr) auto 18px;grid-template-rows:auto auto;align-items:center;gap:4px 15px;min-height:91px;text-align:left;padding:18px 22px;border:1px solid #e6dbdb;border-radius:14px;background:#fffdfb;box-shadow:none;transform:none}
.signature-page .duration-card[aria-pressed="true"]{border:1px solid #9b7486;background:#faf1f3;box-shadow:none}
.signature-page .duration-card .dur-badge{grid-column:1;grid-row:1;display:block;position:static;border:0;background:transparent;padding:0;margin:0;font-family:Georgia,serif;font-size:19px;font-weight:400;color:#57434d;text-align:left}
.signature-page .duration-card .dur-label{grid-column:1;grid-row:2;position:static;display:block;font-size:14px;color:#85717c;text-align:left}
.signature-page .duration-card .dur-price{grid-column:2;grid-row:1 / span 2;position:static;display:block;font-size:18px;font-weight:500;color:#57434d;text-align:right}
.signature-page .duration-card .selected-check{grid-column:3;grid-row:1 / span 2;position:static;display:block;visibility:hidden;color:#906a7e;font-size:17px}
.signature-page .duration-card[aria-pressed="true"] .selected-check{visibility:visible}
.signature-page .duration-card:hover{transform:none;border-color:#b496a5}
.signature-page .reserve-section{max-width:730px}
.signature-page .reserve-section .appointment-continue{background:#302b2e;color:#fff;border-radius:999px}
@media(max-width:760px){.signature-page .duration-cards{grid-template-columns:minmax(0,1fr)}.signature-page .duration-card{padding:16px;min-height:83px}.signature-page .duration-card .dur-badge{font-size:17px}.signature-page .duration-card .dur-price{font-size:16px}}

.signature-page .linger-note{max-width:760px;margin:26px auto 32px;padding:24px 26px;background:#faf1f1;border:1px solid #e9dadf;border-radius:18px;text-align:center;color:#66515e}.signature-page .linger-note .eyebrow{letter-spacing:.14em;font-size:11px;color:#916b7f}.signature-page .linger-note h3{font-family:Georgia,serif;font-size:clamp(22px,3vw,29px);font-weight:400;color:#543b4a;margin:12px 0}.signature-page .linger-note p{font-size:16px;line-height:1.65;margin:0}@media(max-width:760px){.signature-page .linger-note{margin:22px 12px;padding:21px 17px}}

.signature-page .streamlined-selection{max-width:730px;padding:26px 24px;text-align:center}.signature-page .streamlined-selection .selection-meta{display:flex;align-items:center;justify-content:center;gap:22px;margin:12px 0 0;color:#765e6b}.signature-page .streamlined-selection .selection-meta strong{font-weight:600;color:#523a49;font-size:20px}@media(max-width:760px){.signature-page .streamlined-selection{padding:22px 16px}}

.signature-page .streamlined-selection .selection-perks{max-width:580px;margin:15px auto 0;padding-top:13px;border-top:1px solid #e4cfd9;color:#765d6b;font-size:14px;line-height:1.55}

`;

function layout(body, title) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} | Kendra Bexly — Design Preview</title><style>${style}</style></head><body>
  <header><a href="/our-time/" class="logo">Kendra Bexly</a><nav><a href="/our-time/">Experiences</a><span>Private design preview</span></nav></header>
  <main>${body}</main><footer>Design preview only · No appointments or payments accepted here</footer></body></html>`;
}

function overview() {
  const cards = experiences.map((e) => `<article class="card"><div class="card-image"><img src="${e.heroImg}" alt="${e.title} — placeholder until Kendra adds her photographs" loading="lazy" data-fallback="${e.atmosphereImg}" onerror="if(!this.dataset.retried){this.dataset.retried='1';this.src=this.dataset.fallback}else{this.remove()}"></div><div class="card-body"><div class="eyebrow">${e.index} · ${e.kicker}</div><h2>${e.title}</h2><p>${e.description}</p><div class="price-line">Beginning at ${money(e.durations[0][1])}</div><a class="link" href="/explore-${e.slug}/">Explore ${e.title}　 →</a></div></article>`).join("");
  return layout(`<div class="overview-master"><div class="overview-photo"><img src="https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1400&q=85" alt="Warm inviting lounge — photo placeholder" referrerpolicy="no-referrer"></div><section class="page-intro"><div class="eyebrow">YOUR INVITATION TO SOMETHING MORE</div><h1>Our Time Together</h1><p class="intro">A little romance, a little indulgence, and plenty of attention just for you.</p></section><section class="collection-intro"><div class="eyebrow">THE KENDRA COLLECTION</div><h2>Find Your Beautiful Escape</h2><p>Three ways to enjoy a little escape from the everyday.</p></section><section class="cards">${cards}</section></div>`, "Our Time Together");
}

function signatureDetail(e) {
  const names = ["A Sweet Escape","The Perfect Date","The Romantic Indulgence","An Afternoon to Remember","The Signature Rendezvous"];
  const descriptions = ["A lovely little introduction with warmth and personal attention.","A relaxed date with time for conversation and connection.","A little more time for conversation, sweet moments, and each other's company.","A leisurely date with time for refreshments and the unexpected moments that make it memorable.","A beautiful afternoon together, with a lovely meal and a change of scenery."];
  const durationCards = e.durations.map(([duration, price, refreshments], i) => `<button type="button" class="duration-card" data-duration="${duration}" data-price="${price}" data-name="${names[i]}" data-description="${descriptions[i]}" data-refreshments="${refreshments}" aria-pressed="${i === 2}"><span class="dur-label">${duration}</span><span class="dur-price">${money(price)}</span><span class="dur-badge">${names[i]}</span><span class="selected-check" aria-hidden="true">✓</span></button>`).join("");
  const body = `<div class="signature-page">
  <div class="reference-detail-photo"><img src="${e.heroImg}" alt="${e.title} — photographic placeholder" referrerpolicy="no-referrer"></div><section class="signature-hero"><div class="eyebrow">THE BEAUTY OF CONNECTION</div><h1>The Signature Experience</h1><p>A little romance, a little chemistry, and undivided attention.</p></section>
  <section class="signature-editorial">
    <div class="eyebrow">A PERSONAL EXPERIENCE</div>
    <h2>Let's Make This Date Something Special</h2>
    <p>You know those dates where the conversation just flows and you catch yourself smiling for no particular reason? Those are my favorite kind.</p>
    <p>Signature is my invitation to enjoy that feeling together. A warm welcome, easy conversation, a little flirting, and my undivided attention. Nothing overly rehearsed. Just a beautiful date with room for a genuine connection.</p>
    <p>I want you to feel like you've been invited somewhere special, where the little details have already been thought of and the attention is all yours. There's nothing you need to impress me with. Just bring yourself, a little curiosity, and perhaps your best smile. I'll take it from there.</p>
    <p>I'm a little old-fashioned about romance. I love a gentleman who appreciates good conversation, a little teasing, and those sweet moments when a date starts to feel like we've known each other longer than we have. That's when the chemistry becomes something special.</p>
    <aside class="signature-rendezvous"><div class="eyebrow">THE SIGNATURE RENDEZVOUS</div><h3>A Date Worth Lingering Over</h3><p>Four hours opens up the possibilities. We can enjoy each other's company, step out for a lovely meal, and return to our date without squeezing everything into a schedule. A proper afternoon together has its own kind of charm.</p></aside>
    <div class="signature-down" aria-hidden="true"><span>↓</span></div>
  </section>
  <section class="linger-note"><div class="eyebrow">A LITTLE MORE TIME</div><h3>There’s Beauty in an Unhurried Date</h3><p>Ninety minutes gives us room for conversation, sweet moments, and a little something to enjoy. With two hours, we can make ourselves comfortable and let the date unfold naturally. Sometimes the loveliest moments happen when neither of us is watching the clock.</p></section>
  <section class="duration-section"><div class="eyebrow">CHOOSE YOUR EXPERIENCE LENGTH</div><h2>How Long Shall We Spend Together?</h2><p>Find the appointment length that feels right for you.</p><div class="duration-cards" role="group" aria-label="Appointment duration">${durationCards}</div></section>
  <section class="signature-selection streamlined-selection" aria-live="polite"><div class="eyebrow">YOUR SELECTION</div><h3 id="selection-name">The Romantic Indulgence</h3><p class="selection-meta"><span id="appointment-duration">${e.durations[2][0]}</span><strong id="investment">${money(e.durations[2][1])}</strong></p><p id="selection-perks" class="selection-perks"></p></section>
  <section class="reserve-section"><a class="appointment-continue" href="https://kendrabexly.com/booking/" aria-label="Reserve This Experience on the live booking site">Reserve This Experience <span aria-hidden="true">→</span></a></section>
  <section class="signature-explore"><div class="eyebrow">EXPLORE ANOTHER EXPERIENCE</div><div class="signature-crosslinks"><a href="/explore-sensual-touch/"><strong>The Sensual Touch</strong><span>Explore <b aria-hidden="true">→</b></span></a><a href="/explore-grecian-experience/"><strong>The Grecian Experience</strong><span>Explore <b aria-hidden="true">→</b></span></a></div><a href="/our-time/" class="signature-back">← &nbsp; Back to Experiences</a><p class="note">Design preview only. Continue opens the separate live introduction form; submitting there is not a staging test.</p></section>
  <script>(function(){var cards=document.querySelectorAll('.signature-page .duration-card'),name=document.getElementById('selection-name'),duration=document.getElementById('appointment-duration'),investment=document.getElementById('investment'),perks=document.getElementById('selection-perks');function select(c){cards.forEach(function(x){x.setAttribute('aria-pressed','false')});c.setAttribute('aria-pressed','true');name.textContent=c.dataset.name;duration.textContent=c.dataset.duration;investment.textContent='$'+Number(c.dataset.price).toLocaleString('en-US');var extended=c.dataset.refreshments==='true';var fourHours=c.dataset.duration.toLowerCase().includes('4 hour');perks.textContent=extended?(fourHours?'Included: Adult toys, custom specialty table, light snacks and refreshments, and a lovely meal.':'Included: Adult toys, custom specialty table, light snacks and refreshments.'):'Adult toys, the custom specialty table, and refreshments are included with qualifying longer visits (90 minutes or more).'}cards.forEach(function(c){c.addEventListener('click',function(){select(c)})});if(cards[2])select(cards[2])})()<\/script>
  </div>`;
  return layout(body, e.title);
}


function companionEditorialDetail(e) {
  const sensual = e.slug === "sensual-touch";
  const names = sensual ? ["The Sweet Escape","The Perfect Pause","The Leisurely Indulgence","The Ultimate Unwind"] : ["The First Taste","The Grecian Escape","The Grecian Indulgence","The Grecian Affair","The Elevated Grecian Escape"];
  const descriptions = sensual ? ["A soothing introduction with a little time to relax.","An inviting escape focused on sensual massage and comfort.","More room to settle in, enjoy the custom table, and pause for refreshments.","A leisurely escape with the custom table, a relaxed pace, and refreshments."] : ["A playful introduction with warmth and charm.","A little extra time for chemistry and connection.","Time to settle in, enjoy light refreshments, and explore the specialty touches.","A more leisurely visit, with time for the custom specialty table and personal attention.","An extended adventure with a relaxed pace, refreshments, and a lovely meal."];
  const intro = sensual
    ? ["Some days, it's lovely to put your phone away, close the door on a busy week, and have absolutely nothing to organize.","That's what I had in mind for The Sensual Touch. From the moment you arrive, I want you to feel warmly welcomed, with all the little details taken care of so you can simply enjoy yourself.","Once you're here, I want you to forget about the clock for a while. Enjoy the warmth of the oils, the gentle rhythm of my touch, and the pleasure of having someone pay attention to you for a change. I'll take care of the little details. You just enjoy your moment."]
    : ["I have a soft spot for a gentleman with a curious streak. The kind who appreciates a little surprise and doesn't need every detail spelled out in advance.","Grecian is where I let my playful side come out. There's still that warm welcome you can expect from me, with a more adventurous mood and a few extra details I've chosen especially for the occasion.","You can tell me what you're curious about, and I'll listen. I like keeping things lighthearted, comfortable, and respectful, with room for us to enjoy a date that feels a little less ordinary.","With 90 minutes or more, we have time for refreshments and some of the thoughtful extras, including adult toys and my custom specialty table. For the four-hour experience, we can also make room for a lovely meal outside our private setting.","So bring your curiosity. I'll bring the charm, the thoughtful touches, and a little sparkle of mischief."];
  const heading = sensual ? "This Time Is All About You" : "Let’s Be a Little Adventurous";
  const highlightLabel = sensual ? "THE ART OF UNWINDING" : "THE GRECIAN RENDEZVOUS";
  const highlightTitle = sensual ? "A Little Time, Just for You" : "An Invitation to Linger";
  const highlightText = "My custom massage table adds something different to your visit. Designed to keep you comfortably supported, its unique opening allows me to work above and below the table, creating a more layered and immersive massage experience.";
  const highlightExtra = "Warm oils, soothing touch, and gentle changes in rhythm add to a relaxing escape where you can settle in and enjoy being cared for.";
  const eyebrow = sensual ? "THE ART OF UNWINDING" : "A LITTLE MORE ADVENTUROUS";
  const tagline = sensual ? "A little indulgence. A little escape. All about you." : "For the gentleman who enjoys a little adventure.";
  const durationCards = e.durations.map(([duration,price,refreshments],i)=>`<button type="button" class="duration-card" data-duration="${duration}" data-price="${price}" data-name="${names[i]}" data-description="${descriptions[i]}" data-refreshments="${refreshments}" aria-pressed="${i===2}"><span class="dur-label">${duration}</span><span class="dur-price">${money(price)}</span><span class="dur-badge">${names[i]}</span><span class="selected-check" aria-hidden="true">✓</span></button>`).join("");
  const paragraphs = intro.map(t=>`<p>${t}</p>`).join("");
  const second = sensual ? {slug:"signature-experience",title:"The Signature Experience"} : {slug:"signature-experience",title:"The Signature Experience"};
  const third = sensual ? {slug:"grecian-experience",title:"The Grecian Experience"} : {slug:"sensual-touch",title:"The Sensual Touch"};
  const body = `<div class="signature-page editorial-companion">
   <div class="reference-detail-photo"><img src="${e.heroImg}" alt="${e.title} — photographic placeholder" referrerpolicy="no-referrer"></div><section class="signature-hero"><div class="eyebrow">${eyebrow}</div><h1>${e.title}</h1><p>${tagline}</p></section>
   <section class="signature-editorial"><div class="eyebrow">A PERSONAL EXPERIENCE</div><h2>${heading}</h2>${paragraphs}
    ${sensual ? `<aside class="signature-rendezvous custom-table"><div class="eyebrow">FOR VISITS OF 90 MINUTES OR LONGER</div><h3>The Custom Table Experience</h3><p><em>A little unexpected. A little indulgent. Entirely about you.</em></p><p>${highlightText}</p><p>${highlightExtra}</p><p class="table-refreshments">Light snacks and refreshments are included with 90-minute and two-hour visits.</p></aside>` : ""}<div class="signature-down" aria-hidden="true"><span>↓</span></div></section>
   ${sensual ? "" : `<section class="linger-note"><div class="eyebrow">A LITTLE MORE TIME</div><h3>An Adventure Worth Savoring</h3><p>When we have a little more time together, the date can unfold naturally. And for our four-hour escape, there’s even room to enjoy a lovely meal away from our private setting.</p></section>`}
   <section class="duration-section"><div class="eyebrow">CHOOSE YOUR EXPERIENCE LENGTH</div><h2>${sensual ? "How Long Would You Like to Unwind?" : "How Shall We Spend the Day?"}</h2><p>Find the appointment length that feels right for you.</p><div class="duration-cards" role="group" aria-label="Appointment duration">${durationCards}</div></section>
   <section class="signature-selection streamlined-selection" aria-live="polite"><div class="eyebrow">YOUR SELECTION</div><h3 id="selection-name">${names[2]}</h3><p class="selection-meta"><span id="appointment-duration">${e.durations[2][0]}</span><strong id="investment">${money(e.durations[2][1])}</strong></p><p id="selection-perks" class="selection-perks" aria-live="polite"></p></section>
   <section class="reserve-section"><a class="appointment-continue" href="https://kendrabexly.com/booking/" aria-label="Reserve This Experience on the live booking site">Reserve This Experience <span aria-hidden="true">→</span></a></section>
   <section class="signature-explore"><div class="eyebrow">EXPLORE ANOTHER EXPERIENCE</div><div class="signature-crosslinks"><a href="/explore-${second.slug}/"><strong>${second.title}</strong><span>Explore <b aria-hidden="true">→</b></span></a><a href="/explore-${third.slug}/"><strong>${third.title}</strong><span>Explore <b aria-hidden="true">→</b></span></a></div><a href="/our-time/" class="signature-back">← &nbsp; Back to Experiences</a><p class="note">Design preview only. Continue opens the separate live introduction form; submitting there is not a staging test.</p></section>
   <script>(function(){var cards=document.querySelectorAll('.editorial-companion .duration-card');var title=document.getElementById('selection-name'),price=document.getElementById('investment'),duration=document.getElementById('appointment-duration'),perks=document.getElementById('selection-perks'),sensual=${sensual};function select(c){cards.forEach(function(x){x.setAttribute('aria-pressed','false')});c.setAttribute('aria-pressed','true');title.textContent=c.dataset.name;price.textContent=String.fromCharCode(36)+Number(c.dataset.price).toLocaleString('en-US');duration.textContent=c.dataset.duration;var longer=c.dataset.refreshments==='true';var fourHours=c.dataset.duration.toLowerCase().includes('4 hour');perks.textContent=longer?(sensual?'Included: Custom Table Experience and light snacks and refreshments.':'Included: Adult toys, custom specialty table, and light snacks and refreshments.'+(fourHours?' A lovely meal is included.':'')):(sensual?'Custom Table Experience and refreshments are included with 90-minute and 2-hour visits.':'Specialty amenities and refreshments are included with visits of 90 minutes or longer.')}cards.forEach(function(c){c.addEventListener('click',function(){select(c)})});if(cards[2])select(cards[2])})()</script>
  </div>`;
  return layout(body,e.title);
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
    <div class="hero-image"><img src="${e.heroImg}" alt="${e.title} — editorial photography" loading="eager" referrerpolicy="no-referrer" data-fallback="${e.atmosphereImg}" onerror="if(!this.dataset.retried){this.dataset.retried='1';this.src=this.dataset.fallback}else{this.remove()}"></div>
  </section>
  <section class="exp-desc">
    <div class="exp-desc-grid">
      <div class="exp-desc-text"><div class="eyebrow">The Atmosphere</div><h2>${e.descTitle}</h2>${descParas}</div>
      <div class="exp-desc-image"><img src="${e.atmosphereImg}" alt="${e.title} — atmosphere" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></div>
    </div>
  </section>
  <section class="duration-section">
    <div class="eyebrow">Choose Your Time</div>
    <h2>A little time just for you</h2>
    <p>Choose the time that suits your mood. Longer appointments give us more room to unwind, enjoy the little extras, and settle into the experience.</p>
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
      if (experience) html = experience.slug === "signature-experience" ? signatureDetail(experience) : companionEditorialDetail(experience);
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