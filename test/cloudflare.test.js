// Cloudflare Workers AI as an image service, through the real command line
// against the fake server, with a counter on every paid request.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLOUDFLARE_ACCOUNT, GOOD_KEY, startFakeServices } from './helpers/fake-services.js';
import { probe } from '../src/ffmpeg.js';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
const PAID = 'POST /client/v4/accounts/*/ai/run/@cf/black-forest-labs/flux-1-schnell';
const PROMPT = 'A rack server in a data center';
const QUOTA = { status: 429, body: { success: false, errors: [{ code: 3036, message: 'Account limited: You have used up your daily free allocation of 10,000 neurons.' }], messages: [], result: null } };

async function setup(t, settings = { images: { provider: 'cloudflare' } }) {
  const fake = await startFakeServices();
  t.after(fake.close);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-cloudflare-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n## first\nHello.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { first() {} };');
  const env = { ...process.env, ...fake.env, CLOUDFLARE_ACCOUNT_ID: CLOUDFLARE_ACCOUNT, CLOUDFLARE_API_TOKEN: GOOD_KEY, OPENROUTER_API_KEY: '' };
  const cli = (args, extra = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr, text: stderr + stdout }));
  });
  const image = (name, ...flags) => ['image', dir, name, PROMPT, ...flags, '--json'];
  return { fake, dir, cli, image, purchases: () => fake.count('cloudflare', PAID) };
}

test('cloudflare saves assets/<name>.jpg in 1:1 and records the price at the paid rate', async (t) => {
  const { dir, cli, image, purchases, fake } = await setup(t);
  const r = await cli(image('server', '--aspect', '1:1'));
  assert.equal(r.code, 0, r.text);
  const out = JSON.parse(r.stdout);
  assert.equal(out.provider, 'cloudflare');
  assert.equal(out.model, '@cf/black-forest-labs/flux-1-schnell');
  assert.equal(path.relative(dir, out.file), 'assets/server.jpg');
  assert.equal(out.cost_usd, 0.000634);
  assert.equal(purchases(), 1);
  const body = fake.requests('cloudflare', PAID)[0].body;
  assert.equal(body.steps, 4);
  assert.match(body.prompt, /^A rack server in a data center\n\nStyle: /);
  const { width, height } = await probe(out.file).then((p) => p.streams.find((s) => s.codec_type === 'video'));
  assert.deepEqual([width, height], [1024, 1024]);
});

test('cloudflare crops the square to the aspect: 16:9 is 1024x576, 9:16 is 576x1024', async (t) => {
  const { cli, image } = await setup(t);
  for (const [aspect, size] of [['16:9', [1024, 576]], ['9:16', [576, 1024]]]) {
    const r = await cli(image(`server-${aspect.replace(':', '-')}`, '--aspect', aspect));
    assert.equal(r.code, 0, r.text);
    const { width, height } = await probe(JSON.parse(r.stdout).file).then((p) => p.streams.find((s) => s.codec_type === 'video'));
    assert.deepEqual([width, height], size);
  }
});

test('the same cloudflare request twice buys once', async (t) => {
  const { cli, image, purchases } = await setup(t);
  await cli(image('server'));
  const again = JSON.parse((await cli(image('server'))).stdout);
  assert.equal(again.reused, true);
  assert.equal(purchases(), 1);
});

test('a used-up daily allocation is refused with reason quota, and the same request buys again later without --new', async (t) => {
  const { cli, image, purchases, fake } = await setup(t);
  fake.plan('cloudflare', PAID, QUOTA);
  const r = await cli(image('server'));
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.outcome, 'refused');
  assert.equal(out.reason, 'quota');
  assert.match(out.error, /daily free allocation/);
  const later = await cli(image('server'));
  assert.equal(later.code, 0, later.text);
  assert.equal(purchases(), 2);
});

test('a wrong token is refused without a reason', async (t) => {
  const { cli, image } = await setup(t);
  const r = await cli(image('server'), { CLOUDFLARE_API_TOKEN: 'wrong' });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.outcome, 'refused');
  assert.equal(out.reason, undefined);
});

test('a server error is failed, and the same request then stops until --new', async (t) => {
  const { cli, image, purchases, fake } = await setup(t);
  fake.plan('cloudflare', PAID, { status: 500, body: { success: false, errors: [{ code: 3007, message: 'Timeout' }] } });
  const r = await cli(image('server'));
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).outcome, 'failed');
  const again = await cli(image('server'));
  assert.equal(again.code, 1);
  assert.match(JSON.parse(again.stdout).error, /--new/);
  assert.equal(purchases(), 1);
});

test('without the account id or the token, the error names both and nothing is sent', async (t) => {
  const { cli, image, purchases } = await setup(t);
  for (const extra of [{ CLOUDFLARE_ACCOUNT_ID: '' }, { CLOUDFLARE_API_TOKEN: '' }]) {
    const r = await cli(image('server'), extra);
    assert.equal(r.code, 1);
    const { error } = JSON.parse(r.stdout);
    assert.match(error, /CLOUDFLARE_ACCOUNT_ID/);
    assert.match(error, /CLOUDFLARE_API_TOKEN/);
  }
  assert.equal(purchases(), 0);
});

test('a prompt with its style over 2048 characters is refused before anything is sent', async (t) => {
  const { cli, dir, purchases } = await setup(t);
  const r = await cli(['image', dir, 'server', 'x'.repeat(2100), '--json']);
  assert.equal(r.code, 1);
  assert.match(JSON.parse(r.stdout).error, /2048/);
  assert.equal(purchases(), 0);
});

test('services lists cloudflare under images', async (t) => {
  const { cli } = await setup(t);
  const r = await cli(['services', 'images', '--json']);
  assert.equal(r.code, 0, r.text);
  assert.ok(JSON.stringify(JSON.parse(r.stdout)).includes('"cloudflare"'));
});

test('a wide or tall image asks for the subject in the middle with room to cut; a square one does not', async (t) => {
  const { cli, image, fake } = await setup(t);
  await cli(image('wide', '--aspect', '16:9'));
  await cli(image('tall', '--aspect', '9:16'));
  await cli(image('square', '--aspect', '1:1'));
  const [wide, tall, square] = fake.requests('cloudflare', PAID).map((r) => r.body.prompt);
  assert.match(wide, /whole subject .*middle band.*empty background above and below/i);
  assert.match(tall, /whole subject .*middle.*empty background (on the )?left and right/i);
  assert.doesNotMatch(square, /middle band|left and right/i);
});
