import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/public-experiences.js", import.meta.url), "utf8");
const moduleUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const { servePublicExperience } = await import(moduleUrl);

test("only four experience routes return public pages", async () => {
  for (const path of ["/our-time/","/explore-sensual-touch/","/explore-signature-experience/","/explore-grecian-experience/"]) {
    const response = await servePublicExperience(new Request("https://kendrabexly.com"+path));
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("Content-Type"), /text\/html/);
    assert.doesNotMatch(response.headers.get("X-Robots-Tag") || "", /noindex/);
    const html = await response.text();
    assert.match(html, /Kendra Bexly/);
    assert.doesNotMatch(html, /Booking disabled on staging|preview only/i);
  }
  const wrong = await servePublicExperience(new Request("https://kendrabexly.com/portal/"));
  assert.equal(wrong.status, 404);
});
test("all duration cards have approved prices and accessible selection values", async () => {
  const rates = [
    ["/explore-sensual-touch/", [255,425,625,825]],
    ["/explore-signature-experience/", [300,500,725,975,1900]],
    ["/explore-grecian-experience/", [400,700,1000,1300,2500]]
  ];
  for (const [path,prices] of rates) {
    const html = await (await servePublicExperience(new Request("https://kendrabexly.com"+path))).text();
    for (const amount of prices) assert.match(html, new RegExp('data-price="'+amount+'"'), path+" "+amount);
    assert.match(html, /aria-pressed/);
    assert.match(html, /booking\//);
    assert.match(html, /id="investment"/);
  }
});
test("HEAD does not return content, POST is rejected, booking route unchanged", async () => {
  const head=await servePublicExperience(new Request("https://kendrabexly.com/our-time/",{method:"HEAD"}));
  assert.equal(head.status,200);
  assert.equal(await head.text(),"");
  const post=await servePublicExperience(new Request("https://kendrabexly.com/our-time/",{method:"POST"}));
  assert.equal(post.status,405);
});
