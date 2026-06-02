/**
 * One-off: dump the live Foundry /join page form structure so we can pin the
 * correct selectors in helpers/foundry.js. Run: node inspect-join.mjs
 */
import { chromium } from "@playwright/test";

const URL = process.env.FVTT_URL || "http://localhost:30000";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(URL + "/join", { waitUntil: "networkidle" });

// Give Foundry's client JS a beat to render the form into the page
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const out = { title: document.title, forms: [], selects: [], buttons: [], passwordInputs: [] };
  for (const f of document.querySelectorAll("form")) {
    out.forms.push({ id: f.id, name: f.getAttribute("name"), action: f.action, cls: f.className });
  }
  for (const s of document.querySelectorAll("select")) {
    out.selects.push({
      name: s.getAttribute("name"), id: s.id,
      options: Array.from(s.options).map(o => ({ value: o.value, text: o.textContent.trim() })),
    });
  }
  for (const b of document.querySelectorAll("button")) {
    out.buttons.push({ name: b.getAttribute("name"), type: b.type, text: b.textContent.trim(), cls: b.className });
  }
  for (const i of document.querySelectorAll("input")) {
    out.passwordInputs.push({ name: i.getAttribute("name"), type: i.type, id: i.id });
  }
  return out;
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
