// Visual sweep: boots the preview build (run `npm run build` + `vite preview
// --port 8123` first), rides several breaks and saves screenshots to
// /tmp/tsunami. Uses the puppeteer install under reference/surf-game (a dev
// convenience, not a project dependency).
import { createRequire } from 'module';
const require = createRequire(new URL('./reference/surf-game/package.json', import.meta.url));
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch {
  console.log('puppeteer not found under reference/surf-game — skipping visual sweep');
  process.exit(0);
}

const PAGE = process.env.URL || 'http://localhost:8123/';
const OUT = process.env.OUT || '/tmp/tsunami';
import { mkdirSync } from 'fs';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message));

await page.goto(PAGE, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction(() => window.__game, { timeout: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(8000); // shader compile + first frames under swiftshader
await page.screenshot({ path: `${OUT}/menu.png` });

const rides = process.env.LEVELS
  ? JSON.parse(process.env.LEVELS)
  : [[0, 'maverick'], [4, 'nazare'], [2, 'teahupoo'], [9, 'gold'], [1, 'firstlight']];
for (const [i, name] of rides) {
  await page.evaluate((idx) => {
    const g = window.__game;
    g.startRun(g.levelMenu.levels[idx]);
  }, i);
  await sleep(8000);
  await page.screenshot({ path: `${OUT}/ride-${name}.png` });
  console.log(name, await page.evaluate(() => ({
    state: window.__game.state, speed: +window.__game.rider.speed.toFixed(1),
  })));
}
await browser.close();
console.log('done ->', OUT);
