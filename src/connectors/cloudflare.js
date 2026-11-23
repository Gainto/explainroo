// Cloudflare Workers AI: images from Flux on the user's own Cloudflare account.
// The account has a free daily allocation of neurons; above it a free account
// is refused (code 3036, HTTP 429) and a Workers Paid account pays per neuron.
//
// flux-1-schnell takes only a prompt (at most 2048 characters) and the number
// of steps (at most 8). It has no width or height and answers with a square
// JPEG of 1024 x 1024 in base64, so another aspect is cut from the middle.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findEnv } from '../env.js';
import { ffmpeg, probe } from '../ffmpeg.js';
import { ProjectError, ServiceError, rememberSecret, thrownOutcome } from '../errors.js';
import { serviceUrl } from '../services.js';

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const STEPS = 4;
const MAX_PROMPT = 2048;
// Cloudflare's price list: 4.80 neurons per 512 x 512 tile and 9.60 per step,
// and $0.011 per 1,000 neurons above the free allocation.
const NEURONS_PER_TILE = 4.8;
const NEURONS_PER_STEP = 9.6;
const USD_PER_NEURON = 0.011 / 1000;
const QUOTA_CODE = 3036;

function neuronsUsd(width, height) {
  const tiles = Math.ceil(width / 512) * Math.ceil(height / 512);
  return Math.round((tiles * NEURONS_PER_TILE + STEPS * NEURONS_PER_STEP) * USD_PER_NEURON * 1e6) / 1e6;
}

function findKey(dir) {
  const account = findEnv('CLOUDFLARE_ACCOUNT_ID', dir);
  const token = rememberSecret(findEnv('CLOUDFLARE_API_TOKEN', dir));
  return account && token ? token : null;
}

function key(dir) {
  const account = findEnv('CLOUDFLARE_ACCOUNT_ID', dir);
  const token = rememberSecret(findEnv('CLOUDFLARE_API_TOKEN', dir));
  if (!account || !token) throw new ProjectError('images from Cloudflare need CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a token with the permission "Workers AI: Read"). Set both in the environment or in the settings file.');
  return { account, token };
}

async function send(url, token, init, timeout) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new ServiceError(`Cloudflare did not answer in ${Math.round(timeout / 1000)} seconds`, 'lost');
    const outcome = thrownOutcome(e);
    throw new ServiceError(outcome === 'refused' ? 'could not reach Cloudflare. Check your connection and try again' : 'the connection to Cloudflare dropped before the answer came', outcome);
  }
  let json = null;
  try { json = JSON.parse(await res.text()); } catch {}
  return { res, json };
}

// An answer that is no image. A refusal can't have cost anything, a server error may have.
function failure(res, json) {
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  const said = errors.map((e) => e?.message).filter(Boolean).join('; ').slice(0, 300) || `HTTP ${res.status}`;
  if (errors.some((e) => e?.code === QUOTA_CODE)) {
    return new ServiceError(`the Cloudflare account has used up its daily free allocation (${said}). It resets at 00:00 UTC.`, 'refused', { reason: 'quota' });
  }
  if (res.status === 401 || res.status === 403) return new ServiceError(`Cloudflare rejected the account id or the token (${said}). Ask the user to check both.`, 'refused');
  if (res.status >= 500 || res.status === 408) return new ServiceError(`Cloudflare error: ${said}`, 'failed');
  return new ServiceError(`Cloudflare error: ${said}`, 'refused');
}

// The middle of a square image in the ratio "w:h".
async function cut(bytes, aspect) {
  const [w, h] = aspect.split(':').map(Number);
  if (w === h) return bytes;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-flux-'));
  try {
    const input = path.join(dir, 'in.jpg');
    const output = path.join(dir, 'out.jpg');
    fs.writeFileSync(input, bytes);
    const crop = w > h ? `crop=iw:trunc(iw*${h}/${w}/2)*2` : `crop=trunc(ih*${w}/${h}/2)*2:ih`;
    await ffmpeg(['-v', 'error', '-i', input, '-vf', crop, '-q:v', '2', output]);
    return fs.readFileSync(output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function image(dir, { model = MODEL, text, aspect = '1:1' }, { timeout = 120000 } = {}) {
  if (text.length > MAX_PROMPT) throw new ProjectError(`the prompt with its style has ${text.length} characters; Cloudflare takes at most ${MAX_PROMPT}. Write a shorter prompt or style.`);
  const { account, token } = key(dir);
  const url = `${serviceUrl(connector)}/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${model}`;
  const { res, json } = await send(url, token, { method: 'POST', body: JSON.stringify({ prompt: text, steps: STEPS }) }, timeout);
  if (!res.ok || json?.success === false) throw failure(res, json);
  const b64 = json?.result?.image;
  if (typeof b64 !== 'string' || !b64) throw new ServiceError('Cloudflare answered without an image', 'failed');
  const square = Buffer.from(b64, 'base64');
  let size = { width: 1024, height: 1024 };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-flux-')), 'square.jpg');
  try {
    fs.writeFileSync(file, square);
    const stream = (await probe(file)).streams.find((s) => s.codec_type === 'video');
    if (stream) size = { width: stream.width, height: stream.height };
  } catch {
    throw new ServiceError('Cloudflare sent an image that could not be read', 'failed');
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
  return { bytes: await cut(square, aspect), ext: 'jpg', cost_usd: neuronsUsd(size.width, size.height), served_by: model };
}

async function test(dir) {
  const { token } = key(dir);
  const { res } = await send(`${serviceUrl(connector)}/client/v4/user/tokens/verify`, token, { method: 'GET' }, 30000);
  if (res.status === 401 || res.status === 403) throw new ProjectError('Cloudflare rejected the token. Check that you copied all of it.');
  if (!res.ok) throw new ProjectError(`Cloudflare answered with HTTP ${res.status}, so the token could not be tested. Try again in a moment.`);
}

const connector = {
  id: 'cloudflare',
  name: 'Cloudflare',
  baseUrl: 'https://api.cloudflare.com',
  findKey,
  key,
  test,
  image,
  defaultImageModel: MODEL,
  estimateImageUsd: () => neuronsUsd(1024, 1024),
};

export default connector;
