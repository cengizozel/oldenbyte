#!/usr/bin/env node
// Puts screenshots inside drawn devices and writes one picture, for the
// READMEs (docs/device-frames.md). The devices are drawn here in HTML and CSS,
// so nothing is downloaded and no maker's artwork is used.
//
//   node tools/device-frames/make.mjs spec.json
//
// spec.json: { out, gap?, pad?, background?, items: [ { frame, image, height, ... } ] }
// frame: iphone | android | fold | macbook | thinkpad | surface | chrome | firefox
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const specPath = resolve(process.argv[2] ?? "");
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const here = dirname(specPath);
const url = p => pathToFileURL(resolve(here, p)).href;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// A window's title strip, for a laptop that shows an app and not a web page.
function titleBar(os, title) {
  if (os === "mac") return `<div class="tb mac"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><b>${esc(title)}</b></div>`;
  if (os === "windows") return `<div class="tb win"><b>${esc(title)}</b><span>&#x2013;</span><span>&#x25A1;</span><span>&#x2715;</span></div>`;
  if (os === "linux") return `<div class="tb lin"><b>${esc(title)}</b><span>&#x2715;</span></div>`;
  return "";
}

function browserBar(kind, it) {
  const tab = esc(it.tab ?? "New Tab"), addr = esc(it.address ?? "");
  const ext = `<img class="ext" src="${url(it.icon)}">`;
  if (kind === "chrome") return `
    <div class="cr-tabs"><span class="dots"><i></i><i></i><i></i></span><div class="cr-tab">${tab}<u>&#x2715;</u></div><span class="plus">+</span></div>
    <div class="cr-bar"><span class="nav">&#x2190; &#x2192; &#x21BB;</span><div class="omni">${addr || "Search or type a URL"}</div>${ext}<span class="nav">&#x22EE;</span></div>`;
  return `
    <div class="ff-tabs"><div class="ff-tab">${tab}<u>&#x2715;</u></div><span class="plus">+</span><span class="wc">&#x2013; &#x25A1; &#x2715;</span></div>
    <div class="ff-bar"><span class="nav">&#x2190; &#x2192; &#x21BB;</span><div class="omni ff">${addr || "Search or enter address"}</div>${ext}<span class="nav">&#x2261;</span></div>`;
}

function item(it) {
  const img = `<img class="shot" src="${url(it.image)}">`;
  const h = it.height;
  switch (it.frame) {
    case "iphone": return `<div class="phone iphone" style="--h:${h}px">${img}<div class="island"></div></div>`;
    case "android": return `<div class="phone android" style="--h:${h}px">${img}<div class="hole"></div></div>`;
    case "fold": return `<div class="phone fold" style="--h:${h}px">${img}<div class="crease"></div></div>`;
    case "macbook": case "thinkpad": case "surface": {
      const tb = it.os ? titleBar(it.os, it.title ?? "oldenbyte") : "";
      return `<div class="laptop ${it.frame}" style="--h:${h}px"><div class="lid"><div class="screen">${tb}${img}</div>${it.frame === "macbook" ? '<div class="notch"></div>' : ""}</div><div class="base"><div class="lip"></div></div></div>`;
    }
    case "chrome": case "firefox": {
      const pop = it.popup ? `<img class="popup" style="width:${it.popupWidth ?? 220}px" src="${url(it.popup)}">` : "";
      return `<div class="browser ${it.frame}" style="--h:${h}px">${browserBar(it.frame, it)}<div class="page">${img}${pop}</div></div>`;
    }
    default: throw new Error(`unknown frame: ${it.frame}`);
  }
}

