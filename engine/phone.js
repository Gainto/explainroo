// s.phone and s.chat: a smartphone with a status bar, an app title, a text
// field that types and a keyboard with suggestions, and a messenger chat whose
// bubbles come in on their words, inside a phone or on their own.
//
// Both draw straight on the canvas in the look's colors, fonts and strokes,
// and tell check what they show: the phone and each bubble are shapes, and
// every text is logged with the color it is drawn on (the screen, the
// keyboard, the field or the bubble), so check measures its contrast there
// and not against the page. Their text size is `size`, which by default is
// the size labels need to read on a phone.

import { SceneError } from './stage.js';
import { clamp, ease, hashStr, contrast, cssColor, mixColor, withAlpha } from './util.js';
import { colorOf, fontString } from './themes.js';
import { layoutText } from './text.js';

// Width over height of the phone's body.
const ASPECT = 0.49;
const DARK_INK = '#111318';
const BODY = '#111418';
// Entrances that draw an element bit by bit; a phone comes in as a whole.
const DRAWN = new Set(['draw', 'write', 'type', 'words', 'sync', 'grow']);

const hex = (c) => cssColor(c) ?? c;

// fg where it reaches `min` on bg, otherwise white or near black, whichever
// reads better there.
export function readableOn(fg, bg, min = 4.5) {
  if (contrast(hex(fg), hex(bg)) >= min) return fg;
  return contrast('#ffffff', hex(bg)) >= contrast(DARK_INK, hex(bg)) ? '#ffffff' : DARK_INK;
}

// The text size of a phone and a chat: 40 pixels in a 1080 pixel wide tall or
// square frame, where check asks labels for at least that much, and 32 in a
// 1920 x 1080 frame, scaled with the frame.
export function chatSize(s) {
  return Math.round(((s.H >= s.W ? 40 : 32) * Math.min(s.W, s.H)) / 1080);
}

function area(a) {
  const w = a.w ?? a.width;
  const h = a.h ?? a.height;
  if (!(w > 0) || !(h > 0)) throw new SceneError('chat: in needs an area with a size, like the screen that s.phone hands its function');
  const left = a.left ?? a.x - w / 2;
  const top = a.top ?? a.y - h / 2;
  return { left, top, w, h, right: left + w, bottom: top + h, x: left + w / 2, y: top + h / 2 };
}

function box(x, y, w, h) {
  return { x, y, w, h, left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 };
}

// The colors of the phone's screen, in the look: a light screen on light looks
// and a dark one on dark looks, unless `dark` says otherwise.
function screenColors(th, dark) {
  const bg = hex(th.bg);
  const fill = dark ? (th.dark ? mixColor(bg, '#000000', 0.55) : '#16181d') : th.dark ? '#f6f7f9' : hex(th.surface);
  const ink = readableOn(dark ? (th.dark ? hex(th.ink) : '#f2f4f8') : th.dark ? DARK_INK : hex(th.ink), fill, 7);
  return {
    dark,
    fill,
    ink,
    muted: readableOn(mixColor(fill, ink, 0.62), fill, 4.5),
    field: mixColor(fill, ink, dark ? 0.1 : 0.05),
    line: mixColor(fill, ink, 0.22),
    keyboard: mixColor(fill, ink, dark ? 0.09 : 0.11),
    key: dark ? mixColor(fill, ink, 0.24) : mixColor(fill, '#ffffff', 0.85),
  };
}

