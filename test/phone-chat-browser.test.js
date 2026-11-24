// s.phone and s.chat: they draw in every size, their text is big enough to
// read on a phone, check measures text on the screen against the screen, my
// bubbles pick a text color that reads on the accent, a bubble is as big as
// its wrapped text, and parts come and go on their own times.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { buildTimeline } from '../src/timeline.js';
import { contrast } from '../engine/util.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

function project(t, settings, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-phone-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', music: false, sfx: false, captions: false, camera: 'still', watermark: false, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## one {min=4}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { one(s) {\n${body}\n} };\n`);
  return loadProject(dir);
}

// What check finds in the scene.
async function check(t, settings, body) {
  const p = project(t, settings, body);
  return withEngine(p, buildTimeline(p, {}), { scale: 0.5 }, (page) => page.evaluate(() => window.explainroo.check()));
}

// Draws the scene at each time, and gives what the body returned and the
// texts check logged, or the error it threw.
async function draw(t, settings, body, times) {
  const p = project(t, settings, 'return null;');
  const timeline = buildTimeline(p, {});
  return withEngine(p, timeline, { scale: 1 }, (page) => page.evaluate(async ({ body, times }) => {
    const { Engine, fetchState } = await import('/engine/runtime.js');
    const state = await fetchState();
    const fn = new Function('s', body);
    return times.map((at) => {
      let value = null;
      const engine = new Engine({ canvas: document.createElement('canvas'), state, scenes: { one(s) { value = fn(s); } }, icons: {}, images: new Map() });
      engine.textLog = [];
      try {
        engine.drawScene(engine.ctx, 0, at);
      } catch (e) {
        return { error: e.message };
      }
      return { value, texts: engine.textLog.filter((x) => !x.problem).map(({ text, x0, y0, x1, y1, fg, bg, size, page }) => ({ text, x0, y0, x1, y1, fg, bg, size, page })), problems: engine.textLog.filter((x) => x.problem).map((x) => x.problem) };
    });
  }, { body, times }));
}

const SCENE = `
  s.phone({ app: 'Messages', input: { text: 'see you soon', at: 1 }, keyboard: { at: 0.5, suggestions: ['later', 'soon', 'there'], pick: 1, pickAt: 1.5 } }, (sc) => {
    s.chat([{ from: 'them', text: 'Dinner at 7?', at: 0.2 }, { from: 'me', text: 'Yes!', at: 0.6 }], { in: sc });
  });`;

