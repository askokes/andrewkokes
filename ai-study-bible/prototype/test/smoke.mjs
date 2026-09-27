// Smoke test for the AI Study Bible prototype.
// Usage: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node test/smoke.mjs [--fixture] [--base http://localhost:8765]
// Drives the page with Playwright, asserts the product behaviours, takes screenshots and fails on any console error.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:8765';
const realData = fs.existsSync(path.join(root, 'data', 'books.json'));
const FIXTURE = args.includes('--fixture') || !realData;
const url = `${base}/index.html${FIXTURE ? '?data=./fixture' : ''}`;
const shots = path.join(here, 'screens', FIXTURE ? 'fixture' : '');
fs.mkdirSync(shots, { recursive: true });

const failures = [];
const passes = [];
const check = (cond, msg) => { (cond ? passes : failures).push(msg); if (!cond) console.log('  FAIL', msg); else console.log('  ok  ', msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Spec section 4.1 (John 3:15-17) is the contract the loader must reproduce.
function specChapter() {
  const spec = fs.readFileSync(path.resolve(root, '..', 'docs', 'DATA_MODEL.md'), 'utf8');
  const m = spec.match(/### 4\.1 [^\n]*\n```json\n([\s\S]*?)\n```/);
  return m ? JSON.parse(m[1]) : null;
}

console.log(`Smoke test: ${url}  (${FIXTURE ? 'fixture' : 'real data'})`);
const browser = await chromium.launch();
// ignoreHTTPSErrors: this sandbox reaches Google Fonts through a TLS-intercepting proxy whose CA Chromium does not trust.
const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'], ignoreHTTPSErrors: true });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push({ text: msg.text(), url: (msg.location() || {}).url || '' }); });
page.on('pageerror', err => consoleErrors.push({ text: `pageerror: ${err.message}`, url: '' }));

const evalState = expr => page.evaluate(expr);
const focusVid = () => page.evaluate(() => +(document.querySelector('.v.focus') || {}).dataset?.vid || 0);
const title = () => page.textContent('#titleText');
const crumbs = () => page.evaluate(() => Array.from(document.querySelectorAll('#crumbs .crumb')).map(c => c.textContent).join(' → '));
async function shot(name) {
  const bb = await page.locator('#phone').boundingBox();
  const file = path.join(shots, name);
  await page.screenshot({ path: file, clip: { x: bb.x - 26, y: bb.y - 26, width: bb.width + 52, height: bb.height + 52 } });
  console.log('  shot', file);
}
async function scrollVerseToFocus(vid) {
  await page.evaluate(v => { const r = document.getElementById('reader'), el = r.querySelector(`.v[data-vid="${v}"]`); r.scrollTop = el.offsetTop - r.clientHeight / 3 + 2; }, vid);
  await page.waitForFunction(v => document.querySelector('.v.focus')?.dataset.vid === String(v), vid, { timeout: 3000 }).catch(() => {});
}
const firstChipLabel = () => page.evaluate(() => document.querySelector('#track .chip[data-rank="1"] .lbl')?.textContent || '');
const waitStrip = () => page.waitForFunction(() => !document.getElementById('marquee').classList.contains('fading') && document.querySelector('#track').children.length > 0, null, { timeout: 3000 });

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.v[data-vid="43003016"]', { timeout: 20000 });
  await page.waitForFunction(() => document.fonts ? document.fonts.status === 'loaded' : true, null, { timeout: 5000 }).catch(() => {});
  await sleep(400);

  // 1. Opens complete: John 3 with verse 16 in focus and the ticker running.
  check((await title()) === 'John 3', 'opens on John 3');
  check((await focusVid()) === 43003016, 'verse 16 is in focus at rest');
  await waitStrip();
  check((await firstChipLabel()) === 'Romans 5:8', 'rank-1 chip for John 3:16 is Romans 5:8');

  // 2. Focus follows the reader: scroll to the top, then bring verse 16 back into the focus band.
  await page.waitForFunction(() => performance.now() > window.asb.state.focusLockUntil, null, { timeout: 3000 });
  await page.evaluate(() => { document.getElementById('reader').scrollTop = 0; });
  await page.waitForFunction(() => document.querySelector('.v.focus')?.dataset.vid === '43003001', null, { timeout: 3000 }).catch(() => {});
  check((await focusVid()) === 43003001, 'scrolling to the top focuses verse 1');
  await scrollVerseToFocus(43003016);
  check((await focusVid()) === 43003016, 'scrolling verse 16 into the focus band focuses it');
  await waitStrip();
  check((await firstChipLabel()) === 'Romans 5:8', 'ticker re-anchors on Romans 5:8');
  const meta = await page.textContent('#stripMeta');
  check(/110 connections/.test(meta) && /\+98 more/.test(meta), `strip meta shows counts: "${meta}"`);
  check(await page.$('#track .chip.cross[data-rank="1"]') !== null, 'cross-book chip carries the cross accent');
  const t1 = await page.evaluate(() => document.getElementById('track').style.transform);
  await sleep(350);
  const t2 = await page.evaluate(() => document.getElementById('track').style.transform);
  check(t1 !== t2, 'marquee is moving');
  const dwell = await page.evaluate(() => window.asb.state.ticker.dwell.slice(0, 2));
  check(Math.abs(dwell[0] - 2.8) < 1e-9, `dwell for weight 1.0 is 2.8 s (got ${dwell[0]})`);
  await shot('01-reader.png');

  // 3. Loader reproduces spec 4.1 exactly (ids, refs, labels, snippets, ranking fields).
  const spec = specChapter();
  if (spec) {
    let mismatches = 0, compared = 0;
    for (const sv of spec.verses) {
      const pv = await page.evaluate(vid => window.asb.verseOf(vid), sv.vid);
      for (const k of ['ref', 'label', 'text']) { compared++; if (pv[k] !== sv[k]) { mismatches++; console.log('   spec mismatch', sv.label, k, JSON.stringify(pv[k]), 'vs', JSON.stringify(sv[k])); } }
      for (const k of Object.keys(sv.counts)) { compared++; if (pv.counts[k] !== sv.counts[k]) { mismatches++; console.log('   spec mismatch', sv.label, 'counts.' + k, pv.counts[k], 'vs', sv.counts[k]); } }
      sv.ticker.forEach((sc, i) => {
        const pc = pv.ticker[i] || {};
        for (const k of ['rank', 'direction', 'votesOut', 'votesIn', 'score', 'weight', 'tier', 'sameBook', 'snippet']) { compared++; if (JSON.stringify(pc[k]) !== JSON.stringify(sc[k])) { mismatches++; console.log('   spec mismatch', sv.label, '#' + sc.rank, k, JSON.stringify(pc[k]), 'vs', JSON.stringify(sc[k])); } }
        for (const k of ['to', 'viaRange']) { compared++; if (JSON.stringify(pc[k]) !== JSON.stringify(sc[k])) { mismatches++; console.log('   spec mismatch', sv.label, '#' + sc.rank, k, JSON.stringify(pc[k]), 'vs', JSON.stringify(sc[k])); } }
      });
    }
    check(mismatches === 0, `expanded bundle matches spec 4.1 (${compared} fields compared, ${mismatches} mismatches)`);
  }

  // 4. Peek sheet.
  await page.click('#pauseBtn');
  check(await page.evaluate(() => document.getElementById('marquee').classList.contains('hold')), 'pause switches the strip to hold mode');
  await page.click('#track .chip[data-rank="1"]');
  await page.waitForSelector('#peekSheet.on', { timeout: 3000 });
  await sleep(450);
  const peekText = await page.textContent('#peekBody');
  check(/178/.test(peekText) && /33/.test(peekText), 'peek shows cited 178 and cites back 33');
  check(/Romans 5:8/.test(await page.textContent('#peekTitle')), 'peek title is Romans 5:8');
  check(await page.$('#peekBody .ai-box:not(.muted)') !== null, 'peek shows the cached AI why note');
  check(/While we were still sinners/.test(peekText), 'peek shows the target passage text');
  await shot('02-peek.png');

  // 5. Go and trail.
  await page.click('#peekGo');
  if (FIXTURE) {
    await page.waitForSelector('#toast.on', { timeout: 3000 });
    const toastText = await page.textContent('#toast');
    check(/not in the fixture/.test(toastText), `missing pack is handled gracefully: "${toastText}"`);
    check((await title()) === 'John 3', 'reader stays on John 3 when the target is missing');
    await page.click('#peekSheet [data-close]');
    await sleep(300);
    await page.click('#track .chip[data-rank="3"]');
    await page.waitForSelector('#peekSheet.on', { timeout: 3000 });
    await sleep(300);
    check(/John 3:15/.test(await page.textContent('#peekTitle')), 'same-book chip John 3:15 peeks');
    await page.click('#peekGo');
    await sleep(500);
    check((await focusVid()) === 43003015, 'Go lands on John 3:15');
    check((await crumbs()) === 'John 3:16 → John 3:15', `trail reads ${await crumbs()}`);
  } else {
    await page.waitForFunction(() => document.getElementById('titleText').textContent === 'Romans 5', null, { timeout: 5000 });
    await sleep(400);
    check((await focusVid()) === 45005008, 'Go lands on Romans 5:8 in focus');
    check(await page.$('.v.hl[data-vid="45005008"]') !== null, 'target range is highlighted after the jump');
    check((await crumbs()) === 'John 3:16 → Romans 5:8', `trail reads ${await crumbs()}`);
    await waitStrip();
    check((await firstChipLabel()).length > 0, `Romans 5:8 ticker filled (rank 1: ${await firstChipLabel()})`);
  }
  check(await page.evaluate(() => !document.getElementById('peekSheet').classList.contains('on')), 'peek sheet closes after Go');
  await shot('03-trail.png');

  // 6. Back and Forward.
  await page.click('#backBtn');
  await sleep(500);
  check((await title()) === 'John 3' && (await focusVid()) === 43003016, 'Back returns to John 3:16');
  check(await page.evaluate(() => !document.getElementById('fwdBtn').disabled), 'Forward becomes available after Back');
  await page.click('#fwdBtn');
  await sleep(500);
  check((await focusVid()) === (FIXTURE ? 43003015 : 45005008), 'Forward returns to the jump target');
  await page.click('#backBtn');
  await sleep(500);
  check((await focusVid()) === 43003016, 'Back again returns to John 3:16');

  // 7. Trail object matches spec 4.3 shape.
  const trail = await evalState('window.asb.state.trail');
  check(trail.schema === 'asb.trail/2' && Array.isArray(trail.hops) && Array.isArray(trail.forward) && Array.isArray(trail.peeks) && trail.web && trail.rules, 'trail has the spec 4.3 top-level shape');
  check(trail.hops[0].kind === 'open' && trail.hops[0].vid === 43003016 && trail.hops[0].via === null, 'hop 0 is kind open at John 3:16');
  const jumpHop = trail.forward[0];
  check(jumpHop && jumpHop.kind === 'jump' && jumpHop.via && jumpHop.via.from.vid === 43003016 && jumpHop.via.rank === (FIXTURE ? 3 : 1), 'jump hop carries via from John 3:16 with the chip rank');
  check(jumpHop && jumpHop.via.votesOut === (FIXTURE ? 90 : 178), `jump via votesOut = ${jumpHop && jumpHop.via.votesOut}`);
  check(trail.web.nodes.length === 2 && trail.web.edges.length === 1 && trail.web.edges[0][0] === 43003016, 'web has 2 nodes and 1 travelled edge');
  check(trail.peeks.length >= 1 && trail.peeks.some(p => p.jumped) && trail.peek === null, 'peeks are recorded and the jumped one is marked');
  check(trail.rules.pushOn.join() === 'open,jump,search,bookmarkOpen' && trail.rules.scrollUpdatesCurrentHop === true, 'trail rules match the spec');
  check(trail.hops[0].scroll.anchor === 43003016, 'scroll updates the current hop anchor without pushing');

  // 8. Web overlay and copy.
  await page.click('#webBtn');
  await page.waitForSelector('#webOverlay.on', { timeout: 3000 });
  await sleep(450);
  const svgStats = await page.evaluate(() => ({ circles: document.querySelectorAll('#webSvg circle').length, lines: document.querySelectorAll('#webSvg line').length, dashed: document.querySelectorAll('#webSvg line[stroke-dasharray]').length }));
  check(svgStats.circles >= 2 && svgStats.lines >= 1, `web draws ${svgStats.circles} nodes and ${svgStats.lines} edges (${svgStats.dashed} peek-only)`);
  await shot('04-web.png');
  await page.click('#copyTrail');
  await sleep(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  const expected = await page.evaluate(() => JSON.stringify(window.asb.state.trail, null, 2));
  const fallbackShown = await page.evaluate(() => document.getElementById('jsonSheet').classList.contains('on') && !document.getElementById('jsonTa').hidden);
  check(clip === expected || fallbackShown, clip === expected ? 'Copy trail JSON put the trail on the clipboard' : 'Copy trail JSON fell back to a selectable textarea');
  if (fallbackShown) await page.click('#jsonSheet [data-close]');
  await page.click('#viewTrail');
  await page.waitForSelector('#jsonSheet.on', { timeout: 3000 });
  check(/"schema": "asb\.trail\/2"/.test(await page.textContent('#jsonPre')), 'trail JSON view shows the trail document');
  await page.click('#jsonSheet [data-close]');
  await page.click('#webClose');
  await sleep(400);

  // 9. Verse JSON view and AI verse note.
  await page.click('#jsonBtn');
  await page.waitForSelector('#jsonSheet.on', { timeout: 3000 });
  const vjson = await page.textContent('#jsonPre');
  check(/"vid": 43003016/.test(vjson) && /"aiStatus": "cached"/.test(vjson) && /"status": "cached"/.test(vjson), 'verse JSON view shows John 3:16 with cached AI status');
  await page.click('#jsonSheet [data-close]');
  await sleep(300);
  check(await page.$('.ai-pill[data-ai="43003016"]') !== null, 'John 3:16 carries the AI note affordance');
  await page.click('.ai-pill[data-ai="43003016"]');
  await page.waitForSelector('#aiSheet.on', { timeout: 3000 });
  check(/AI-generated study aid/.test(await page.textContent('#aiBody')) && /Nicodemus/.test(await page.textContent('#aiBody')), 'AI note card opens with the sample note');
  await page.click('#aiSheet [data-close]');
  await sleep(300);

  // 10. See all list.
  await page.click('#track .chip[data-rank="1"]');
  await page.waitForSelector('#peekSheet.on', { timeout: 3000 });
  await page.click('#peekAll');
  await page.waitForSelector('#listSheet.on', { timeout: 3000 });
  await sleep(300);
  const listCount = await page.evaluate(() => document.querySelectorAll('#listBody .chip').length);
  check(listCount === 12 && /\+98 more live in the full dataset/.test(await page.textContent('#listBody')), 'See all lists the 12 inlined chips and the +more note');
  await page.click('#listSheet [data-close]');
  await sleep(300);

  // 11. Reference parsing and search.
  const parsed = await page.evaluate(() => ['Rom 5:8', '1 John 4:9', 'John 3', 'Ps 22:1', 'Song of Songs 2:1', 'nonsense 9'].map(q => window.asb.parseRef(q)));
  check(parsed[0]?.bookNo === 45 && parsed[0].chapter === 5 && parsed[0].verse === 8, 'parses "Rom 5:8"');
  check(parsed[1]?.bookNo === 62 && parsed[1].chapter === 4 && parsed[1].verse === 9, 'parses "1 John 4:9"');
  check(parsed[2]?.bookNo === 43 && parsed[2].chapter === 3 && parsed[2].verse === null, 'parses "John 3"');
  check(parsed[3]?.bookNo === 19 && parsed[3].chapter === 22 && parsed[3].verse === 1, 'parses "Ps 22:1"');
  check(parsed[4]?.bookNo === 22 && parsed[5] === null, 'parses "Song of Songs 2:1" and rejects nonsense');
  await page.click('#searchBtn');
  await page.fill('#searchInput', FIXTURE ? 'John 3:1' : 'Ps 22:1');
  await page.press('#searchInput', 'Enter');
  await sleep(600);
  if (FIXTURE) {
    check((await focusVid()) === 43003001, 'search "John 3:1" focuses John 3:1');
  } else {
    check((await title()) === 'Psalm 22' && (await focusVid()) === 19022001, 'search "Ps 22:1" opens Psalm 22:1');
    await waitStrip();
    const ps = await page.evaluate(() => window.asb.verseOf(19022001).ticker.slice(0, 3).map(c => [c.to.label, c.aiStatus]));
    check(ps.some(c => /Matthew 27:46/.test(c[0]) && c[1] === 'cached'), `Psalm 22:1 chips include Matthew 27:46 with an AI note (${JSON.stringify(ps)})`);
  }
  const lastHop = await evalState('window.asb.state.trail.hops[window.asb.state.trail.cursor].kind');
  check(lastHop === 'search', 'search pushes a hop of kind search');

  // 12. Book and chapter picker.
  await page.click('#titleBtn');
  await page.waitForSelector('#pickerSheet.on', { timeout: 3000 });
  await sleep(300);
  const bookCount = await page.evaluate(() => document.querySelectorAll('#pickerBody .book-btn').length);
  check(bookCount === 66, `picker lists ${bookCount} books in two columns`);
  await page.click('#pickerBody .book-btn[data-book="43"]');
  await sleep(200);
  check(await page.evaluate(() => document.querySelectorAll('#pickerBody .grid button').length) === 21, 'John shows a 21-chapter grid');
  await page.click('#pickerBody .grid button[data-ch="3"]');
  await sleep(600);
  check((await title()) === 'John 3' && (await evalState('window.asb.state.trail.hops[window.asb.state.trail.cursor].kind')) === 'open', 'picker opens John 3 with a hop of kind open');

  // 13. Omitted verse rendering (real data only: Matthew 17:21 is empty in the BSB).
  if (!FIXTURE) {
    await page.evaluate(() => window.asb.navigate({ bookNo: 40, chapter: 17, vid: 40017021, kind: 'open' }));
    await sleep(500);
    check(await page.$('.v.omitted[data-vid="40017021"] .tag') !== null, 'Matthew 17:21 renders as an omitted verse');
    check(/No cross references|connections/.test(await page.textContent('#stripMeta')), 'strip handles an omitted verse');
    await page.evaluate(() => window.asb.navigate({ bookNo: 43, chapter: 3, vid: 43003016, kind: 'open' }));
    await sleep(500);
  }

  // 14. Reduce motion toggle.
  await page.click('#motionToggle');
  await sleep(200);
  check(await page.evaluate(() => document.getElementById('marquee').classList.contains('hold') && document.getElementById('motionToggle').getAttribute('aria-checked') === 'false' && window.asb.state.reduceMotion === true), 'Motion switch off (reduce motion) puts the strip in hold mode');
  await page.click('#motionToggle');
  await page.click('#pauseBtn');
  await sleep(400);
  check(await page.evaluate(() => !document.getElementById('marquee').classList.contains('hold')), 'strip resumes when motion is back on');

  // 15. Dark mode.
  await page.emulateMedia({ colorScheme: 'dark' });
  await sleep(400);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(bg === 'rgb(5, 6, 8)', `dark mode applies a true dark palette (body ${bg})`);
  await shot('05-dark.png');
  await page.emulateMedia({ colorScheme: 'light' });

  // 16. Phone-width layout: no bezel, no horizontal scroll.
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  mobile.on('console', msg => { if (msg.type() === 'error') consoleErrors.push({ text: msg.text(), url: (msg.location() || {}).url || '' }); });
  mobile.on('pageerror', err => consoleErrors.push({ text: `pageerror: ${err.message}`, url: '' }));
  await mobile.goto(url, { waitUntil: 'load' });
  await mobile.waitForSelector('.v[data-vid="43003016"]', { timeout: 20000 });
  await sleep(600);
  const m = await mobile.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, island: getComputedStyle(document.querySelector('.island')).display, pw: document.getElementById('phone').getBoundingClientRect().width }));
  check(m.sw <= m.iw && m.island === 'none' && Math.round(m.pw) === 390, `phone width fills the viewport without a bezel or horizontal scroll (${JSON.stringify(m)})`);
  await mobile.screenshot({ path: path.join(shots, '06-mobile.png') });
  console.log('  shot', path.join(shots, '06-mobile.png'));
  await mobile.close();

  // 17. Console errors: only 404s the app handled on purpose are tolerated (missing optional files).
  const handled = await page.evaluate(() => window.asb.state.missing);
  const fontNoise = consoleErrors.filter(e => /Failed to load resource/.test(e.text) && /fonts\.(googleapis|gstatic)\.com/.test(e.url));
  if (fontNoise.length) console.log(`  note  ${fontNoise.length} Google Fonts request(s) failed in this sandbox (the page falls back to the system serif); not counted as app errors`);
  const real = consoleErrors.filter(e => !fontNoise.includes(e) && !(/Failed to load resource/.test(e.text) && handled.some(u => e.url.endsWith(u.replace(/^\.\//, '/')) || e.url.includes(u.replace(/^\.\//, '')))));
  const handledCount = consoleErrors.length - real.length - fontNoise.length;
  check(real.length === 0, real.length ? `console errors: ${JSON.stringify(real)}` : `no console errors (${handledCount} handled 404s: ${handled.join(', ') || 'none'})`);
} catch (e) {
  failures.push(`exception: ${e.stack || e}`);
  console.log('  EXCEPTION', e.stack || e);
  await shot('99-failure.png').catch(() => {});
}
await browser.close();
console.log(`\n${passes.length} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach(f => console.log(' -', f)); process.exit(1); }
