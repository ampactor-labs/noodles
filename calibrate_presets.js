import puppeteer from "puppeteer-core";

const b = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
         "--enable-unsafe-swiftshader", "--mute-audio"],
});
const p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push(e.message));
p.on("console", msg => console.log("BROWSER:", msg.text()));
await p.goto("http://localhost:5177/", { waitUntil: "networkidle2" });

const offsets = await p.evaluate(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  // We can just access window.__TONE_AUDIO or something if we expose it.
  // Wait, I can inject a script tag that measures and exposes the result!
  // I will just use the UI buttons.
  
  const results = { harmony: {}, bass: {}, melody: {}, drums: {} };
  
  // Try to use the DOM again, but wait for the meter to update.
  // The meters only update when the music is playing.
  document.querySelector('.tbtn-mix').click();
  await wait(500);

  const tracks = ['harmony', 'bass', 'melody', 'drums'];
  for (const track of tracks) {
    const strip = Array.from(document.querySelectorAll('.mx-strip')).find(s => s.dataset.track === track);
    if (!strip) continue;
    
    // Solo the track
    document.querySelectorAll('.mx-btn-s').forEach(b => b.classList.remove('on'));
    strip.querySelector('.mx-btn-s').click();
    
    const select = strip.querySelector('select');
    if (!select) continue;
    
    const options = Array.from(select.options).map(o => o.value);
    const trackResults = {};
    
    for (const opt of options) {
      select.value = opt;
      select.dispatchEvent(new Event('change'));
      
      // play
      document.querySelector('.tbtn.play').click();
      
      let max = -Infinity;
      for (let i = 0; i < 40; i++) {
        await wait(100);
        const peakLabel = strip.querySelector('.mx-peak-label');
        if (peakLabel && peakLabel.textContent && peakLabel.style.display !== 'none') {
          const val = parseInt(peakLabel.textContent);
          if (val > max) max = val;
        }
      }
      document.querySelector('.tbtn.play').click(); // stop
      await wait(200);
      trackResults[opt] = max;
    }
    results[track] = trackResults;
  }
  return results;
});

console.log("FINAL:", JSON.stringify(offsets, null, 2));
await b.close();