test('s.phone with a keyboard and a chat draws without problems in 16:9, 9:16 and 1:1, and its text is readable in 9:16', { skip, timeout: 240000 }, async (t) => {
  for (const size of ['16:9', '9:16', '1:1']) {
    const issues = await check(t, { size, captions: 'auto' }, SCENE);
    const bad = issues.filter((i) => i.level !== 'hint' && !/first frame|doesn't change/.test(i.message));
    assert.deepEqual(bad, [], `${size}: ${JSON.stringify(bad)}`);
    // In a tall frame, which people watch on a phone, no text of the phone is too small.
    if (size === '9:16') assert.deepEqual(issues.filter((i) => /px tall|hard to read/.test(i.message)), []);
  }
  // The default text size is the 40 pixels labels need in a 1080 pixel wide tall frame.
  const [shown] = await draw(t, { size: '9:16', captions: 'auto' }, `${SCENE} return null;`, [3]);
  for (const text of ['Messages', 'Dinner at 7?', 'Yes!', 'see you soon', 'later', 'soon', 'there']) {
    const tx = shown.texts.find((x) => x.text === text);
    assert.ok(tx, `${text} in ${JSON.stringify(shown.texts.map((x) => x.text))}`);
    assert.ok(tx.size >= 40, `${text} is ${tx.size}px`);
  }
  // Not full height: room for a punch-in above the caption band.
  const [box] = await draw(t, { size: '9:16', captions: 'auto' }, 'return { phone: s.phone({}), safe: s.safe };', [1]);
  assert.ok(Math.abs(box.value.phone.h - box.value.safe.h * 0.7) < 1, JSON.stringify(box.value));
  assert.ok(box.value.phone.screen.size >= 40 && box.value.phone.screen.unit > 0);
});

test('check measures the texts of a phone on a light look against its screen, and the scene\'s own text there too', { skip, timeout: 240000 }, async (t) => {
  for (const theme of ['clean', 'paper', 'studio']) {
    for (const dark of [false, true]) {
      const issues = await check(t, { theme, size: '9:16' }, `
        s.phone({ dark: ${dark}, app: 'Inbox', input: { text: 'hello', at: 0 }, keyboard: { suggestions: ['hi', 'hey'], pick: 0 } }, (sc) => {
          s.chat([{ from: 'them', text: 'Hi there', at: 0 }, { from: 'me', text: 'Hello', at: 0.3 }], { in: sc, names: { them: 'Sam' }, typing: { at: 0.5 } });
          s.text('On screen', { x: sc.x, y: sc.bottom - 40, size: 40, color: sc.ink, at: 0 });
        });`);
      assert.deepEqual(issues.filter((i) => /contrast/.test(i.message)), [], `${theme} dark ${dark}`);
    }
  }
  // Ink of the page on a dark screen does not read, and check says so.
  const issues = await check(t, { theme: 'clean', size: '9:16' }, `
    s.phone({ dark: true }, (sc) => s.text('Dark on dark', { x: sc.x, y: sc.y, size: 40, at: 0 }));`);
  assert.equal(issues.filter((i) => /"Dark on dark" has low contrast/.test(i.message)).length, 1, JSON.stringify(issues));
});

test('my bubbles take white or dark text, whichever reads on the accent, and theirs read on their fill', { skip, timeout: 120000 }, async (t) => {
  const body = `return s.chat([{ from: 'me', text: 'Mine', at: 0 }, { from: 'them', text: 'Theirs', at: 0 }]);`;
  for (const [theme, ink] of [['blueprint', '#111318'], ['midnight', '#111318'], ['clean', '#ffffff']]) {
    const [r] = await draw(t, { theme, size: '9:16' }, body, [2]);
    const mine = r.texts.find((x) => x.text === 'Mine');
    const theirs = r.texts.find((x) => x.text === 'Theirs');
    assert.equal(mine.fg, ink, theme);
    assert.ok(contrast(mine.fg, mine.bg) >= 4.5, `${theme}: ${mine.fg} on ${mine.bg}`);
    assert.ok(contrast(theirs.fg, theirs.bg) >= 4.5, `${theme}: ${theirs.fg} on ${theirs.bg}`);
  }
});

test('a bubble is as big as its wrapped text, which starts at its left, inside the chat', { skip, timeout: 120000 }, async (t) => {
  const long = 'This message is long enough that it has to wrap onto a few lines in the bubble';
  const [r] = await draw(t, { size: '9:16' }, `return s.chat([{ from: 'them', text: ${JSON.stringify(long)}, at: 0 }, { from: 'me', text: ${JSON.stringify(long)}, at: 0 }, { from: 'me', text: 'Short', at: 0 }], { w: 600, x: 540, y: 700, h: 1000 });`, [2]);
  assert.deepEqual(r.problems, []);
  const { bubbles } = r.value;
  const size = 40;
  const pad = size * 0.6;
  for (const [i, b] of bubbles.entries()) {
    const tx = r.texts.filter((x) => x.bg && x.y0 >= b.top - 1 && x.y1 <= b.bottom + 1)[0];
    assert.ok(tx, JSON.stringify(b));
    // Left aligned: every bubble's text starts one padding in from its left.
    assert.ok(Math.abs(tx.x0 - (b.left + pad)) < 0.5, `${i}: ${tx.x0} vs ${b.left + pad}`);
    // The bubble holds its text with the padding on each side, so nothing runs out.
    assert.ok(Math.abs(tx.x1 - (b.right - pad)) < 0.5, `${i}: ${tx.x1} vs ${b.right - pad}`);
    assert.ok(tx.y0 > b.top && tx.y1 < b.bottom, `${i}: ${JSON.stringify(tx)} in ${JSON.stringify(b)}`);
    // Inside the chat, mine on the right, theirs on the left.
    assert.ok(b.left >= 240 - 0.5 && b.right <= 840 + 0.5, JSON.stringify(b));
  }
  assert.ok(Math.abs(bubbles[0].left - 240) < 0.5 && Math.abs(bubbles[1].right - 840) < 0.5);
  // The long ones wrap into several lines, within 80% of the chat's width.
  assert.ok(bubbles[0].h > size * 3 && bubbles[0].w <= 600 * 0.8 + 0.5, JSON.stringify(bubbles[0]));
  assert.ok(bubbles[2].h < size * 2, JSON.stringify(bubbles[2]));
  // Top down, without overlapping.
  assert.ok(bubbles[1].top > bubbles[0].bottom && bubbles[2].top > bubbles[1].bottom);
  // A chat that does not fit scrolls up as its messages come in, and what
  // leaves the top is cut off there; with scroll: false, check says it runs out.
  const many = `Array.from({ length: 8 }, (_, i) => ({ from: i % 2 ? 'me' : 'them', text: 'Message ' + i, at: i * 0.5 }))`;
  const frames = await draw(t, { size: '9:16' }, `return s.chat(${many}, { x: 540, y: 600, w: 700, h: 400 });`, [0.2, 6]);
  assert.deepEqual(frames.map((f) => f.problems), [[], []]);
  const area = { top: 400, bottom: 800 };
  assert.deepEqual(frames[0].texts.map((x) => x.text), ['Message 0']);
  const late = frames[1].texts;
  assert.ok(late.some((x) => x.text === 'Message 7') && !late.some((x) => x.text === 'Message 0'), JSON.stringify(late.map((x) => x.text)));
  for (const tx of late) assert.ok(tx.y0 >= area.top - 20 && tx.y1 <= area.bottom + 1, JSON.stringify(tx));
  const [full] = await draw(t, { size: '9:16' }, `return s.chat(${many}, { x: 540, y: 600, w: 700, h: 400, scroll: false });`, [6]);
  assert.ok(full.problems.some((p) => /the 1st s\.chat runs \d+px below its area/.test(p)), JSON.stringify(full.problems));
});

test('the phone and its parts come in on their at and leave on out, and so does a chat on its screen', { skip, timeout: 120000 }, async (t) => {
  const body = `
    s.phone({ at: 1, out: 6, keyboard: { at: 2, suggestions: ['yes', 'no'], suggestAt: 3 }, input: { text: 'ok', at: 4, enter: 'fade' } }, (sc) => {
      s.chat([{ from: 'them', text: 'First', at: 1.5 }, { from: 'me', text: 'Second', at: 3.5, out: 5 }], { in: sc, typing: { at: 2.5 } });
    });
    return null;`;
  const times = [0.5, 1.2, 2.2, 3.2, 3.8, 4.8, 5.6, 6.8];
  const frames = await draw(t, { size: '9:16' }, body, times);
  const shown = (i) => frames[i].texts.map((x) => x.text);
  for (const f of frames) assert.ok(!f.error, f.error);
  assert.deepEqual(shown(0), []);
  assert.deepEqual(shown(1), ['9:41']);
  assert.deepEqual(shown(2), ['9:41', 'First']);
  assert.deepEqual(shown(3), ['9:41', 'yes', 'no', 'First']);
  assert.deepEqual(shown(4), ['9:41', 'yes', 'no', 'First', 'Second']);
  assert.deepEqual(shown(5), ['9:41', 'ok', 'yes', 'no', 'First', 'Second']);
  // "Second" has left at 5 and its exit is over; the phone leaves at 6 with all it holds.
  assert.deepEqual(shown(6), ['9:41', 'ok', 'yes', 'no', 'First']);
  assert.deepEqual(shown(7), []);
  // Text on the screen is logged on the screen's color, not on the page.
  const first = frames[3].texts.find((x) => x.text === '9:41');
  assert.ok(first.bg, JSON.stringify(first));
  const [bad] = await draw(t, {}, `s.phone({ keyboard: { suggestions: ['a'], pick: 3 } }); return null;`, [2]);
  assert.match(bad.error, /keyboard\.pick must be the number of a suggestion, from 0 to 0/);
  // A pick is checked when the phone is drawn, also before its keyboard shows.
  const [early] = await draw(t, {}, `s.phone({ keyboard: { at: 3, pick: 0 } }); return null;`, [0.5]);
  assert.match(early.error, /keyboard\.pick needs keyboard\.suggestions/);
  // The typing dots sit where their reply comes, below a message of mine
  // that comes in between, and leave when the reply arrives.
  const order = `return s.chat([{ from: 'them', text: 'Hi', at: 0 }, { from: 'me', text: 'A long message of mine here', at: 1 }, { from: 'them', text: 'Reply', at: 2 }], { x: 540, y: 600, w: 700, h: 800, typing: { at: 0.5 } });`;
  const [during, after] = await draw(t, {}, order, [1.5, 2.5]);
  assert.ok(!during.error && !after.error);
  const reply = after.value.bubbles[2];
  assert.ok(reply.top > after.value.bubbles[1].bottom);
  const [wrong] = await draw(t, {}, `s.chat([{ text: 'who?' }]); return null;`, [2]);
  assert.match(wrong.error, /chat: message 1 needs from: 'me' or from: 'them'/);
});