const css = `
*{box-sizing:border-box;margin:0}
body{font:13px/1.3 system-ui,"Inter","DejaVu Sans",sans-serif;background:transparent}
#stage{display:inline-flex;align-items:flex-end;gap:${spec.gap ?? 56}px;padding:${spec.pad ?? 64}px;background:${spec.background ?? "linear-gradient(160deg,#1c1f24,#101113)"};border-radius:28px}
.shot{display:block}
/* phones: the height is the body's; the screen keeps the screenshot's shape */
.phone{position:relative;height:var(--h);padding:calc(var(--h)*.014);background:#0b0b0c;border-radius:calc(var(--h)*.075);box-shadow:0 0 0 2px #3a3d42,0 0 0 4px #17181a,0 30px 60px #0009}
.phone .shot{height:100%;border-radius:calc(var(--h)*.062)}
.iphone .island{position:absolute;top:calc(var(--h)*.026);left:50%;width:calc(var(--h)*.135);height:calc(var(--h)*.038);margin-left:calc(var(--h)*-.0675);border-radius:99px;background:#000}
.android{border-radius:calc(var(--h)*.058)}.android .shot{border-radius:calc(var(--h)*.046)}
.android .hole{position:absolute;top:calc(var(--h)*.024);left:50%;width:calc(var(--h)*.02);height:calc(var(--h)*.02);margin-left:calc(var(--h)*-.01);border-radius:50%;background:#000}
.fold{border-radius:calc(var(--h)*.05)}.fold .shot{border-radius:calc(var(--h)*.038)}
.fold .crease{position:absolute;top:1.4%;bottom:1.4%;left:50%;width:calc(var(--h)*.012);margin-left:calc(var(--h)*-.006);background:linear-gradient(90deg,#0000,#0003 45%,#fff1 55%,#0000)}
/* laptops: the height is the screen's */
.laptop{display:flex;flex-direction:column;align-items:center;margin:0 calc(var(--h)*.13)}
.lid{position:relative;padding:calc(var(--h)*.028);background:#0b0b0c;border-radius:calc(var(--h)*.04) calc(var(--h)*.04) 0 0;box-shadow:0 0 0 2px #3a3d42}
.screen{height:var(--h);display:flex;flex-direction:column;overflow:hidden;border-radius:4px;background:#111}
.screen .shot{flex:1;min-height:0;height:100%;width:auto;object-fit:cover;object-position:top}
.base{width:114%;height:calc(var(--h)*.036);background:linear-gradient(#c9ccd1,#8d9096);border-radius:0 0 calc(var(--h)*.03) calc(var(--h)*.03);position:relative;box-shadow:0 26px 40px #0008}
.base .lip{position:absolute;top:0;left:50%;width:16%;margin-left:-8%;height:38%;background:#6f7278;border-radius:0 0 99px 99px}
.macbook .notch{position:absolute;top:calc(var(--h)*.028);left:50%;width:calc(var(--h)*.2);height:calc(var(--h)*.03);margin-left:calc(var(--h)*-.1);background:#0b0b0c;border-radius:0 0 8px 8px}
.thinkpad .lid{padding:calc(var(--h)*.04) calc(var(--h)*.03) calc(var(--h)*.05);border-radius:calc(var(--h)*.02) calc(var(--h)*.02) 0 0;background:#141415}
.thinkpad .base{background:linear-gradient(#3a3a3d,#1d1d1f);box-shadow:0 0 0 1px #4a4a4e,0 26px 40px #0008;border-radius:0 0 calc(var(--h)*.016) calc(var(--h)*.016)}
.thinkpad .base .lip{background:#d22;width:1.4%;margin-left:-.7%;height:44%;top:20%;border-radius:50%}
.surface .lid{border-radius:calc(var(--h)*.03);padding:calc(var(--h)*.03);box-shadow:0 0 0 2px #55595f}
.surface .base{width:100%;height:calc(var(--h)*.05);background:linear-gradient(#3b4a63,#27324a);border-radius:0 0 calc(var(--h)*.02) calc(var(--h)*.02);margin-top:calc(var(--h)*-.01)}
.surface .base .lip{display:none}
/* a window's title strip */
.tb{flex:none;height:calc(var(--h)*.045);display:flex;align-items:center;gap:calc(var(--h)*.012);padding:0 calc(var(--h)*.018);font-size:calc(var(--h)*.022);color:#cfd2d6;background:#232427}
.tb b{font-weight:500}.tb i{width:calc(var(--h)*.019);height:calc(var(--h)*.019);border-radius:50%}
.tb.mac b{flex:1;text-align:center;margin-right:calc(var(--h)*.09)}
.tb.win{background:#1f1f1f}.tb.win b{flex:1}.tb.win span,.tb.lin span{width:calc(var(--h)*.05);text-align:center}
.tb.lin{background:#2b2b2e}.tb.lin b{flex:1;text-align:center;margin-left:calc(var(--h)*.05)}
/* browser windows: the height is the page's */
.browser{display:flex;flex-direction:column;border-radius:12px;overflow:hidden;box-shadow:0 0 0 1px #3a3d42,0 30px 60px #0009;color:#cfd2d6}
.browser .page{position:relative;height:var(--h)}.browser .page .shot{height:100%}
.popup{position:absolute;top:6px;right:44px;border-radius:10px;box-shadow:0 0 0 1px #4a4d52,0 18px 40px #000b}
.ext{width:20px;height:20px;border-radius:5px;margin:0 6px;outline:2px solid #ffffff55;outline-offset:3px}
.nav{letter-spacing:6px;font-size:15px;color:#9a9da3;padding:0 6px}.plus{font-size:18px;color:#9a9da3;padding:0 10px}
.omni{flex:1;height:30px;border-radius:15px;background:#1f2023;display:flex;align-items:center;padding:0 14px;color:#9a9da3}
.cr-tabs{display:flex;align-items:flex-end;height:40px;background:#1f2023;padding:0 10px}
.dots{display:flex;gap:7px;padding:0 12px 13px 4px}.dots i{width:11px;height:11px;border-radius:50%;background:#55585d}
.cr-tab{height:32px;min-width:210px;background:#35363a;border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:space-between;padding:0 12px}
.cr-tab u,.ff-tab u{text-decoration:none;font-size:11px;color:#9a9da3}
.cr-bar{display:flex;align-items:center;height:42px;background:#35363a;padding:0 8px}
.ff-tabs{display:flex;align-items:center;height:44px;background:#1c1b22;padding:0 8px}
.ff-tab{height:34px;min-width:210px;background:#2b2a33;border-radius:6px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;box-shadow:0 0 0 1px #4a4a55}
.wc{margin-left:auto;letter-spacing:14px;color:#9a9da3;padding-right:6px}
.ff-bar{display:flex;align-items:center;height:42px;background:#2b2a33;padding:0 8px}
.omni.ff{border-radius:6px;background:#1c1b22}
`;

const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="stage">${spec.items.map(item).join("")}</div>`;

const pw = (await import(process.env.PLAYWRIGHT ?? "playwright")).default;
const browser = await pw.chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 4000, height: 2400 }, deviceScaleFactor: spec.scale ?? 1 });
// From a file, not set as content: a blank page may not load local pictures.
const tmp = resolve(here, `${spec.out}.html`);
writeFileSync(tmp, html);
await page.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0));
await page.locator("#stage").screenshot({ path: resolve(here, spec.out), omitBackground: true });
await browser.close();
rmSync(tmp);
console.log("wrote", resolve(here, spec.out));
