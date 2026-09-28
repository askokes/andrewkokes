// Smoke test for the Dynamic Study Bible prototype (real data in prototype/data/).
// Usage: python3 -m http.server 8765 --directory prototype   (in another shell)
//        PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node prototype/test/smoke.mjs [--base http://localhost:8765]
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
const url = `${base}/index.html`;
const shots = path.join(here, 'screens');
fs.mkdirSync(shots, { recursive: true });

const failures = [];
const passes = [];
const check = (cond, msg) => { (cond ? passes : failures).push(msg); console.log(cond ? '  ok  ' : '  FAIL', msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Spec section 4.1 (John 3:15-17) is the contract the loader must reproduce.
function specChapter() {
  const file = path.resolve(root, '..', 'docs', 'DATA_MODEL.md');
  if (!fs.existsSync(file)) return null;
  const m = fs.readFileSync(file, 'utf8').match(/### 4\.1 [^\n]*\n\s*```json\n([\s\S]*?)\n```/);
  return m ? JSON.parse(m[1]) : null;
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data', 'manifest.json'), 'utf8'));
const textPack = JSON.parse(fs.readFileSync(path.join(root, 'data', 'text', 'bsb.json'), 'utf8'));
const bsb = vid => textPack.books[Math.floor(vid / 1e6) - 1][Math.floor(vid / 1000) % 1000 - 1][vid % 1000 - 1];
function nextVidT(vid) {
  const b = Math.floor(vid / 1e6), c = Math.floor(vid / 1000) % 1000, v = vid % 1000, book = textPack.books[b - 1];
  if (book[c - 1] && v < book[c - 1].length) return vid + 1;
  if (c < book.length) return b * 1e6 + (c + 1) * 1000 + 1;
  return b < 66 ? (b + 1) * 1e6 + 1001 : null;
}
const xrefFile = f => JSON.parse(fs.readFileSync(path.join(root, 'data', 'xref', f), 'utf8'));
const xJohn = xrefFile('43-John.json'), xPs = xrefFile('19-Ps.json');
const KINDS = ['quote', 'story', 'topic'];
const rawPct = chip => Math.round(chip[9][2] * 100);
const rowJn316 = xJohn.chapters[2][15], rowPs221 = xPs.chapters[21][0];
// What the strip should show: the first 12 loaded chips by rank that pass the slider and the reason filter.
const expectStrip = (row, min, kind = 'all') => row[1].filter(c => rawPct(c) >= min && (kind === 'all' || KINDS[c[9][0]] === kind)).slice(0, 12).map(c => c[10]);
// Each segment's count is the number of chips it will show: passing the slider and that reason, capped at 12 (the strip size).
const expectCounts = (row, min) => ({ all: expectStrip(row, min).length, quote: expectStrip(row, min, 'quote').length, story: expectStrip(row, min, 'story').length, topic: expectStrip(row, min, 'topic').length });
const byMatchFrom = (row, min) => row[2].slice(Math.floor(min / 5)).reduce((a, n) => a + n, 0);
function firstText(start, end) { for (let v = start, n = 0; v !== null && v <= end && n < 400; v = nextVidT(v), n++) { const t = bsb(v); if (t) return t; } return ''; }

console.log(`Smoke test: ${url}`);
const browser = await chromium.launch();
// ignoreHTTPSErrors: this sandbox reaches Google Fonts through a TLS-intercepting proxy whose CA Chromium does not trust.
const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'], ignoreHTTPSErrors: true });
const page = await context.newPage();
const consoleErrors = [];
const watch = p => {
  p.on('console', msg => { if (msg.type() === 'error') consoleErrors.push({ text: msg.text(), url: (msg.location() || {}).url || '' }); });
  p.on('pageerror', err => consoleErrors.push({ text: `pageerror: ${err.message}`, url: '' }));
};
watch(page);

const evalState = expr => page.evaluate(expr);
const focusVid = () => page.evaluate(() => +(document.querySelector('.v.focus') || {}).dataset?.vid || 0);
const title = () => page.textContent('#titleText');
const crumbs = () => page.evaluate(() => Array.from(document.querySelectorAll('#crumbs .crumb')).map(c => c.textContent).join(' → '));
async function shot(name) {
  await page.evaluate(() => { const t = document.getElementById('toast'); t.style.transition = 'none'; t.classList.remove('on'); void t.offsetWidth; t.style.transition = ''; });
  const bb = await page.locator('#phone').boundingBox();
  const file = path.join(shots, name);
  await page.screenshot({ path: file, clip: { x: bb.x - 26, y: bb.y - 26, width: bb.width + 52, height: bb.height + 52 } });
  console.log('  shot', file);
}
async function scrollVerseToFocus(vid) {
  await page.evaluate(v => { const r = document.getElementById('reader'), el = r.querySelector(`.v[data-vid="${v}"]`); r.scrollTop = el.offsetTop - r.clientHeight / 3 + 2; }, vid);
  await page.waitForFunction(v => document.querySelector('.v.focus')?.dataset.vid === String(v), vid, { timeout: 3000 }).catch(() => {});
}
const waitStrip = () => page.waitForFunction(() => !document.getElementById('marquee').classList.contains('fading') && document.querySelector('#track').children.length > 0, null, { timeout: 3000 });
const visibleChips = () => page.evaluate(() => Array.from(document.querySelectorAll('#track .chip')).map(c => ({
  rank: +c.dataset.rank, label: c.querySelector('.lbl').textContent, pill: c.querySelector('.rpill .k')?.textContent || '', pct: c.querySelector('.rpill .pct')?.textContent || '', because: (c.getAttribute('aria-label') || '').slice((c.getAttribute('aria-label') || '').indexOf(': ') + 2), snip: c.querySelector('.snip')?.textContent || '', faceBecause: !!c.querySelector('.because') })));
const chipByRank = rank => page.evaluate(r => { const c = document.querySelector(`#track .chip[data-rank="${r}"]`); return c && { label: c.querySelector('.lbl').textContent, pill: c.querySelector('.rpill .k')?.textContent || '', pct: c.querySelector('.rpill .pct')?.textContent || '', because: (c.getAttribute('aria-label') || '').slice((c.getAttribute('aria-label') || '').indexOf(': ') + 2), title: c.getAttribute('title') || '', snip: c.querySelector('.snip')?.textContent || '', faceBecause: !!c.querySelector('.because') }; }, rank);
// Every strip chip: line 2 is the start of the target verse (BSB), in the serif; the because sentence is off the face but in aria-label and title.
const chipFaces = () => page.evaluate(() => {
  const v = window.asb.verseOf(window.asb.state.focusVid);
  return Array.from(document.querySelectorAll('#track .chip')).map(c => { const it = window.asb.poolOf(v).find(x => x.rank === +c.dataset.rank), s = c.querySelector('.snip'), l = c.querySelector('.lbl');
    return { label: it.to.label, start: it.to.start, end: it.to.end, because: it.reason.because, snip: s ? s.textContent : '', serif: s ? /Literata|serif/i.test(getComputedStyle(s).fontFamily) : false,
      faceBecause: !!c.querySelector('.because') || (c.querySelector('.top').textContent + (s ? s.textContent : '')).includes(it.reason.because), aria: c.getAttribute('aria-label') || '', title: c.getAttribute('title') || '',
      labelWhole: l.scrollWidth <= l.clientWidth + 1 }; });
});
function facesOk(list) {
  const bad = list.filter(c => { const full = firstText(c.start, c.end), cut = c.snip.replace(/\u2026$/, '');
    return !c.snip || !full.startsWith(cut) || (c.snip.endsWith('\u2026') ? cut.length >= full.length : c.snip !== full) || !c.serif || c.faceBecause || !c.aria.endsWith(': ' + c.because) || c.title !== c.because || !c.labelWhole; });
  return { ok: list.length > 0 && bad.length === 0, bad: bad.map(c => c.label) };
}
const pctNum = s => { const m = /^(\d+)%$/.exec(String(s || '').trim()); return m ? +m[1] : NaN; };
// Every chip in the strip shows a whole-number match percentage from 1% to 100% that equals Math.round(reason.confidence * 100).
const chipPercentages = () => page.evaluate(() => {
  const v = window.asb.verseOf(window.asb.state.focusVid);
  return Array.from(document.querySelectorAll('#track .chip')).map(c => { const it = window.asb.poolOf(v).find(x => x.rank === +c.dataset.rank); return { label: c.querySelector('.lbl').textContent, shown: c.querySelector('.rpill .pct')?.textContent || '', expected: Math.round(it.reason.confidence * 100), visible: getComputedStyle(c.querySelector('.rpill .pct') || c).display !== 'none' }; });
});
const pctOk = list => list.length > 0 && list.every(c => c.visible && pctNum(c.shown) >= 1 && pctNum(c.shown) <= 100 && pctNum(c.shown) === c.expected);
const stripState = () => page.evaluate(() => ({ hold: document.getElementById('marquee').classList.contains('hold'), transform: document.getElementById('track').style.transform, scrollLeft: document.getElementById('marquee').scrollLeft, motion: document.getElementById('motionToggle').getAttribute('aria-checked') }));
const stripRanks = () => page.evaluate(() => Array.from(document.querySelectorAll('#track .chip')).map(c => +c.dataset.rank));
const sliderState = () => page.evaluate(() => ({ value: document.getElementById('matchSlider').value, label: document.getElementById('matchValue').textContent, match: window.asb.state.match }));
// Drive the slider with the keyboard, as a user would: Home, then one ArrowRight per 5%. Chrome fires input and change natively.
async function setSlider(v) {
  await page.focus('#matchSlider');
  await page.keyboard.press('Home');
  for (let i = 0; i < v / 5; i++) await page.keyboard.press('ArrowRight');
  await sleep(250);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const filterCounts = () => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#filters button')).map(b => [b.dataset.filter, +b.querySelector('.n').textContent])));
const noAiUi = () => page.evaluate(() => {
  const text = document.getElementById('phone').textContent;
  return document.querySelectorAll('.ai-pill, .ai-box, .ai-mark, #aiSheet, [data-ai]').length === 0 && !/AI note|AI-generated|AI study|AI marker/i.test(text);
});

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.v[data-vid="43003016"]', { timeout: 20000 });
  await page.waitForFunction(() => document.fonts ? document.fonts.status === 'loaded' : true, null, { timeout: 5000 }).catch(() => {});
  await sleep(500);

  // 1. Name, opening state, hold mode by default.
  check((await page.title()) === 'Dynamic Study Bible', `document title is "${await page.title()}"`);
  check((await page.textContent('#aboutSheet h2')).startsWith('Dynamic Study Bible'), 'About sheet carries the new name');
  check((await page.textContent('#previewTag')) === 'BSB preview', 'a "BSB preview" tag sits under the chapter title');
  check((await title()) === 'John 3', 'opens on John 3');
  check((await focusVid()) === 43003016, 'verse 16 is in focus at rest');
  await waitStrip();
  const s0 = await stripState();
  await sleep(700);
  const s1 = await stripState();
  check(s0.hold && s1.hold && s0.motion === 'false' && s0.transform === s1.transform && s1.scrollLeft === 0, `strip holds still by default and Motion is off (${JSON.stringify(s1)})`);
  const sl0 = await sliderState();
  check(sl0.value === '0' && sl0.label === 'Any' && sl0.match === 0, `the Match slider reads Any at load (${JSON.stringify(sl0)})`);
  check(same(await stripRanks(), expectStrip(rowJn316, 0)) && (await stripRanks()).length === 12, `John 3:16 shows its usual 12 chips, ranks ${(await stripRanks()).join(',')}`);
  const r1 = await chipByRank(1);
  check(r1 && r1.label === 'Romans 5:8' && r1.pill === 'Topic' && r1.because === 'Shared theme: loved', `rank-1 chip is Romans 5:8, Topic, "Shared theme: loved" (${JSON.stringify(r1)})`);
  check(r1 && r1.snip.startsWith('But God proves His love for us') && !r1.faceBecause && r1.title === 'Shared theme: loved', `Romans 5:8 chip shows the verse start "${r1 && r1.snip}", with the because sentence off the face but in its label and title`);
  const jnFaces = facesOk(await chipFaces());
  check(jnFaces.ok, `every John 3:16 chip shows the start of its BSB verse in the serif, whole label, because only in aria-label and title${jnFaces.bad.length ? ' (bad: ' + jnFaces.bad.join(', ') + ')' : ''}`);
  check(r1 && pctNum(r1.pct) <= 80, `John 3:16 \u2192 Romans 5:8 (a topic) shows at most 80% (${r1 && r1.pct})`);
  const jnPct = await chipPercentages();
  check(pctOk(jnPct), `every John 3:16 chip shows a match percentage from 1% to 100% (${jnPct.map(c => c.shown).join(' ')})`);
  const pctFits = await page.evaluate(() => Array.from(document.querySelectorAll('#track .chip .rpill')).every(p => { const c = p.closest('.chip').getBoundingClientRect(), r = p.getBoundingClientRect(); return r.right <= c.right - 8 && p.scrollWidth <= p.clientWidth + 1; }));
  check(pctFits, 'the percentage is never clipped inside its chip');
  const firstLeft = await page.evaluate(() => { const m = document.getElementById('marquee').getBoundingClientRect(), c = document.querySelector('#track .chip').getBoundingClientRect(); return c.left - m.left; });
  check(firstLeft >= 12 && firstLeft <= 20, `rank 1 is the first chip, fully in view (${firstLeft.toFixed(1)} px from the strip edge)`);
  const r3 = await chipByRank(3);
  check(r3 && r3.label === 'John 3:15' && r3.pill === 'Story' && r3.because === 'Another part of the same passage in John 3', `John 3:15 on John 3:16 is a Story chip (${JSON.stringify(r3)})`);
  const meta = await page.textContent('#stripMeta');
  check(/110 connections/.test(meta) && /\+98 more/.test(meta), `strip meta shows counts: "${meta}"`);
  const fc = await filterCounts();
  check(same(fc, expectCounts(rowJn316, 0)) && same(fc, { all: 12, quote: 0, story: 3, topic: 12 }), `filter counts on John 3:16 at Any read All 12 \u00b7 Quotes 0 \u00b7 Stories 3 \u00b7 Topics 12 (${JSON.stringify(fc)})`);
  const shownPerSegment = {};
  for (const f of ['quote', 'story', 'topic', 'all']) { await page.click(`#filters button[data-filter="${f}"]`); await sleep(220); shownPerSegment[f] = (await stripRanks()).length; }
  check(['all', 'quote', 'story', 'topic'].every(k => shownPerSegment[k] === fc[k]), `each segment's count equals the chips it shows when selected (${JSON.stringify(shownPerSegment)})`);
  check(await page.$('#track .chip.cross[data-rank="1"]') !== null, 'cross-book chip carries the cross accent');
  check(await noAiUi(), 'no AI note element or AI copy anywhere on the page');
  await shot('01-reader.png');

  // 2. Loader reproduces spec 4.1 (ids, refs, labels, snippets, ranking fields and reasons).
  const spec = specChapter();
  if (spec) {
    let mismatches = 0, compared = 0, confCompared = 0;
    const confStale = [];
    const cmp = (a, b, where) => { compared++; if (JSON.stringify(a) !== JSON.stringify(b)) { mismatches++; console.log('   spec mismatch', where, JSON.stringify(a), 'vs', JSON.stringify(b)); } };
    for (const sv of spec.verses) {
      const pv = await page.evaluate(vid => window.asb.verseOf(vid), sv.vid);
      for (const k of ['ref', 'label', 'text', 'omitted', 'paragraphStart', 'counts', 'connections', 'ai']) cmp(pv[k], sv[k], `${sv.label} ${k}`);
      sv.ticker.forEach((sc, i) => {
        const pc = pv.ticker[i] || {};
        for (const k of ['rank', 'to', 'direction', 'votesOut', 'votesIn', 'score', 'weight', 'tier', 'sameBook', 'viaRange', 'snippet', 'why', 'aiStatus']) cmp(pc[k], sc[k], `${sv.label} #${sc.rank} ${k}`);
        const { evidence, confidence, ...specReason } = sc.reason || {};
        const { confidence: dataConfidence, ...pageReason } = pc.reason || {};
        cmp(pageReason, specReason, `${sv.label} #${sc.rank} reason`);
        confCompared++; if (dataConfidence !== confidence) confStale.push(`${sv.label} #${sc.rank} ${confidence} -> ${dataConfidence}`);
      });
    }
    check(mismatches === 0, `expanded bundle matches spec 4.1 (${compared} fields compared, ${mismatches} mismatches)`);
    // reason.confidence passes straight through from the data, so a difference here means the spec example is stale, not a loader bug.
    check(confStale.length === 0, confStale.length ? `spec 4.1 example is stale: ${confStale.length} of ${confCompared} reason.confidence values differ from prototype/data (run tools/build_dataset.py, then tools/sync_spec.py); first: ${confStale.slice(0, 3).join('; ')}` : `spec 4.1 reason.confidence values match prototype/data (${confCompared} compared)`);
  } else check(false, 'spec 4.1 example found in docs/DATA_MODEL.md');

  // 3. Focus follows the reader and the strip re-anchors on rank 1.
  await page.waitForFunction(() => performance.now() > window.asb.state.focusLockUntil, null, { timeout: 3000 });
  await page.evaluate(() => { document.getElementById('marquee').scrollLeft = 400; });
  await sleep(250);
  await page.evaluate(() => { document.getElementById('reader').scrollTop = 0; });
  await page.waitForFunction(() => document.querySelector('.v.focus')?.dataset.vid === '43003001', null, { timeout: 3000 }).catch(() => {});
  check((await focusVid()) === 43003001, 'scrolling to the top focuses verse 1');
  await scrollVerseToFocus(43003016);
  check((await focusVid()) === 43003016, 'scrolling verse 16 into the focus band focuses it');
  await waitStrip();
  await sleep(200);
  check((await stripState()).scrollLeft === 0 && (await visibleChips())[0].label === 'Romans 5:8', 'strip re-anchors on rank 1 after a focus change');

  // 4. Reason filter.
  await page.click('#filterQuote');
  await sleep(250);
  const noQuotes = await page.textContent('#track');
  check(noQuotes.trim() === 'No direct quotes among this verse\u2019s connections', `Quotes filter on John 3:16 shows "${noQuotes.trim()}"`);
  await page.click('#filterStory');
  await sleep(250);
  const stories = await visibleChips();
  check(same(stories.map(c => c.rank), expectStrip(rowJn316, 0, 'story')) && stories.every(c => c.pill === 'Story'), `Stories filter shows the Story chips among the loaded list (${stories.map(c => c.label + ' #' + c.rank).join(', ')})`);
  await page.click('#filterAll');
  await sleep(250);
  check((await visibleChips()).length === 12, 'All filter shows the 12 inlined chips');

  // 4b. Match slider on John 3:16.
  await setSlider(80);
  const at80 = await visibleChips();
  check(same(at80.map(c => c.rank), [3, 7, 105]) && same(at80.map(c => c.label), ['John 3:15', 'John 3:36', 'John 3:12']) && same(at80.map(c => c.pct), ['89%', '83%', '84%']), `at 80% John 3:16 shows exactly 3 chips in rank order: ${at80.map(c => `${c.label} ${c.pct} #${c.rank}`).join(', ')}`);
  check(same(at80.map(c => c.rank), expectStrip(rowJn316, 80)), 'the 80% strip matches the data (first 12 loaded chips by rank at 80%+)');
  const meta80 = await page.textContent('#stripMeta');
  check(/3 of 110 at 80%\+/.test(meta80) && byMatchFrom(rowJn316, 80) === 3, `header reads "${meta80}"`);
  const sl80 = await sliderState();
  check(sl80.value === '80' && sl80.label === '80%+' && sl80.match === 80, `slider reads 80%+ (${JSON.stringify(sl80)})`);
  const fc80 = await filterCounts();
  check(same(fc80, expectCounts(rowJn316, 80)) && same(fc80, { all: 3, quote: 0, story: 3, topic: 0 }), `filter counts at 80% read All 3 \u00b7 Quotes 0 \u00b7 Stories 3 \u00b7 Topics 0 (${JSON.stringify(fc80)})`);
  check((await stripState()).scrollLeft === 0, 'the strip re-anchors on the first passing chip');
  const f80 = facesOk(await chipFaces()), p80 = await chipPercentages();
  check(f80.ok && pctOk(p80) && p80.every(c => pctNum(c.shown) >= 80), 'the 80% chips keep the verse start, percentage and because rules');
  await shot('08-match-slider.png');
  await page.click('#track .chip[data-rank="105"]');
  await page.waitForSelector('#peekSheet.on', { timeout: 3000 });
  await sleep(300);
  check(/rank 105 of 110/.test(await page.textContent('#peekBody')) && (await page.textContent('#peekTitle')).includes('John 3:12'), 'a chip below the top 12 opens its peek with its real rank (105 of 110)');
  check((await page.textContent('#peekAll')) === 'See all 3', 'the peek offers See all 3 at 80%+');
  await page.click('#peekAll');
  await page.waitForSelector('#listSheet.on', { timeout: 3000 });
  await sleep(300);
  const list80 = await page.evaluate(() => Array.from(document.querySelectorAll('#listBody .chip')).map(c => +c.dataset.rank));
  check(same(list80, [3, 7, 105]), `See all at 80% lists 3 rows (${list80.join(', ')})`);
  check((await page.textContent('#listMore')) === 'Every connection at 80%+ for this verse is shown.', 'See all says every 80%+ connection is shown');
  await page.click('#listSheet [data-close]');
  await sleep(300);
  await setSlider(100);
  const empty100 = (await page.textContent('#track')).trim();
  check(empty100 === 'No connections at 100%+ for this verse. Lower the Match slider.', `at 100% John 3:16 shows the empty state: "${empty100}"`);
  check(/0 of 110 at 100%\+/.test(await page.textContent('#stripMeta')), 'header reads 0 of 110 at 100%+');
  await setSlider(0);
  check(same(await stripRanks(), expectStrip(rowJn316, 0)) && (await sliderState()).label === 'Any' && /110 connections/.test(await page.textContent('#stripMeta')) && /\+98 more/.test(await page.textContent('#stripMeta')), 'returning the slider to 0 restores the default strip and header');

  // 5. Motion switch: off by default, on moves slowly, off holds again.
  const dwell = await page.evaluate(() => [window.asb.state.motion.baseSeconds, window.asb.state.motion.perWeightSeconds, window.asb.state.motion.defaultMode]);
  check(dwell[0] === 3 && dwell[1] === 3 && dwell[2] === 'hold', `motion constants come from manifest.ranking.motion (${JSON.stringify(dwell)})`);
  await page.click('#motionToggle');
  await sleep(400);
  const m0 = await stripState();
  await sleep(1000);
  const m1 = await stripState();
  const px = (t) => -parseFloat((t.match(/translate3d\((-?[\d.]+)px/) || [0, 0])[1]);
  const moved = px(m1.transform) - px(m0.transform);
  check(!m1.hold && m1.motion === 'true' && moved > 5, `Motion on starts auto-scroll (moved ${moved.toFixed(1)} px in 1 s)`);
  check(moved < 110, `auto-scroll is slow: a chip dwells 3 to 6 s (${moved.toFixed(1)} px/s)`);
  const tickerDwell = await page.evaluate(() => window.asb.state.ticker.dwell.slice(0, 1)[0]);
  check(Math.abs(tickerDwell - 6) < 1e-9, `dwell for weight 1.0 is 6.0 s (got ${tickerDwell})`);
  check(await page.evaluate(() => localStorage.getItem('asb.motion.v2')) === 'true', 'the choice is saved under asb.motion.v2');
  await page.click('#motionToggle');
  await sleep(300);
  const m2 = await stripState();
  check(m2.hold && m2.motion === 'false', 'Motion off returns the strip to hold');

  // 6. Peek sheet: reason line, whole verse, caption, votes, no AI.
  await page.click('#track .chip[data-rank="1"]');
  await page.waitForSelector('#peekSheet.on', { timeout: 3000 });
  await sleep(450);
  check(/Romans 5:8/.test(await page.textContent('#peekTitle')), 'peek title is Romans 5:8');
  const reasonLine = await page.textContent('#peekReason');
  const peekPct = await page.evaluate(() => ({ k: document.querySelector('#peekReason .rpill .k')?.textContent, pct: document.querySelector('#peekReason .rpill .pct')?.textContent, because: document.querySelector('#peekReason .because-lg')?.textContent }));
  check(peekPct.k === 'Same topic' && /^\d+% match$/.test(peekPct.pct || '') && pctNum((peekPct.pct || '').replace(' match', '')) === pctNum(r1.pct) && peekPct.because === 'Shared theme: loved', `peek reason line reads "${peekPct.k} \u00b7 ${peekPct.pct}" then "${peekPct.because}"`);
  check(!/rule confidence/i.test(await page.textContent('#peekBody')), 'the old rule-confidence fine print is gone');
  const passage = await page.textContent('#peekPassage');
  check(passage.replace(/^8\s*/, '') === bsb(45005008), `peek shows the whole verse: "${passage}"`);
  check((await page.textContent('#peekBody')).includes('Berean Standard Bible (preview text)'), 'peek captions the text as Berean Standard Bible (preview text)');
  const peekText = await page.textContent('#peekBody');
  check(/178 votes/.test(peekText) && /33 votes/.test(peekText), 'peek shows cited 178 and cites back 33');
  check(await noAiUi(), 'peek has no AI block');
  const order = await page.evaluate(() => { const b = document.getElementById('peekBody'); const pos = el => Array.from(b.children).indexOf(el); return [pos(document.getElementById('peekReason')), pos(document.getElementById('peekPassage')), pos(b.querySelector('.votes-list'))]; });
  check(order[0] < order[1] && order[1] < order[2], 'peek order: reason line, verse text, vote lines');
  await shot('02-peek.png');
  await page.click('#peekSheet [data-close]');
  await sleep(350);

  // 6b. A range chip shows the whole range, never truncated.
  await page.click('#track .chip[data-rank="2"]');
  await page.waitForSelector('#peekSheet.on', { timeout: 3000 });
  await sleep(350);
  const rangeText = await page.textContent('#peekPassage');
  check(rangeText.includes(bsb(62004009)) && rangeText.includes(bsb(62004010)), '1 John 4:9–10 peek shows both whole verses');

  // 7. JSON view carries the reason object.
  await page.click('#peekJson');
  await page.waitForSelector('#jsonSheet.on', { timeout: 3000 });
  const vjson = await page.textContent('#jsonPre');
  check(/"vid": 43003016/.test(vjson) && /"reason": \{/.test(vjson) && /"source": "rule"/.test(vjson) && /"label": "Same topic"/.test(vjson), 'verse JSON shows the reason object on each ticker item');
  const bm = await page.evaluate(() => window.asb.verseOf(43003016).counts.byMatch);
  check(Array.isArray(bm) && bm.length === 20 && bm.every(Number.isInteger) && bm.reduce((a, n) => a + n, 0) === 110 && same(bm, rowJn316[2]) && /"byMatch": \[/.test(vjson), `verse JSON carries counts.byMatch with 20 numbers summing to 110 (${bm.join(',')})`);
  check(await page.evaluate(() => { const v = window.asb.verseOf(43003016); return v.ticker.length === 12 && !Object.keys(v).includes('pool') && !JSON.stringify(v).includes('"pool"'); }), 'ticker[] stays the 12 shown chips and the loaded list stays out of the JSON');
  check(/"why": null/.test(vjson) && /"aiStatus": "not_generated"/.test(vjson) && /"status": "not_generated"/.test(vjson), 'verse JSON keeps why null and aiStatus not_generated');
  const vObj = await page.evaluate(() => window.asb.verseOf(43003016));
  check(vObj.ticker.every(t => t.reason && ['quote', 'story', 'topic'].includes(t.reason.kind) && typeof t.reason.because === 'string' && t.reason.because.length > 0 && t.reason.source === 'rule'), 'every ticker item carries a reason with kind, because and source');
  await page.click('#jsonSheet [data-close]');
  await sleep(300);

  // 8. Go, trail, Back, Forward.
  await page.click('#track .chip[data-rank="1"]');
  await page.waitForSelector('#peekSheet.on', { timeout: 3000 });
  await sleep(300);
  await page.click('#peekGo');
  await page.waitForFunction(() => document.getElementById('titleText').textContent === 'Romans 5', null, { timeout: 5000 });
  await sleep(400);
  check((await focusVid()) === 45005008, 'Go lands on Romans 5:8 in focus');
  check(await page.$('.v.hl[data-vid="45005008"]') !== null, 'target verse is highlighted after the jump');
  check((await crumbs()) === 'John 3:16 → Romans 5:8', `trail reads ${await crumbs()}`);
  check(await page.evaluate(() => !document.getElementById('peekSheet').classList.contains('on')), 'peek sheet closes after Go');
  await waitStrip();
  const romans1 = await chipByRank(1);
  check(romans1 && romans1.label.length > 0 && romans1.pill.length > 0, `Romans 5:8 strip filled (rank 1: ${romans1 && romans1.label}, ${romans1 && romans1.pill})`);
  await shot('03-trail.png');
  await page.click('#backBtn');
  await sleep(500);
  check((await title()) === 'John 3' && (await focusVid()) === 43003016, 'Back returns to John 3:16');
  check(await page.evaluate(() => !document.getElementById('fwdBtn').disabled), 'Forward becomes available after Back');
  await page.click('#fwdBtn');
  await sleep(500);
  check((await focusVid()) === 45005008, 'Forward returns to Romans 5:8');
  await page.click('#backBtn');
  await sleep(500);
  check((await focusVid()) === 43003016, 'Back again returns to John 3:16');

  // 9. Trail object matches spec 4.3 shape.
  const trail = await evalState('window.asb.state.trail');
  check(trail.schema === 'asb.trail/2' && Array.isArray(trail.hops) && Array.isArray(trail.forward) && Array.isArray(trail.peeks) && trail.web && trail.rules, 'trail has the spec 4.3 top-level shape');
  check(trail.hops[0].kind === 'open' && trail.hops[0].vid === 43003016 && trail.hops[0].via === null, 'hop 0 is kind open at John 3:16');
  const jumpHop = trail.forward[0];
  check(jumpHop && jumpHop.kind === 'jump' && jumpHop.via && jumpHop.via.from.vid === 43003016 && jumpHop.via.rank === 1 && jumpHop.via.votesOut === 178, 'jump hop carries via from John 3:16, rank 1, 178 votes');
  check(trail.web.nodes.length === 2 && trail.web.edges.length === 1 && trail.web.edges[0][0] === 43003016, 'web has 2 nodes and 1 travelled edge');
  check(trail.peeks.length >= 3 && trail.peeks.some(p => p.jumped) && trail.peek === null, 'peeks are recorded and the jumped one is marked');

  // 10. Web overlay and copy.
  await page.click('#webBtn');
  await page.waitForSelector('#webOverlay.on', { timeout: 3000 });
  await sleep(450);
  const svgStats = await page.evaluate(() => ({ circles: document.querySelectorAll('#webSvg circle').length, lines: document.querySelectorAll('#webSvg line').length, dashed: document.querySelectorAll('#webSvg line[stroke-dasharray]').length }));
  check(svgStats.circles >= 3 && svgStats.lines >= 2 && svgStats.dashed >= 1, `web draws ${svgStats.circles} nodes and ${svgStats.lines} edges (${svgStats.dashed} peek-only)`);
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

  // 11. See all list: reason pill and because on every row.
  await page.click('#track .chip[data-rank="1"]');
  await page.waitForSelector('#peekSheet.on', { timeout: 3000 });
  await page.click('#peekAll');
  await page.waitForSelector('#listSheet.on', { timeout: 3000 });
  await sleep(300);
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#listBody .chip')).map(c => [c.querySelector('.rpill .k')?.textContent, c.querySelector('.because')?.textContent, c.querySelector('.rpill .pct')?.textContent]));
  check(rows.length === rowJn316[1].length && rows.every(r => /^(Quote|Story|Topic)$/.test(r[0]) && r[1] && pctNum(r[2]) >= 1 && pctNum(r[2]) <= 100), `See all at Any lists all ${rows.length} loaded rows, each with a reason pill, a match percentage and a because line`);
  const more0 = await page.textContent('#listMore');
  check(more0.startsWith(`+${110 - rowJn316[1].length} more live in the full dataset`), `See all notes what the preview leaves out: "${more0}"`);
  await page.click('#listSheet [data-close]');
  await sleep(300);

  // 12. Reference parsing and search; Psalm 22:1 quotes and the Quotes filter.
  const parsed = await page.evaluate(() => ['Rom 5:8', '1 John 4:9', 'John 3', 'Ps 22:1', 'Song of Songs 2:1', 'nonsense 9'].map(q => window.asb.parseRef(q)));
  check(parsed[0]?.bookNo === 45 && parsed[0].chapter === 5 && parsed[0].verse === 8, 'parses "Rom 5:8"');
  check(parsed[1]?.bookNo === 62 && parsed[1].chapter === 4 && parsed[1].verse === 9, 'parses "1 John 4:9"');
  check(parsed[2]?.bookNo === 43 && parsed[2].chapter === 3 && parsed[2].verse === null, 'parses "John 3"');
  check(parsed[3]?.bookNo === 19 && parsed[3].chapter === 22 && parsed[3].verse === 1, 'parses "Ps 22:1"');
  check(parsed[4]?.bookNo === 22 && parsed[5] === null, 'parses "Song of Songs 2:1" and rejects nonsense');
  await page.click('#searchBtn');
  await page.fill('#searchInput', 'Ps 22:1');
  await page.press('#searchInput', 'Enter');
  await page.waitForFunction(() => document.getElementById('titleText').textContent === 'Psalm 22', null, { timeout: 5000 });
  await sleep(400);
  check((await focusVid()) === 19022001, 'search "Ps 22:1" opens Psalm 22:1');
  check((await evalState('window.asb.state.trail.hops[window.asb.state.trail.cursor].kind')) === 'search', 'search pushes a hop of kind search');
  await waitStrip();
  const ps = [await chipByRank(1), await chipByRank(2)];
  check(ps[0]?.label === 'Matthew 27:46' && ps[0].pill === 'Quote' && ps[0].because === 'Matthew 27:46 quotes Psalm 22:1', `Psalm 22:1 rank 1: ${JSON.stringify(ps[0])}`);
  check(ps[1]?.label === 'Mark 15:34' && ps[1].pill === 'Quote' && ps[1].because === 'Mark 15:34 quotes Psalm 22:1', `Psalm 22:1 rank 2: ${JSON.stringify(ps[1])}`);
  check(pctNum(ps[0]?.pct) >= 90, `Psalm 22:1 \u2192 Matthew 27:46 shows at least 90% (${ps[0] && ps[0].pct})`);
  check(ps[0]?.snip.startsWith('About the ninth hour Jesus cried out') || ps[0]?.snip.startsWith(firstText(40027046, 40027046).slice(0, 20)), `Matthew 27:46 chip shows its verse start "${ps[0] && ps[0].snip}"`);
  const psFaces = facesOk(await chipFaces());
  check(psFaces.ok, `every Psalm 22:1 chip shows the start of its BSB verse, because only in aria-label and title${psFaces.bad.length ? ' (bad: ' + psFaces.bad.join(', ') + ')' : ''}`);
  const psPct = await chipPercentages();
  check(pctOk(psPct), `every Psalm 22:1 chip shows a match percentage from 1% to 100% (${psPct.map(c => c.shown).join(' ')})`);
  const psCounts = await filterCounts();
  check(same(psCounts, expectCounts(rowPs221, 0)) && psCounts.quote === 2 && Object.values(psCounts).every(n => n <= 12), `Psalm 22:1 filter counts at Any, capped at 12: ${JSON.stringify(psCounts)}`);
  await page.click('#filterQuote');
  await sleep(300);
  const quotes = await visibleChips();
  check(quotes.length === 2 && quotes[0].label === 'Matthew 27:46' && quotes[1].label === 'Mark 15:34' && quotes.every(c => c.pill === 'Quote'), `Quotes filter on Psalm 22:1 shows exactly 2 chips (${quotes.map(c => c.label).join(', ')})`);
  await shot('07-quotes.png');
  await page.click('#filterAll');
  await setSlider(100);
  const ps100 = await visibleChips();
  check(same(ps100.map(c => c.label), ['Matthew 27:46', 'Mark 15:34']) && same(ps100.map(c => c.rank), expectStrip(rowPs221, 100)), `at 100% Psalm 22:1 shows only ${ps100.map(c => c.label + ' ' + c.pct).join(' and ')}`);
  check(/2 of 62 at 100%\+/.test(await page.textContent('#stripMeta')), `Psalm 22:1 header reads "${await page.textContent('#stripMeta')}"`);
  await setSlider(80);
  await page.click('#filterStory');
  await sleep(250);
  const psStory80 = await visibleChips();
  check(psStory80.length > 0 && same(psStory80.map(c => c.rank), expectStrip(rowPs221, 80, 'story')) && psStory80.every(c => c.pill === 'Story' && pctNum(c.pct) >= 80), `slider and reason filter combine: Psalm 22:1 at 80% with Stories shows ${psStory80.map(c => c.label + ' ' + c.pct).join(', ')}`);
  check(same(await filterCounts(), expectCounts(rowPs221, 80)), `Psalm 22:1 filter counts at 80%: ${JSON.stringify(await filterCounts())}`);
  await page.click('#backBtn');
  await sleep(600);
  const kept = await sliderState();
  check((await focusVid()) === 43003016 && kept.match === 80 && kept.label === '80%+' && (await evalState('window.asb.state.filter')) === 'story', 'the slider value and the reason filter are kept while navigating');
  check(same(await stripRanks(), expectStrip(rowJn316, 80, 'story')) && (await stripState()).scrollLeft === 0, `back on John 3:16 the strip re-anchors on the first passing chip (${(await stripRanks()).join(', ')})`);
  check(await page.evaluate(() => localStorage.getItem('asb.match.v1')) === '80', 'the slider value is remembered under asb.match.v1');
  await page.click('#filterAll');
  await setSlider(0);
  check(same(await stripRanks(), expectStrip(rowJn316, 0)), 'slider back at Any restores the default John 3:16 strip');

  // 13. Book and chapter picker; omitted verse.
  await page.click('#titleBtn');
  await page.waitForSelector('#pickerSheet.on', { timeout: 3000 });
  await sleep(300);
  check(await page.evaluate(() => document.querySelectorAll('#pickerBody .book-btn').length) === 66, 'picker lists 66 books in two columns');
  await page.click('#pickerBody .book-btn[data-book="43"]');
  await sleep(200);
  check(await page.evaluate(() => document.querySelectorAll('#pickerBody .grid button').length) === 21, 'John shows a 21-chapter grid');
  await page.click('#pickerBody .grid button[data-ch="3"]');
  await sleep(600);
  check((await title()) === 'John 3' && (await evalState('window.asb.state.trail.hops[window.asb.state.trail.cursor].kind')) === 'open', 'picker opens John 3 with a hop of kind open');
  await page.evaluate(() => window.asb.navigate({ bookNo: 40, chapter: 17, vid: 40017021, kind: 'open' }));
  await sleep(500);
  check(await page.$('.v.omitted[data-vid="40017021"] .tag') !== null, 'Matthew 17:21 renders as an omitted verse');
  await page.evaluate(() => window.asb.navigate({ bookNo: 43, chapter: 3, vid: 43003016, kind: 'open' }));
  await sleep(500);

  // 14. About: preview line, attributions, reasons line, no AI notes.
  await page.click('#aboutBtn');
  await page.waitForSelector('#aboutSheet.on', { timeout: 3000 });
  const xrefAttr = manifest.sources.find(s => s.kind === 'crossReferences').attribution;
  const notice = manifest.translations[0].copyrightNotice;
  check((await page.textContent('#aboutPreview')) === 'Preview text: Berean Standard Bible. The app launches with the NIV.', 'About carries the preview-text line');
  check((await page.textContent('#aboutXref')) === xrefAttr, 'About shows the OpenBible attribution from manifest.sources');
  check((await page.textContent('#aboutNotice')) === notice, 'About shows the BSB copyright notice');
  check((await page.textContent('#aboutReasons')) === 'Connection reasons are computed by rules from the public-domain text, not by AI.', 'About states reasons are rules, not AI');
  check((await page.textContent('#aboutNivPreview')) === 'In the app, chip previews will show the NIV if YouVersion allows partial-verse previews; otherwise they show the reference and reason only.', 'About carries the NIV chip-preview line under the preview note');
  check(await page.evaluate(() => document.getElementById('aboutPreview').nextElementSibling?.id === 'aboutNivPreview'), 'the NIV chip-preview line sits right under the preview note');
  check((await page.textContent('#aboutSlider')) === 'Match slider: raise it to see only the closest matches; lower it to include looser topical links.', 'About explains the Match slider');
  check((await page.textContent('#aboutMatch')) === 'Match percentage: 100% means the same words or the same account; lower means a looser topical or word match. It blends shared wording, names and themes with OpenBible.info reader votes.', 'About explains the match percentage');
  check(await noAiUi(), 'About has no AI notes section');
  await page.click('#aboutSheet [data-close]');
  await sleep(300);

  // 15. Dark mode.
  await page.emulateMedia({ colorScheme: 'dark' });
  await sleep(400);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(bg === 'rgb(5, 6, 8)', `dark mode applies a true dark palette (body ${bg})`);
  const pillDark = await page.evaluate(() => getComputedStyle(document.querySelector('#track .rpill')).color);
  check(pillDark !== 'rgb(79, 93, 109)', `reason pills switch to their dark tokens (${pillDark})`);
  await shot('05-dark.png');
  await page.emulateMedia({ colorScheme: 'light' });

  // 16. Phone width: no bezel, no horizontal scroll; an old saved "motion on" preference does not override the new default.
  const mobile = await context.newPage();
  watch(mobile);
  await mobile.addInitScript(() => { try { localStorage.setItem('asb.reduceMotion', 'false'); localStorage.removeItem('asb.motion.v2'); localStorage.removeItem('asb.position'); } catch (e) {} });
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(url, { waitUntil: 'load' });
  await mobile.waitForSelector('.v[data-vid="43003016"]', { timeout: 20000 });
  await sleep(700);
  const m = await mobile.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, bodySw: document.body.scrollWidth, island: getComputedStyle(document.querySelector('.island')).display, pw: document.getElementById('phone').getBoundingClientRect().width }));
  check(m.sw <= m.iw && m.bodySw <= m.iw && m.island === 'none' && Math.round(m.pw) === 390, `phone width fills the viewport without a bezel or horizontal scroll (${JSON.stringify(m)})`);
  const mm = await mobile.evaluate(() => ({ hold: document.getElementById('marquee').classList.contains('hold'), motion: document.getElementById('motionToggle').getAttribute('aria-checked') }));
  check(mm.hold && mm.motion === 'false', 'an old saved motion preference does not switch auto-scroll on');
  await mobile.screenshot({ path: path.join(shots, '06-mobile.png') });
  console.log('  shot', path.join(shots, '06-mobile.png'));
  await mobile.close();

  // 17. prefers-reduced-motion keeps Motion off even with a saved "on".
  const rm = await browser.newContext({ viewport: { width: 1200, height: 1000 }, reducedMotion: 'reduce', ignoreHTTPSErrors: true });
  const rp = await rm.newPage();
  watch(rp);
  await rp.addInitScript(() => { try { localStorage.setItem('asb.motion.v2', 'true'); } catch (e) {} });
  await rp.goto(url, { waitUntil: 'load' });
  await rp.waitForSelector('.v[data-vid="43003016"]', { timeout: 20000 });
  await sleep(500);
  check(await rp.evaluate(() => document.getElementById('marquee').classList.contains('hold') && document.getElementById('motionToggle').getAttribute('aria-checked') === 'false'), 'prefers-reduced-motion keeps the strip still');
  await rm.close();

  // 18. The reader's marks (spec 2.13): highlights, bookmarks, notes and tags, stored under asb.annotations.v1.
  const seedDoc = JSON.parse(fs.readFileSync(path.join(root, 'data', 'annotations.json'), 'utf8'));
  const annDoc = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('asb.annotations.v1')); } catch (e) { return null; } });
  const wordsT = vid => bsb(vid).split(/\s+/);
  const hlGroups = (p, vid) => p.evaluate(v => Array.from(document.querySelectorAll(`.v[data-vid="${v}"] .hlr`)).map(h => ({ text: h.textContent, words: Array.from(h.querySelectorAll('.w')).map(w => +w.dataset.w), bg: getComputedStyle(h).backgroundColor })), vid);
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const vtags = vid => page.evaluate(v => Array.from(document.querySelectorAll(`.v[data-vid="${v}"] .v-tag`)).map(t => t.textContent), vid);
  const barHint = () => page.textContent('#abHint');
  const picks = vid => page.evaluate(v => Array.from(document.querySelectorAll(`.v[data-vid="${v}"] .w.pick`)).map(w => +w.dataset.w), vid);
  const lastItem = async () => { const d = await annDoc(); return d.items[d.items.length - 1]; };
  const goQuiet = (b, c, v) => page.evaluate(([b, c, v]) => window.asb.navigate({ bookNo: b, chapter: c, vid: v }), [b, c, v]);

  const stored0 = await annDoc();
  check(stored0 && stored0.schema === 'asb.annotations/1' && same(stored0.items.map(i => i.id), seedDoc.items.map(i => i.id)) && same(stored0.palette, seedDoc.palette) && same(stored0.rules, seedDoc.rules), `first run seeds asb.annotations.v1 from data/annotations.json (${stored0 && stored0.items.length} items)`);
  await goQuiet(43, 3, 43003016);
  await sleep(400);
  const seedJn = await hlGroups(page, 43003016);
  check(seedJn.length === 1 && seedJn[0].text === bsb(43003016) && same(seedJn[0].words, range(0, wordsT(43003016).length - 1)) && seedJn[0].bg === 'rgb(255, 226, 122)', `seed: John 3:16 is highlighted yellow over the whole verse (${JSON.stringify(seedJn.map(g => g.bg))})`);
  check(await page.$('.v[data-vid="43003016"] .v-bm') !== null && await page.$('.v[data-vid="43003017"] .v-bm') !== null && await page.$('.v[data-vid="43003018"] .v-bm') === null, 'seed: the John 3:16–17 bookmark shows a margin glyph on both verses only');
  check(same(await vtags(43003016), ['love']), 'seed: John 3:16 carries the tag chip "love"');
  check(await page.evaluate(() => Array.from(document.querySelectorAll('.v')).every(el => { const v = window.asb.verseOf(+el.dataset.vid); const vt = el.querySelector('.vt'); return v.omitted ? !vt : vt.textContent === v.text && Array.from(vt.querySelectorAll('.w')).map(w => w.textContent).join('|') === v.text.split(/\s+/).join('|'); })), 'every verse renders its exact text, one span per word of text.split(/\\s+/)');
  await goQuiet(45, 5, 45005008);
  await sleep(400);
  const seedRom = await hlGroups(page, 45005008);
  check(seedRom.length === 1 && same(seedRom[0].words, range(0, 8)) && seedRom[0].text === wordsT(45005008).slice(0, 9).join(' ') && seedRom[0].bg === 'rgb(169, 211, 245)', `seed: Romans 5:8 words 0–8 are blue: "${seedRom[0] && seedRom[0].text}"`);
  check(await page.$('.v[data-vid="45005008"] .v-note') !== null && same(await vtags(45005008), ['grace', 'love']), 'seed: Romans 5:8 shows a note glyph and the tags grace and love');
  await goQuiet(19, 23, 19023001);
  await sleep(400);
  const seedPs = await hlGroups(page, 19023001);
  check(seedPs.length === 1 && same(seedPs[0].words, range(4, 8)) && seedPs[0].text === 'The LORD is my shepherd;' && seedPs[0].bg === 'rgb(184, 230, 160)', `seed: Psalm 23:1 words 4–8 are green: "${seedPs[0] && seedPs[0].text}"`);

  // Tapping a verse keeps tap-to-focus and opens the mark bar; a colour highlights the whole verse.
  await goQuiet(43, 3, 43003016);
  await sleep(500);
  await page.click('.v[data-vid="43003014"] .w[data-w="0"]');
  await page.waitForSelector('#actionBar:not([hidden])', { timeout: 3000 });
  await sleep(250);
  check((await focusVid()) === 43003014 && (await page.textContent('#abLabel')) === 'John 3:14', 'tapping John 3:14 puts it in focus and opens the mark bar for it');
  await waitStrip();
  check(/John 3:14/.test(await page.textContent('#stripMeta')), 'the strip follows the tapped verse');
  const targets = await page.evaluate(() => Array.from(document.querySelectorAll('#actionBar button')).map(b => { const r = b.getBoundingClientRect(); return { id: b.id || b.dataset.color, w: Math.round(r.width), h: Math.round(r.height), aria: b.getAttribute('aria-label') || '' }; }));
  check(targets.length === 11 && targets.filter(t => /^(yellow|green|blue|pink|orange)$/.test(t.id)).length === 5 && targets.every(t => t.w >= 44 && t.h >= 44 && t.aria.length > 0), `the bar has 5 colours, Clear, Bookmark, Note, Tag, Part of verse and Close, each at least 44 px and labelled (${targets.map(t => `${t.id} ${t.w}x${t.h}`).join(', ')})`);
  const barBox = await page.evaluate(() => { const b = document.getElementById('actionBar').getBoundingClientRect(), s = document.querySelector('.strip').getBoundingClientRect(), v = document.querySelector('.v[data-vid="43003014"]').getBoundingClientRect(); return { barBottom: b.bottom, stripTop: s.top, verseBottom: v.bottom, barTop: b.top }; });
  check(barBox.barBottom <= barBox.stripTop && barBox.verseBottom <= barBox.barTop, `the bar sits above the strip and clear of the tapped verse (${JSON.stringify(barBox)})`);
  await shot('10-action-bar.png');
  await page.click('#abSwatches .sw[data-color="green"]');
  await sleep(250);
  const g14 = await hlGroups(page, 43003014);
  check(g14.length === 1 && g14[0].text === bsb(43003014) && g14[0].bg === 'rgb(184, 230, 160)', 'Green highlights the whole of John 3:14');
  const it14 = await lastItem();
  check(it14.kind === 'highlight' && it14.color === 'green' && it14.anchor.translation === 'bsb' && it14.anchor.partial === false && it14.anchor.start.word === null && it14.anchor.start.of === null && it14.anchor.ref === 'John.3.14' && it14.anchor.label === 'John 3:14' && it14.sync.youversion === 'notEligible' && /^ann_[A-Za-z0-9_-]+$/.test(it14.id), `the stored highlight is a whole-verse BSB anchor (${JSON.stringify(it14.anchor)}, youversion ${it14.sync.youversion})`);
  check(await page.evaluate(() => document.querySelector('#abSwatches .sw[data-color="green"]').getAttribute('aria-pressed')) === 'true', 'the bar shows green as the verse colour');

  // Part of verse: first word, last word, preview, then a colour lands on exactly those words.
  await page.click('.v[data-vid="43003015"] .w[data-w="0"]');
  await sleep(200);
  await page.click('#abPart');
  check((await barHint()) === 'Tap the first word' && await page.evaluate(() => document.querySelector('#abSwatches .sw').disabled), 'Part of verse asks for the first word and holds the colours until one is picked');
  await page.click('.v[data-vid="43003015"] .w[data-w="3"]');
  check((await barHint()) === 'Tap the last word' && same(await picks(43003015), [3]), 'the first tap previews one word and asks for the last');
  await page.click('.v[data-vid="43003015"] .w[data-w="6"]');
  await sleep(150);
  check(same(await picks(43003015), [3, 4, 5, 6]) && (await barHint()) === '4 words selected', `the range previews on words 3–6 (${(await picks(43003015)).join(',')})`);
  check(await page.evaluate(() => document.getElementById('abBookmark').disabled), 'Bookmark is off for part of a verse (bookmarks are whole verses)');
  await shot('11-part-of-verse.png');
  await page.click('#abSwatches .sw[data-color="orange"]');
  await sleep(250);
  const g15 = await hlGroups(page, 43003015), n15 = wordsT(43003015).length;
  check(g15.length === 1 && same(g15[0].words, [3, 4, 5, 6]) && g15[0].text === wordsT(43003015).slice(3, 7).join(' ') && g15[0].bg === 'rgb(255, 201, 138)', `the orange highlight covers exactly "${g15[0] && g15[0].text}"`);
  check(await page.evaluate(() => document.querySelectorAll('.v[data-vid="43003015"] .hlr .w').length) === 4, 'no other word of John 3:15 is highlighted');
  const it15 = await lastItem();
  check(it15.kind === 'highlight' && it15.anchor.partial === true && same(it15.anchor.start, { vid: 43003015, word: 3, of: n15 }) && same(it15.anchor.end, { vid: 43003015, word: 6, of: n15 }) && it15.sync.youversion === 'notEligible', `the stored anchor holds word positions 3–6 of ${n15}, never words (${JSON.stringify(it15.anchor)})`);
  check(!JSON.stringify(await annDoc()).includes(wordsT(43003015).slice(3, 7).join(' ')), 'the stored document holds no verse words');

  // Bookmark, then a note with a tag.
  await page.click('.v[data-vid="43003014"] .w[data-w="0"]');
  await sleep(200);
  await page.click('#abBookmark');
  await sleep(200);
  const bmIt = await lastItem();
  check(await page.$('.v[data-vid="43003014"] .v-bm') !== null && bmIt.kind === 'bookmark' && bmIt.anchor.partial === false && bmIt.anchor.ref === 'John.3.14' && await page.evaluate(() => document.getElementById('abBookmark').getAttribute('aria-pressed')) === 'true', 'Bookmark marks John 3:14 in the margin and stores a whole-verse bookmark');
  await page.click('#abNote');
  await page.waitForSelector('#noteSheet.on', { timeout: 3000 });
  await sleep(350);
  const noteHead = await page.textContent('#noteTitle');
  check(noteHead.startsWith('John 3:14') && (await page.inputValue('#noteText')) === '' && !(await page.textContent('#noteSheet')).includes(bsb(43003014).slice(0, 20)), `the note editor shows the verse label "${noteHead}" and an empty note, never the verse text`);
  await page.fill('#noteText', 'Moses and the snake point to the cross.\nRead Numbers 21 next.');
  await page.fill('#noteTagIn', 'Lifted up');
  await page.press('#noteTagIn', 'Enter');
  await page.click('#noteTagSugg [data-add="love"]');
  const chipsNow = await page.evaluate(() => Array.from(document.querySelectorAll('#noteTagBox .tchip')).map(c => c.firstChild.textContent));
  check(same(chipsNow, ['Lifted up', 'love']), `Enter adds a typed tag and a tap adds a suggested one (${chipsNow.join(', ')})`);
  await shot('12-note-editor.png');
  await page.click('#noteSave');
  await sleep(450);
  const note = await lastItem(), docN = await annDoc();
  check(note.kind === 'note' && note.body === 'Moses and the snake point to the cross.\nRead Numbers 21 next.' && same(note.tags, ['lifted-up', 'love']) && docN.tags.some(t => t.id === 'lifted-up' && t.name === 'Lifted up'), `the note saves its body and tag ids; the new tag keeps its typed name (${JSON.stringify(note.tags)})`);
  check(await page.$('.v[data-vid="43003014"] .v-note') !== null && same(await vtags(43003014), ['Lifted up', 'love']), 'John 3:14 shows a note glyph and the chips Lifted up and love');
  // Tag sheet on part of a verse, without a note.
  await page.click('.v[data-vid="43003015"] .w[data-w="0"]');
  await sleep(200);
  await page.click('#abPart');
  await page.click('.v[data-vid="43003015"] .w[data-w="3"]');
  await page.click('.v[data-vid="43003015"] .w[data-w="6"]');
  await page.click('#abTag');
  await page.waitForSelector('#tagSheet.on', { timeout: 3000 });
  await sleep(300);
  check((await page.textContent('#tagsTitle')).includes('Tags on words 4–7'), 'the tag sheet names the selected words');
  await page.fill('#tagsTagIn', 'grace');
  await page.press('#tagsTagIn', 'Enter');
  await page.click('#tagsSave');
  await sleep(400);
  const tg = await lastItem();
  check(tg.kind === 'tag' && same(tg.tags, ['grace']) && tg.body === null && tg.anchor.partial && tg.anchor.start.word === 3 && tg.anchor.end.word === 6, 'Tag saves keywords on the selected words without a note');
  check(await page.evaluate(() => document.querySelectorAll('.v[data-vid="43003015"] .w.ul').length) === 4, 'tagged words carry a dotted underline');
  const ariaOk = await page.evaluate(() => Array.from(document.querySelectorAll('.v-note, .v-tag, .v-bm, #actionBar button')).every(el => (el.getAttribute('aria-label') || '').length > 0));
  check(ariaOk, 'every mark glyph, tag chip and bar button has an aria-label');
  await page.click('#abClose');
  await sleep(200);
  check(await page.evaluate(() => document.getElementById('actionBar').hidden && !document.querySelector('.v.sel')), 'Close hides the bar and clears the selection');
  await scrollVerseToFocus(43003015);
  await sleep(300);
  await shot('09-marks.png');

  // The strip and the peek show your marks on the target verse.
  await goQuiet(43, 3, 43003016);
  await waitStrip();
  await sleep(250);
  const rom = await page.evaluate(() => { const c = document.querySelector('#track .chip[data-rank="1"]'); return { mine: c.classList.contains('mine'), dot: !!c.querySelector('.mine-dot'), aria: c.getAttribute('aria-label') }; });
  check(rom.mine && rom.dot && /has your marks: Shared theme: loved$/.test(rom.aria), `the Romans 5:8 chip carries a small dot for your marks (${rom.aria})`);
  await page.click('#track .chip[data-rank="1"]');
  await page.waitForSelector('#peekSheet.on', { timeout: 3000 });
  await sleep(350);
  const mine = await page.textContent('#peekMine');
  check(mine.startsWith('Your notes') && mine.includes('grace · love') && mine.includes('He did not wait for us to get it together first.') && await page.$('#peekMine .cdot[aria-label="Blue highlight"]') !== null, `the peek shows a "Your notes" line: "${mine}"`);
  await page.click('#peekSheet [data-close]');
  await sleep(300);

  // My Study: tabs, counts, tags, jumping.
  await page.click('#studyBtn');
  await page.waitForSelector('#studySheet.on', { timeout: 3000 });
  await sleep(350);
  const tabCounts = await page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#studyTabs button')).map(b => [b.dataset.tab, +b.querySelector('.n').textContent])));
  check(same(tabCounts, { highlights: 5, bookmarks: 2, notes: 2, tags: 3 }), `My Study counts Highlights 5, Bookmarks 2, Notes 2, Tags 3 (${JSON.stringify(tabCounts)})`);
  const hlRows = await page.evaluate(() => Array.from(document.querySelectorAll('#studyList .mrow')).map(r => ({ label: r.querySelector('.m-top span').textContent, dot: !!r.querySelector('.cdot'), part: r.querySelector('.m-part')?.textContent || '', aria: r.getAttribute('aria-label') })));
  check(hlRows.length === 5 && hlRows.every(r => r.dot && r.aria) && hlRows[0].label === 'John 3:15' && hlRows[0].part === 'words 4–7', `Highlights lists 5 rows, newest first, each with a colour dot (${hlRows.map(r => r.label + (r.part ? ' ' + r.part : '')).join(', ')})`);
  await shot('13-my-study.png');
  await page.click('#studyTabs [data-tab="notes"]');
  await sleep(150);
  const noteRows = await page.evaluate(() => Array.from(document.querySelectorAll('#studyList .mrow')).map(r => ({ label: r.querySelector('.m-top span').textContent, sub: r.querySelector('.m-sub')?.textContent, tags: Array.from(r.querySelectorAll('.tpill')).map(t => t.textContent) })));
  check(noteRows.length === 2 && noteRows[0].label === 'John 3:14' && noteRows[0].sub === 'Moses and the snake point to the cross.' && same(noteRows[0].tags, ['Lifted up', 'love']), `Notes rows show the first line of the note and its tags (${JSON.stringify(noteRows[0])})`);
  await page.click('#studyTabs [data-tab="tags"]');
  await sleep(150);
  const tagRows = await page.evaluate(() => Array.from(document.querySelectorAll('#studyList .mrow')).map(r => [r.querySelector('.m-top span').textContent, +r.querySelector('.m-count').textContent]));
  check(same(tagRows, [['love', 4], ['grace', 2], ['Lifted up', 1]]), `Tags lists each tag with its verse count (${JSON.stringify(tagRows)})`);
  await shot('14-my-study-tags.png');
  await page.click('#studyList [data-tag="love"]');
  await sleep(200);
  const loveRows = await page.evaluate(() => Array.from(document.querySelectorAll('#studyList .mrow')).map(r => r.querySelector('.m-top span').textContent).sort());
  check(same(loveRows, ['1 John 3:16', 'John 3:14', 'John 3:16', 'Romans 5:8']) && !(await page.evaluate(() => document.getElementById('studyBack').hidden)), `tapping love lists its 4 verses (${loveRows.join(', ')})`);
  const romRow = await page.evaluate(() => Array.from(document.querySelectorAll('#studyList .mrow')).find(r => r.querySelector('.m-top span').textContent === 'Romans 5:8').dataset.ann);
  await page.click(`#studyList .mrow[data-ann="${romRow}"]`);
  await page.waitForFunction(() => document.getElementById('titleText').textContent === 'Romans 5', null, { timeout: 5000 });
  await sleep(400);
  const hopA = await evalState('window.asb.state.trail.hops[window.asb.state.trail.cursor]');
  check((await focusVid()) === 45005008 && hopA.kind === 'open' && hopA.vid === 45005008 && await page.evaluate(() => !document.getElementById('studySheet').classList.contains('on')), 'a My Study row jumps to Romans 5:8 and pushes an open hop');
  await page.click('#studyBtn');
  await page.waitForSelector('#studySheet.on', { timeout: 3000 });
  await page.click('#studyTabs [data-tab="bookmarks"]');
  await sleep(150);
  const bmRow = await page.evaluate(() => Array.from(document.querySelectorAll('#studyList .mrow')).find(r => r.querySelector('.m-top span').textContent === 'John 3:16–17').dataset.ann);
  await page.click(`#studyList .mrow[data-ann="${bmRow}"]`);
  await page.waitForFunction(() => document.getElementById('titleText').textContent === 'John 3', null, { timeout: 5000 });
  await sleep(400);
  const hopB = await evalState('window.asb.state.trail.hops[window.asb.state.trail.cursor]');
  check((await focusVid()) === 43003016 && hopB.kind === 'bookmarkOpen' && (await crumbs()).endsWith('Romans 5:8 → John 3:16'), `opening a bookmark pushes a bookmarkOpen hop (${await crumbs()})`);
  await page.click('#studyBtn');
  await page.waitForSelector('#studySheet.on', { timeout: 3000 });
  await page.click('#studyFoot [data-study="json"]');
  await page.waitForSelector('#jsonSheet.on', { timeout: 3000 });
  const annJson = await page.textContent('#jsonPre');
  check(/"schema": "asb\.annotations\/1"/.test(annJson) && /"rules": \{/.test(annJson) && /"lifted-up"/.test(annJson) && (await page.textContent('#jsonTitle')).includes('asb.annotations/1 document'), 'View JSON shows the live asb.annotations/1 document with its rules');
  await page.click('#jsonSheet [data-close]');
  await sleep(300);

  // Persistence across reload, dark mode, clear all, restore examples.
  const before = await annDoc();
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.v[data-vid="43003016"]', { timeout: 20000 });
  await sleep(600);
  const after = await annDoc(), g14r = await hlGroups(page, 43003014);
  check(after.items.length === before.items.length && after.items.length === 12 && g14r.length === 1 && g14r[0].bg === 'rgb(184, 230, 160)' && await page.$('.v[data-vid="43003014"] .v-note') !== null, `marks survive a reload (${after.items.length} items)`);
  await page.emulateMedia({ colorScheme: 'dark' });
  await sleep(300);
  const darkBg = (await hlGroups(page, 43003014))[0].bg;
  check(darkBg === 'rgba(184, 230, 160, 0.26)', `dark mode draws highlights at reduced opacity (${darkBg})`);
  await page.click('.v[data-vid="43003015"] .w[data-w="0"]');
  await page.waitForSelector('#actionBar:not([hidden])', { timeout: 3000 });
  await sleep(250);
  await shot('15-marks-dark.png');
  await page.click('#abClose');
  await page.click('#studyBtn');
  await page.waitForSelector('#studySheet.on', { timeout: 3000 });
  await sleep(350);
  await shot('16-my-study-dark.png');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.click('#studyTabs [data-tab="highlights"]');
  await page.click('#studyFoot [data-study="clear"]');
  check(/Remove all 12 marks and every tag\? This cannot be undone\./.test(await page.textContent('#studyFoot')), 'Clear all asks once before it removes anything');
  await page.click('#studyFoot [data-study="clearYes"]');
  await sleep(300);
  const cleared = await annDoc();
  check(cleared.items.length === 0 && cleared.tags.length === 0 && cleared.schema === 'asb.annotations/1' && cleared.palette.length === 5, 'Clear all my marks empties items and tags and keeps the palette');
  check((await page.textContent('#studyEmpty')) === 'No highlights yet. Tap a verse and pick a color.' && await page.evaluate(() => document.querySelectorAll('#reader .hlr, #reader .v-bm, #reader .v-note, #reader .v-tag').length) === 0, 'the empty state reads in plain words and the reader has no marks left');
  await page.click('#studyTabs [data-tab="tags"]');
  check((await page.textContent('#studyEmpty')) === 'No tags yet. Tap a verse, then Tag, or add tags to a note.', 'the Tags tab has its own empty state');
  await page.click('#studySheet [data-close]');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.v[data-vid="43003016"]', { timeout: 20000 });
  await sleep(500);
  check((await annDoc()).items.length === 0 && (await hlGroups(page, 43003016)).length === 0, 'after Clear all a reload does not bring the examples back');
  await page.click('#studyBtn');
  await page.waitForSelector('#studySheet.on', { timeout: 3000 });
  await page.click('#studyFoot [data-study="restore"]');
  await sleep(300);
  check((await annDoc()).items.length === seedDoc.items.length && (await hlGroups(page, 43003016)).length === 1, 'Restore examples brings the sample marks back');
  await page.click('#studySheet [data-close]');
  await sleep(300);

  // Storage that throws: the page still loads, seeds from the file and takes new marks in memory.
  const sx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  const sp = await sx.newPage();
  watch(sp);
  await sp.addInitScript(() => { const boom = () => { throw new Error('storage disabled'); }; Storage.prototype.getItem = boom; Storage.prototype.setItem = boom; Storage.prototype.removeItem = boom; });
  await sp.goto(url, { waitUntil: 'load' });
  await sp.waitForSelector('.v[data-vid="43003016"]', { timeout: 20000 });
  await sleep(600);
  const sxSeed = await hlGroups(sp, 43003016);
  await sp.click('.v[data-vid="43003015"] .w[data-w="0"]');
  await sp.waitForSelector('#actionBar:not([hidden])', { timeout: 3000 });
  await sp.click('#abSwatches .sw[data-color="blue"]');
  await sleep(200);
  check(sxSeed.length === 1 && (await hlGroups(sp, 43003015)).length === 1, 'when storage throws the page still seeds the examples and takes new marks');
  await sx.close();

  // 19. Console errors.
  const handled = await page.evaluate(() => window.asb.state.missing);
  const fontNoise = consoleErrors.filter(e => /Failed to load resource/.test(e.text) && /fonts\.(googleapis|gstatic)\.com/.test(e.url));
  if (fontNoise.length) console.log(`  note  ${fontNoise.length} Google Fonts request(s) failed in this sandbox (the page falls back to the system serif); not counted as app errors`);
  const real = consoleErrors.filter(e => !fontNoise.includes(e) && !(/Failed to load resource/.test(e.text) && handled.some(u => e.url.includes(u.replace(/^\.\//, '')))));
  check(real.length === 0, real.length ? `console errors: ${JSON.stringify(real)}` : 'no console errors');
} catch (e) {
  failures.push(`exception: ${e.stack || e}`);
  console.log('  EXCEPTION', e.stack || e);
  await page.screenshot({ path: path.join(shots, '99-failure.png') }).catch(() => {});
}
await browser.close();
console.log(`\n${passes.length} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach(f => console.log(' -', f)); process.exit(1); }
