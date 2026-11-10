// Playwright smoke test of the panel with the browser mock of Photoshop.
// Usage: node test/browser.js <screenshot-dir>
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const out = process.argv[2] || '.';
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 320, height: 760 }, deviceScaleFactor: 2 });
  const errs = [];
  pg.on('pageerror', e => errs.push('pageerror ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text()); });
  await pg.goto('file://' + path.resolve(__dirname, '../plugin/index.html'));
  await pg.waitForTimeout(1000);
  await pg.screenshot({ path: out + '/w1.png' });
  const st = () => pg.evaluate(() => ({ shape: ChromaPicker.state.colors.shape, fg: CPBridge._mock.fg, bg: CPBridge._mock.bg,
    az: Math.round(ChromaPicker.state.az), fillAz: Math.round(ChromaPicker.state.fillAz), yaw: Math.round(ChromaPicker.state.yaw), target: ChromaPicker.ui.target }));
  const log = async (l) => console.log(l, JSON.stringify(await st()));
  await log('init');
  const vp = await (await pg.$('#viewport')).boundingBox();
  // orbit
  await pg.mouse.move(vp.x + vp.width * 0.5, vp.y + vp.height * 0.8); await pg.mouse.down();
  await pg.mouse.move(vp.x + vp.width * 0.7, vp.y + vp.height * 0.8, { steps: 5 }); await pg.mouse.up(); await pg.waitForTimeout(300);
  await log('orbit');
  // drag key light handle
  const h0 = await (await pg.$('#handle0')).boundingBox();
  await pg.mouse.move(h0.x + h0.width / 2, h0.y + h0.height / 2); await pg.mouse.down();
  await pg.mouse.move(vp.x + vp.width * 0.8, vp.y + vp.height * 0.2, { steps: 6 }); await pg.mouse.up(); await pg.waitForTimeout(300);
  await log('key drag');
  // click fill handle -> fill target
  await pg.evaluate(() => { ChromaPicker.state.fillOn = true; ChromaPicker.refresh(true); }); await pg.waitForTimeout(500);
  const h1 = await (await pg.$('#handle1')).boundingBox();
  await pg.mouse.click(h1.x + h1.width / 2, h1.y + h1.height / 2); await pg.waitForTimeout(200);
  await log('fill click');
  const lt = await (await pg.$('#lightIntRow .track')).boundingBox();
  await pg.mouse.click(lt.x + lt.width * 0.25, lt.y + lt.height / 2); await pg.waitForTimeout(300);
  console.log('fill intensity', await pg.evaluate(() => ChromaPicker.state.fillInt.toFixed(2)));
  await pg.screenshot({ path: out + '/w_fillint.png' });
  // targets
  await pg.click('.target[data-t="sky"]'); await pg.fill('#hexInput', '3366CC'); await pg.press('#hexInput', 'Enter'); await pg.waitForTimeout(200);
  await pg.click('.target[data-t="shape"]');
  // HSB slider
  const tr = await (await pg.$$('#sliders .track'))[0].boundingBox();
  await pg.mouse.click(tr.x + tr.width * 0.6, tr.y + tr.height / 2); await pg.waitForTimeout(300);
  await log('hue');
  await pg.click('#btnMenu'); await pg.waitForTimeout(150); await pg.screenshot({ path: out + '/w_hist.png' });
  await pg.click('#undoBtn'); await pg.waitForTimeout(200); await log('undo');
  for (const id of ['#btnLights', '#btnPresets', '#btnMenu', '#btnMaterial']) {
    await pg.keyboard.press('Escape'); await pg.click(id); await pg.waitForTimeout(250); await pg.screenshot({ path: out + '/w_' + id.slice(4).toLowerCase() + '.png' });
  }
  await pg.keyboard.press('Escape');
  const tt = await (await pg.$('#todTrack')).boundingBox();
  await pg.mouse.click(tt.x + tt.width * 0.75, tt.y + tt.height / 2); await pg.waitForTimeout(500);
  console.log('time', await pg.evaluate(() => [ChromaPicker.state.lightMode, ChromaPicker.state.time.toFixed(1), document.getElementById('modeLabel').textContent]));
  await pg.screenshot({ path: out + '/w_tod.png' });
  await pg.click('#btnFloat'); await pg.waitForTimeout(500); await pg.screenshot({ path: out + '/w_float.png' });
  await pg.click('#btnFloat'); await pg.click('#btnTime'); await pg.waitForTimeout(300);
  console.log('time bar hidden', await pg.evaluate(() => document.getElementById('todBar').classList.contains('hidden')));
  await pg.click('#btnTime');
  await pg.click('#btnSample'); await pg.mouse.click(vp.x + vp.width * 0.5, vp.y + vp.height * 0.5); await pg.waitForTimeout(200); await log('sample');
  await pg.click('#btnLock'); await pg.evaluate(() => { CPBridge._mock.fg = '#11AA55'; }); await pg.waitForTimeout(1500); await log('locked host change');
  await pg.click('#btnLock'); await pg.evaluate(() => { CPBridge._mock.fg = '#AA3366'; }); await pg.waitForTimeout(1500); await log('unlocked host change');
  await pg.keyboard.press('x'); await pg.waitForTimeout(200); await log('swap');
  await pg.click('#btnTrue'); await pg.click('#btnField'); await pg.waitForTimeout(600); await pg.screenshot({ path: out + '/w2.png' });
  for (const m of ['RGB', 'LAB', 'CMYK', 'CUBE', 'HSB']) { await pg.selectOption('#modeSelect', m); await pg.waitForTimeout(100); }
  await pg.setViewportSize({ width: 260, height: 520 }); await pg.waitForTimeout(900); await pg.screenshot({ path: out + '/w_small.png' });
  await pg.setViewportSize({ width: 320, height: 760 }); await pg.waitForTimeout(600);
  await pg.click('#btnMenu'); await pg.click('#layoutSeg button[data-v="classic"]'); await pg.waitForTimeout(400); await pg.keyboard.press('Escape'); await pg.screenshot({ path: out + '/w_classic.png' });
  await pg.click('#btnMenu'); await pg.click('#layoutSeg button[data-v="full"]'); await pg.keyboard.press('Escape');
  await pg.click('#btnMaterial'); await pg.click('#shapeSeg button[data-v="head"]'); await pg.waitForTimeout(200); await pg.screenshot({ path: out + '/w_head_menu.png' });
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(1500); await pg.screenshot({ path: out + '/w_head.png' });
  console.log('head', await pg.evaluate(() => ChromaPicker.state.shape));
  const t0 = Date.now(); await pg.evaluate(() => { for (let i = 0; i < 20; i++) { ChromaPicker.state.az += 3; ChromaPicker.refresh(false); } }); console.log('20 refresh calls ms', Date.now() - t0);
  console.log('errors', errs); await b.close();
})();
