import { chromium } from "playwright";
const OUT="/tmp/claude-0/-home-user-truemax/d2e733fd-a214-5db9-ad53-45f992c4158c/scratchpad";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const [name, vp] of [["phone",{width:430,height:932}],["desk",{width:1440,height:900}]]) {
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  p.on("pageerror", e=>console.log("EXC:", e.message.slice(0,120)));
  await p.goto("http://localhost:5199/", { waitUntil: "load", timeout: 60000 });
  await p.waitForTimeout(4500);
  await p.screenshot({ path: `${OUT}/land-${name}.png` });
  await p.close();
}
await b.close(); console.log("done");
