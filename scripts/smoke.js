import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
         "--enable-unsafe-swiftshader", "--mute-audio"],
});
const p = await b.newPage();
await p.setViewport({ width: 390, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:5173/noodles/", { waitUntil: "networkidle2" });
await new Promise(r => setTimeout(r, 500));
await p.screenshot({ path: "shot.png" });
console.log("errors:", errs.length ? errs.join("|") : "none");
await b.close();
