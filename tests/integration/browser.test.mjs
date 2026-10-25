import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

let server, browser, page, consumer;
const bundles = new Map();
before(async () => {
  consumer = await mkdtemp(join(tmpdir(), 'libimagequant-browser-'));
  await mkdir(join(consumer, 'node_modules'));
  await symlink(fileURLToPath(new URL('../../', import.meta.url)), join(consumer, 'node_modules/libimagequant-wasm'));
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Package consumer</title>');
      return;
    }
    if (bundles.has(path)) {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundles.get(path));
      return;
    }
    const file = path === '/relocated/worker.mjs' ? 'worker.mjs'
      : path.startsWith('/assets/') ? `wasm/${path.slice(8)}`
      : path.startsWith('/dist/') ? path.slice(6) : null;
    try {
      if (!file || file.includes('..')) throw new Error('Unknown asset');
      res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
      res.end(await readFile(new URL(`../../dist/${file}`, import.meta.url)));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (consumer) await rm(consumer, { recursive: true, force: true });
});

async function quantize(options) {
  return page.evaluate(async options => {
    const { default: Quantizer } = await import('/dist/index.mjs');
    const q = new Quantizer({ initTimeout: 2000, operationTimeout: 5000, ...options });
    try {
      const result = await q.quantizeImageData(new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1));
      return { palette: result.palette, width: result.width, height: result.height };
    } finally { q.dispose(); }
  }, options);
}

test('the default constructor works without copying worker or WASM assets', async () => {
  assert.deepEqual(await quantize({}), { palette: [[255, 0, 0, 255]], width: 1, height: 1 });
});

test('the embedded worker accepts a custom WASM directory', async () => {
  assert.equal((await quantize({ wasmUrl: '/assets/' })).width, 1);
});

for (const format of ['esm', 'cjs']) {
  test(`a production ${format} consumer can use the default constructor`, async () => {
    const entry = join(consumer, format === 'esm' ? 'app.mjs' : 'app.cjs');
    const declaration = format === 'esm' ? "import Quantizer from 'libimagequant-wasm';"
      : "const Quantizer = require('libimagequant-wasm');";
    const body = `async function run() {
      const q = new Quantizer();
      try { return (await q.quantizeImageData(new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1))).palette; }
      finally { q.dispose(); }
    }`;
    await writeFile(entry, `${declaration}\n${body}\n${format === 'esm' ? 'export { run };' : 'exports.run = run;'}`);
    const built = await build({ configFile: false, root: consumer, logLevel: 'silent',
      build: { write: false, lib: { entry, formats: ['es'] } } });
    const output = Array.isArray(built) ? built[0].output : built.output;
    bundles.set(`/consumer-${format}.mjs`, output.find(item => item.type === 'chunk').code);
    assert.deepEqual(await page.evaluate(async format => {
      const module = await import(`/consumer-${format}.mjs`);
      return await (module.run ?? module.default.run)();
    }, format), [[255, 0, 0, 255]]);
  });
}

test('loads a custom WASM directory independently of the worker location', async () => {
  for (const directory of ['/assets/', '/assets', new URL('/assets/', page.url()).href]) {
    assert.deepEqual(await quantize({ workerUrl: '/relocated/worker.mjs', wasmUrl: directory }), {
      palette: [[255, 0, 0, 255]], width: 1, height: 1,
    });
  }
});

test('preserves binary-only WASM URL overrides', async () => {
  assert.equal((await quantize({ workerUrl: '/dist/worker.mjs', wasmUrl: '/assets/libimagequant_wasm_bg.wasm' })).width, 1);
});

test('the CommonJS worker entry delegates to a working module worker', async () => {
  assert.deepEqual(await quantize({ workerUrl: '/dist/worker.cjs' }), {
    palette: [[255, 0, 0, 255]], width: 1, height: 1,
  });
});
