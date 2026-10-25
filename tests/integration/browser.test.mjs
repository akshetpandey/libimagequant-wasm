import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

let server, browser, page;
before(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Package consumer</title>');
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