// One line of text on a known background, logged for check with that
// background. `fit` shrinks it to a width, down to `least` of its size.
function line(s, str, { x, y, size, weight, color, bg, align = 'center', settled, ui = false, fit = 0, least = 0.7, owner = null }) {
  const ctx = s.ctx;
  const text = String(str);
  ctx.save();
  ctx.letterSpacing = '0px';
  let font = fontString(s.theme, 'body', size, weight);
  ctx.font = font;
  let w = ctx.measureText(text).width;
  if (fit && w > fit) {
    const smaller = Math.max(size * least, (size * fit) / w);
    size = smaller;
    font = fontString(s.theme, 'body', size, weight);
    ctx.font = font;
    w = ctx.measureText(text).width;
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  ctx.fillStyle = color;
  ctx.fillText(text, left, y);
  s._logText({ text, x0: left, y0: y - size * 0.62, x1: left + w, y1: y + size * 0.62, size, fg: color, bg, settled, ui: ui ? 1 : 0, shape: owner });
  ctx.restore();
  return { w, size, fits: !fit || w <= fit + 0.5 };
}

// A part of the phone that comes in at its own time, inside the phone.
function partLife(s, at, enter = 'fade', dur = 0.3) {
  return s._life({ at, enter, dur, sfx: null }, 'phone', { sfx: null });
}

export function phone(s, o = {}, fn) {
  if (typeof o === 'function') [o, fn] = [{}, o];
  if (fn !== undefined && typeof fn !== 'function') throw new SceneError('phone: the second argument must be a function that draws on the screen, like (screen) => s.chat([...], { in: screen })');
  const call = s._call('phone');
  const th = s.theme;
  const sf = s.safe;
  // Not full height, so a punch-in keeps it out of the caption band, and never
  // wider than the content area. The screen holds about nine letters of its
  // text size in a row; where the content area is short, as on Shorts and
  // TikTok, the phone gets a little wider and taller for that, and only then
  // does its text get smaller.
  const read = chatSize(s);
  const room = (size) => (size * 9) / 0.93;
  let h = o.h ?? (o.w ? o.w / ASPECT : sf.h * (s.H > s.W * 1.2 ? 0.7 : 0.84));
  let w = o.w ?? h * ASPECT;
  if (o.w === undefined && o.h === undefined) {
    const need = room(o.size ?? read);
    if (w < need) w = Math.min(need, h * 0.56);
    if (w < need) {
      h = Math.min(sf.h * 0.9, need / 0.56);
      w = Math.max(w, Math.min(need, h * 0.56));
    }
    if (w > sf.w * 0.92) {
      h *= (sf.w * 0.92) / w;
      w = sf.w * 0.92;
    }
  }
  const x = o.x ?? (sf.left ?? sf.x) + sf.w / 2;
  const y = o.y ?? (sf.top ?? sf.y) + sf.h / 2;
  const enter = o.enter ?? (DRAWN.has(th.enter.image) ? 'fade' : th.enter.image ?? 'fade');
  const colors = screenColors(th, o.dark ?? th.dark);
  const accent = hex(colorOf(th, o.color ?? s.engine.brandAccent ?? 'accent'));
  const seed = (part) => (hashStr(`${s.id}:${call}:${part}`) % 100000) + 1;

  // The screen inside the bezel, and from the top: status bar, app title.
  const bezel = w * 0.035;
  const sw = w - bezel * 2;
  // The readable size, or less where the phone is still too narrow for it.
  const size = o.size ?? Math.min(read, Math.floor(sw / 9));
  if (!(size > 0)) throw new SceneError('phone: size must be a number of pixels');
  const shh = h - bezel * 2;
  const top = y - shh / 2;
  const bottom = y + shh / 2;
  const left = x - sw / 2;
  const right = x + sw / 2;
  const statusH = Math.max(size * 1.4, shh * 0.05);
  const appH = o.app ? size * 2 : 0;
  // The home bar under everything.
  const homeH = size * 0.7;
  const kb = o.keyboard ? (o.keyboard === true ? {} : o.keyboard) : null;
  const picks = kb?.suggestions?.length ?? 0;
  if (kb && kb.pick !== undefined && kb.pick !== null && !(Number.isInteger(kb.pick) && kb.pick >= 0 && kb.pick < picks)) {
    throw new SceneError(picks ? `phone: keyboard.pick must be the number of a suggestion, from 0 to ${picks - 1}` : 'phone: keyboard.pick needs keyboard.suggestions to pick from');
  }
  const gap = sw * 0.012;
  const keyW = (sw - gap * 11) / 10;
  const keyH = Math.min(keyW * 1.2, size * 1.15);
  const sugH = size * 1.7;
  const kbH = kb ? sugH + keyH * 4 + gap * 1.5 * 4 + homeH : 0;
  const kbTop = bottom - kbH;
  const input = o.input === undefined || o.input === null || o.input === false ? null : typeof o.input === 'string' ? { text: o.input } : o.input === true ? {} : o.input;
  const fieldH = size * 1.85;
  const fieldBottom = (kb ? kbTop : bottom - homeH) - size * 0.35;
  const fieldY = fieldBottom - fieldH / 2;
  const contentTop = top + statusH + appH + size * 0.3;
  const contentBottom = input ? fieldBottom - fieldH - size * 0.3 : kb ? kbTop - size * 0.3 : bottom - homeH;
  const screen = {
    x, y: (contentTop + contentBottom) / 2, w: sw, h: contentBottom - contentTop,
    left, right, top: contentTop, bottom: contentBottom,
    unit: sw / 20, size, fill: colors.fill, ink: colors.ink, muted: colors.muted, dark: colors.dark,
    at: o.at ?? 0, ...(o.out !== undefined ? { out: o.out } : {}),
  };
  if (screen.h < size * 2) s._warn(`the screen of the ${call} has ${Math.max(0, Math.round(screen.h))}px left above its keyboard and field; make the phone taller with h, or lower size`, `phone room ${call}`);

  s.group({ at: o.at ?? 0, out: o.out, exit: o.exit, outDur: o.outDur, enter, dur: o.dur, x, y, scale: o.scale, rotate: o.rotate, opacity: o.opacity }, () => {
    const ctx = s.ctx;
    // The group moved the canvas to x, y when it is on screen or measured;
    // the phone draws in frame pixels.
    const moved = Boolean(s.engine.layoutLog) || s._suppress === 0;
    ctx.save();
    if (moved) ctx.translate(-x, -y);
    try {
      s._register(o.id, x, y, w, h);
      const life = s._life({ at: o.at ?? 0, out: o.out, exit: o.exit, outDur: o.outDur, enter: 'none', sfx: o.sfx, camera: o.camera, id: o.id }, 'phone', { sfx: null });
      if (life) drawPhone(life);
      // Text the scene draws on the screen is measured against the screen.
      const page = s._page;
      s._page = { top: colors.fill, bottom: colors.fill };
      try {
        if (fn) fn(screen);
      } finally {
        s._page = page;
      }
    } finally {
      ctx.restore();
    }
  });

  function drawPhone(life) {
    const ctx = s.ctx;
    const settled = s._settled(life);
    const rough = Boolean(th.stroke.rough);
    const stroke = rough ? hex(th.ink) : th.dark ? mixColor(hex(th.bg), hex(th.ink), 0.35) : mixColor(BODY, '#ffffff', 0.18);
    const border = rough ? th.stroke.width : 2;
    ctx.save();
    ctx.translate(x, y);
    s.pen.draw(ctx, { kind: 'rect', w, h, r: w * 0.14 }, { fill: BODY, stroke, width: border, fillStyle: 'solid', seed: seed('body'), shadow: s._shadow(undefined, { color: 'rgba(0,0,0,0.25)', blur: 30, y: 12 }) });
    s.pen.draw(ctx, { kind: 'rect', w: sw, h: shh, r: w * 0.11 }, { fill: colors.fill, stroke: 'none', width: 0, rough: false });
    ctx.restore();
    s._logShape('phone', { x, y, w, h }, settled, o, o.app ?? '', { border, call });

    // Status bar: the time, the island, signal and battery.
    const sy = top + statusH / 2;
    line(s, o.time ?? '9:41', { x: left + sw * 0.09, y: sy, size: size * 0.8, weight: 600, color: colors.ink, bg: colors.fill, align: 'left', settled, ui: true });
    ctx.save();
    const islandH = Math.min(statusH * 0.62, size * 0.85);
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.roundRect(x - sw * 0.14, sy - islandH / 2, sw * 0.28, islandH, islandH / 2);
    ctx.fill();
    ctx.fillStyle = colors.ink;
    const u = size * 0.16;
    const bx = right - sw * 0.09;
    ctx.globalAlpha *= 0.9;
    ctx.beginPath();
    ctx.roundRect(bx - u * 7, sy - u * 1.6, u * 6.2, u * 3.2, u * 0.9);
    ctx.lineWidth = Math.max(1, u * 0.45);
    ctx.strokeStyle = colors.ink;
    ctx.stroke();
    ctx.fillRect(bx - u * 6.1, sy - u * 0.85, u * 4.4, u * 1.7);
    for (let i = 0; i < 4; i++) ctx.fillRect(bx - u * 13 + i * u * 1.45, sy + u * 1.5 - u * (1 + i * 0.75), u * 0.95, u * (1 + i * 0.75));
    ctx.restore();

    if (o.app) {
      const ay = top + statusH + appH / 2;
      line(s, o.app, { x, y: ay, size, weight: 700, color: colors.ink, bg: colors.fill, settled, fit: sw * 0.8 });
      ctx.save();
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = Math.max(1, size * 0.04);
      ctx.beginPath();
      ctx.moveTo(left, top + statusH + appH);
      ctx.lineTo(right, top + statusH + appH);
      ctx.stroke();
      ctx.restore();
    }

    if (input) drawInput();
    if (kb) drawKeyboard();
    // The home bar.
    ctx.save();
    ctx.fillStyle = withAlpha(colors.ink, 0.55);
    ctx.beginPath();
    ctx.roundRect(x - sw * 0.17, bottom - homeH / 2 - size * 0.06, sw * 0.34, size * 0.12, size * 0.06);
    ctx.fill();
    ctx.restore();
  }

  function drawInput() {
    const ctx = s.ctx;
    const fieldAt = input.boxAt ?? o.at ?? 0;
    const fl = partLife(s, fieldAt);
    if (!fl) return;
    const fw = sw - size;
    // The text and the caret fade in with the field.
    ctx.save();
    ctx.globalAlpha *= s._enterTransform(fl).a;
    ctx.save();
    ctx.translate(x, fieldY);
    s.pen.draw(ctx, { kind: 'rect', w: fw, h: fieldH, r: fieldH / 2 }, { fill: colors.field, stroke: colors.line, width: Math.max(1.5, size * 0.05), fillStyle: 'solid', seed: seed('field') });
    ctx.restore();
    const text = input.text === undefined || input.text === null ? '' : String(input.text);
    const tx0 = x - fw / 2 + size * 0.6;
    const room = fw - size * 1.2;
    let caret = tx0;
    let typing = false;
    if (text) {
      const tAt = input.at ?? kb?.at ?? fieldAt;
      const kind = input.enter ?? 'type';
      const cps = input.cps ?? 16;
      const start = s.time(tAt);
      const length = text.length / cps / s.pace;
      if (kind === 'type') {
        const label = text.length > 40 ? text.slice(0, 37) + '...' : text;
        s._reveal(`phone-input|${call}`, {
          what: `the text "${label}" in the field of the ${call}`, at: start, end: start + length, out: o.out === undefined ? Infinity : s.time(o.out),
          missing: (t) => `has typed ${Math.floor(clamp((t - start) / length) * 100)}% of itself`,
          advice: `give input an earlier at, or a higher cps than ${cps}`,
        });
      }
      const tl = s._life({ at: tAt, enter: kind, dur: kind === 'type' ? text.length / cps : 0.3, sfx: input.sfx ?? null }, 'phone', { sfx: null });
      if (tl) {
        const shown = kind === 'type' ? text.slice(0, Math.floor(text.length * clamp(tl.local / Math.max(0.01, tl.dur)) + 1e-6)) : text;
        typing = kind === 'type' && shown.length < text.length;
        if (typing) s._partial({ name: `the field of the ${call}`, doing: 'still typing' });
        ctx.save();
        ctx.globalAlpha *= kind === 'type' ? 1 : s._enterTransform(tl).a;
        ctx.font = fontString(th, 'body', size);
        ctx.letterSpacing = '0px';
        const full = ctx.measureText(shown).width;
        // A long text scrolls to its end, as in a real field.
        const shift = Math.max(0, full - room);
        ctx.beginPath();
        ctx.rect(tx0 - 2, fieldY - fieldH / 2, room + 4, fieldH);
        ctx.clip();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = colors.ink;
        ctx.fillText(shown, tx0 - shift, fieldY);
        ctx.restore();
        caret = tx0 + Math.min(full, room) + size * 0.06;
        s._logText({ text, x0: tx0, y0: fieldY - size * 0.62, x1: tx0 + Math.max(Math.min(full, room), size * 0.5), y1: fieldY + size * 0.62, size, fg: colors.ink, bg: colors.field, settled: s._settled(tl) && !typing, partial: typing ? { name: `the field of the ${call}`, doing: 'still typing' } : null });
      }
    }
    // The caret blinks while the field waits and stays on while it types.
    if (input.caret !== false && (typing || Math.floor(s.T * 2) % 2 === 0)) {
      ctx.save();
      ctx.fillStyle = accent;
      ctx.fillRect(caret, fieldY - size * 0.55, Math.max(2, size * 0.07), size * 1.1);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawKeyboard() {
    const ctx = s.ctx;
    const kbAt = kb.at ?? o.at ?? 0;
    const kl = partLife(s, kbAt, 'rise', 0.45);
    if (!kl) return;
    const settled = s._settled(kl);
    // It slides up from the bottom of the screen.
    const slide = (1 - ease.out(kl.p)) * kbH;
    // Everything of the keyboard stays inside the screen while it slides.
    const clipped = () => {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(left, top, sw, shh, w * 0.11);
      ctx.clip();
    };
    clipped();
    ctx.translate(0, slide);
    ctx.fillStyle = colors.keyboard;
    ctx.fillRect(left, kbTop, sw, kbH + w * 0.11);
    // Three rows of letters and a row with the space bar.
    const rows = [10, 9, 7];
    const rowY = (r) => kbTop + sugH + gap * 1.5 + r * (keyH + gap * 1.5) + keyH / 2;
    const key = (kx, ky, kw, name) => {
      ctx.save();
      ctx.translate(kx, ky);
      s.pen.draw(ctx, { kind: 'rect', w: kw, h: keyH, r: Math.min(keyW * 0.2, keyH * 0.25) }, { fill: colors.key, stroke: 'none', width: 0, fillStyle: 'solid', seed: seed(name) });
      ctx.restore();
    };
    rows.forEach((n, r) => {
      const rowW = n * keyW + (n - 1) * gap;
      for (let k = 0; k < n; k++) key(x - rowW / 2 + keyW / 2 + k * (keyW + gap), rowY(r), keyW, `key${r}-${k}`);
    });
    const side = keyW * 1.6;
    key(left + gap * 1.5 + side / 2, rowY(3), side, 'key-123');
    key(x, rowY(3), sw * 0.5, 'key-space');
    key(right - gap * 1.5 - side / 2, rowY(3), side, 'key-return');
    ctx.restore();

    // The suggestion bar, which shows words of its own.
    const words = kb.suggestions ?? [];
    if (!words.length) return;
    const sl = partLife(s, kb.suggestAt ?? kbAt);
    if (!sl) return;
    const sugSettled = settled && s._settled(sl);
    const slot = sw / words.length;
    const sy = kbTop + sugH / 2 + slide;
    clipped();
    ctx.globalAlpha *= s._enterTransform(sl).a;
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = Math.max(1, size * 0.04);
    for (let i = 1; i < words.length; i++) {
      ctx.beginPath();
      ctx.moveTo(left + slot * i, sy - sugH * 0.25);
      ctx.lineTo(left + slot * i, sy + sugH * 0.25);
      ctx.stroke();
    }
    words.forEach((word, i) => {
      const cx = left + slot * (i + 0.5);
      const shown = line(s, word, { x: cx, y: sy, size, weight: 500, color: readableOn(colors.ink, colors.keyboard), bg: colors.keyboard, settled: sugSettled, fit: slot - size * 0.5 });
      if (!shown.fits) s._warn(`the suggestion "${String(word).slice(0, 40)}" of the ${call} is wider than its place in the suggestion bar; use a shorter word, fewer suggestions, a wider phone or a lower size`, `phone suggestion ${call} ${i}`);
    });
    ctx.restore();
    if (kb.pick === undefined || kb.pick === null) return;
    const pl = partLife(s, kb.pickAt ?? kb.suggestAt ?? kbAt, 'pop', 0.4);
    if (!pl) return;
    clipped();
    const tr = s._enterTransform(pl);
    ctx.translate(left + slot * (kb.pick + 0.5), sy);
    ctx.scale(tr.s, tr.s);
    ctx.globalAlpha *= tr.a;
    s.pen.draw(ctx, { kind: 'rect', w: slot - size * 0.3, h: sugH * 0.82, r: sugH * 0.41 }, { fill: 'none', stroke: accent, width: Math.max(3, size * 0.09), seed: seed('ring') });
    ctx.restore();
  }

  return { ...box(x, y, w, h), screen };
}

// A messenger chat: messages [{ from: 'me' | 'them', text, at }] from the top
// of the area down, mine on the right in the accent color, theirs on the left.
export function chat(s, messages, o = {}) {
  if (!Array.isArray(messages)) throw new SceneError("chat: messages must be a list like [{ from: 'them', text: 'Hi', at: 0 }, { from: 'me', text: 'Hey!', at: 'hey' }]");
  const call = s._call('chat');
  const th = s.theme;
  const ctx = s.ctx;
  const inside = o.in ?? null;
  const size = o.size ?? inside?.size ?? chatSize(s);
  if (!(size > 0)) throw new SceneError('chat: size must be a number of pixels');
  let a;
  if (inside) {
    const sc = area(inside);
    const pad = size * 0.5;
    a = area({ left: sc.left + pad, top: sc.top + pad * 0.6, w: sc.w - pad * 2, h: sc.h - pad * 0.6 });
  } else {
    const sf = s.safe;
    const w = o.w ?? Math.min(sf.w * 0.9, size * 20);
    const h = o.h ?? sf.h * 0.9;
    a = area({ x: o.x ?? (sf.left ?? sf.x) + sf.w / 2, y: o.y ?? (sf.top ?? sf.y) + sf.h / 2, w, h });
  }
  // What the chat is drawn on: the phone's screen, or the page.
  const base = hex(inside?.fill ?? s._page?.top ?? th.bg);
  const ink = hex(inside?.ink ?? th.ink);
  const accent = hex(colorOf(th, o.color ?? s.engine.brandAccent ?? 'accent'));
  const theirs = hex(o.them ?? mixColor(base, ink, th.dark || inside?.dark ? 0.16 : 0.1));
  const colors = {
    // White or near black on the accent, whichever reads better: white on a
    // blue accent, dark on a light one like blueprint's yellow.
    me: { fill: accent, text: contrast(DARK_INK, accent) > contrast('#ffffff', accent) ? DARK_INK : '#ffffff' },
    them: { fill: theirs, text: readableOn(ink, theirs) },
  };
  const rough = Boolean(th.stroke.rough);
  const font = fontString(th, 'body', size);
  const pad = size * 0.6;
  const maxW = a.w * 0.8 - pad * 2;
  const lineHeight = 1.22;
  const gapY = size * 0.45;
  const nameSize = size * 0.75;
  const enter = o.enter ?? 'pop';
  const timeOf = (m) => s.time(m.at ?? o.at ?? 0);

  // Where every bubble goes, so they keep their place as the others come in.
  let yy = a.top;
  const named = new Set();
  const slots = messages.map((m, i) => {
    if (!m || typeof m !== 'object' || (m.from !== 'me' && m.from !== 'them')) throw new SceneError(`chat: message ${i + 1} needs from: 'me' or from: 'them'`);
    const text = String(m.text ?? '');
    ctx.save();
    ctx.letterSpacing = '0px';
    const lay = layoutText(ctx, { str: text, font, size, maxWidth: maxW, lineHeight });
    ctx.restore();
    const mine = m.from === 'me';
    const name = o.names?.[m.from];
    let label = null;
    if (name && !named.has(m.from)) {
      named.add(m.from);
      label = { text: String(name), y: yy + nameSize * 0.6 };
      yy += nameSize * 1.35;
    }
    const bw = lay.width + pad * 2;
    const bh = lay.height + pad * 1.3;
    const bx = mine ? a.right - bw / 2 : a.left + bw / 2;
    const slot = { m, i, mine, lay, text, label, top: yy, x: bx, y: yy + bh / 2, w: bw, h: bh, at: timeOf(m) };
    yy += bh + gapY;
    return slot;
  });
  let bottom = slots.length ? yy - gapY : a.top;

  // Three dots in their bubble, in the place of the first message that comes
  // after them, which takes the place when it arrives.
  let typing = null;
  if (o.typing) {
    const tAt = s.time(o.typing.at ?? o.at ?? 0);
    // The dots stand for their next message: they sit in its place and leave
    // when it comes.
    const reply = slots.find((sl) => !sl.mine && sl.at > tAt + 1e-6);
    const th2 = size * 1.6;
    const tw = size * 3.4;
    const tTop = reply ? reply.top : bottom + (slots.length ? gapY : 0);
    typing = { at: o.typing.at ?? o.at ?? 0, out: o.typing.out ?? (reply ? reply.m.at ?? o.at ?? 0 : o.out), x: a.left + tw / 2, y: tTop + th2 / 2, w: tw, h: th2 };
    if (!reply) bottom = Math.max(bottom, typing.y + th2 / 2);
  }

  // When the messages don't fit, the chat scrolls up as each one comes in, as
  // a messenger does, and what leaves the top is cut off there: under the app
  // bar of a phone.
  // Inside a phone the newest bubble stops a little above the field.
  const floor = a.bottom - (inside ? size * 0.25 : 0);
  const scrolls = o.scroll !== false && bottom > floor + 1;
  let shift = 0;
  if (scrolls) {
    const events = slots.map((sl) => ({ at: sl.at, bottom: sl.top + sl.h }));
    if (typing) events.push({ at: s.time(typing.at), bottom: typing.y + typing.h / 2 });
    events.sort((p, q) => p.at - q.at);
    let reach = 0;
    for (const e of events) {
      const p = clamp((s.t - e.at) / (0.45 / s.pace));
      if (p <= 0) break;
      reach = Math.max(reach, e.bottom - floor);
      shift += (reach - shift) * ease.inOut(p);
    }
  }
  const view = inside ? area(inside) : area({ left: a.left - size, top: a.top - size * 0.3, w: a.w + size * 2, h: a.h + size * 0.3 + gapY });
  // 'in' the view, 'cut' partly under its top edge, or 'gone' above it.
  const seen = (top, bot) => (!scrolls || top - shift >= view.top - 0.5 ? 'in' : bot - shift <= view.top ? 'gone' : 'cut');
  if (scrolls) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.left, view.top, view.w, view.h);
    ctx.clip();
  }

  // Names above the first bubble of each side.
  for (const sl of slots) {
    if (!sl.label) continue;
    const ll = s._life({ at: sl.m.at ?? o.at ?? 0, out: sl.m.out ?? o.out, exit: o.exit, enter: 'fade', dur: 0.3, sfx: null }, 'chat', { sfx: null });
    const where = seen(sl.label.y - nameSize * 0.6, sl.label.y + nameSize * 0.6);
    if (!ll || where !== 'in') continue;
    ctx.save();
    ctx.globalAlpha *= s._enterTransform(ll).a;
    line(s, sl.label.text, { x: sl.mine ? a.right - size * 0.2 : a.left + size * 0.2, y: sl.label.y - shift, size: nameSize, weight: 600, color: readableOn(mixColor(base, ink, 0.62), base), bg: inside?.fill ?? null, align: sl.mine ? 'right' : 'left', settled: s._settled(ll), ui: true });
    ctx.restore();
  }

  const bubbles = [];
  for (const sl of slots) {
    const { m, mine, lay } = sl;
    bubbles.push({ from: m.from, at: sl.at, ...box(sl.x, sl.y - shift, sl.w, sl.h) });
    // A chat that scrolls moves its bubbles, so the camera keeps to the whole.
    s._register(m.id, sl.x, sl.y - shift, sl.w, sl.h);
    const life = s._life({ at: m.at ?? o.at ?? 0, out: m.out ?? o.out, exit: m.exit ?? o.exit, outDur: o.outDur, enter: m.enter ?? enter, sfx: m.sfx ?? o.sfx, camera: scrolls ? false : o.camera, id: m.id }, 'chat', { sfx: null, label: sl.text.slice(0, 40) });
    if (sl.h > a.h + 1) s._warn(`the chat bubble "${sl.text.slice(0, 40)}" of the ${call} is taller than the chat (${Math.round(a.h)}px); shorten it, lower size or give the chat more room`, `chat tall ${call} ${sl.i}`);
    if (sl.w > a.w + 1) s._warn(`the chat bubble "${sl.text.slice(0, 40)}" of the ${call} is ${Math.round(sl.w)}px wide, wider than the chat (${Math.round(a.w)}px), as a word in it is too long to wrap; shorten it or lower size`, `chat wide ${call} ${sl.i}`);
    const where = seen(sl.top, sl.top + sl.h);
    if (!life || where === 'gone') continue;
    const c = colors[mine ? 'me' : 'them'];
    s._push(sl.x, sl.y - shift, life, {});
    const settled = s._settled(life);
    // A bubble cut off at the top is on its way out, and check leaves it alone.
    const log = where === 'in';
    const own = !log ? null : s._logShape('bubble', { w: sl.w, h: sl.h }, settled, { id: m.id, overlap: o.overlap }, sl.text, { border: rough ? th.stroke.width * 0.6 : 0, call });
    s.pen.draw(ctx, { kind: 'rect', w: sl.w, h: sl.h, r: Math.min(size * 0.9, sl.h / 2) }, { fill: c.fill, stroke: rough ? hex(th.ink) : 'none', width: rough ? th.stroke.width * 0.6 : 0, fillStyle: 'solid', seed: (hashStr(`${s.id}:${call}:bubble${sl.i}`) % 100000) + 1 });
    // The text starts at the left of the bubble, on the lines it was measured on.
    ctx.font = font;
    ctx.letterSpacing = '0px';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const x0 = -lay.width / 2;
    const y0 = -lay.height / 2;
    const mark = mine ? c.text : readableOn(accent, c.fill, 3);
    let marked = false;
    for (const ln of lay.lines) {
      for (const wd of ln.words) {
        ctx.fillStyle = wd.accent ? mark : c.text;
        ctx.fillText(wd.text, x0 + wd.x, y0 + ln.y);
        marked ||= Boolean(wd.accent);
      }
    }
    if (log) s._logText({ text: sl.text.replace(/\*/g, ''), x0, y0, x1: -x0, y1: -y0, size, fg: c.text, bg: c.fill, settled, mark: marked ? mark : null, shape: own });
    ctx.restore();
  }

  if (typing) {
    const tl = s._life({ at: typing.at, out: typing.out, exit: 'fade', outDur: 0.2, enter: 'pop', dur: 0.4, sfx: o.typing.sfx ?? null }, 'chat', { sfx: null });
    if (tl && seen(typing.y - typing.h / 2, typing.y + typing.h / 2) !== 'gone') {
      s._push(typing.x, typing.y - shift, tl, {});
      s._logShape('bubble', { w: typing.w, h: typing.h }, s._settled(tl), { overlap: o.overlap }, '', { call });
      s.pen.draw(ctx, { kind: 'rect', w: typing.w, h: typing.h, r: typing.h / 2 }, { fill: colors.them.fill, stroke: rough ? hex(th.ink) : 'none', width: rough ? th.stroke.width * 0.6 : 0, fillStyle: 'solid', seed: (hashStr(`${s.id}:${call}:typing`) % 100000) + 1 });
      ctx.fillStyle = withAlpha(colors.them.text, 0.75);
      for (let i = 0; i < 3; i++) {
        const hop = Math.max(0, Math.sin(s.t * 7 - i * 0.9)) * size * 0.14;
        ctx.beginPath();
        ctx.arc((i - 1) * size * 0.7, -hop, size * 0.17, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  if (scrolls) ctx.restore();
  if (!scrolls && bottom > a.bottom + 1) s._warn(`the ${call} runs ${Math.round(bottom - a.bottom)}px below its area; use fewer or shorter messages, a lower size, a taller area (h, or a taller phone), or let it scroll`, `chat room ${call}`);
  bottom -= shift;
  const all = bubbles.length ? { left: Math.min(...bubbles.map((b) => b.left)), right: Math.max(...bubbles.map((b) => b.right)), top: Math.max(view.top, bubbles[0].top), bottom } : null;
  if (o.id !== undefined && o.id !== null && all) s._ids.set(String(o.id), { x: (all.left + all.right) / 2, y: (all.top + all.bottom) / 2, w: all.right - all.left, h: all.bottom - all.top, shape: 'rect' });
  return { bubbles, bottom, top: a.top, left: a.left, right: a.right, w: a.w, h: a.h, x: a.x, y: a.y };
}
