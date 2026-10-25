import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Quantizer from 'libimagequant-wasm/node';
import png16 from '../fixtures/png-16bit.json' with { type: 'json' };

const cjs = createRequire(import.meta.url)('libimagequant-wasm/node');
const png = Buffer.from(png16[0].base64, 'base64');
const image = () => ({ data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 });

test('invalid timeout settings fail before creating a worker', () => {
  for (const Q of [Quantizer, cjs]) {
    for (const name of ['initTimeout', 'operationTimeout']) {
      for (const value of [0, -1, 1.5, NaN, Infinity, 2147483648, '100']) {
        assert.throws(() => new Q({ [name]: value }), new RegExp(`${name} must be an integer`));
      }
    }
  }
});

for (const [format, Q] of [['ESM', Quantizer], ['CommonJS', cjs]]) {
  test(`${format} Node API quantizes Buffers and returns DOM-free RGBA`, async () => {
    const q = new Q();
    try {
      const result = await q.quantizePng(png);
      assert.deepEqual([result.width, result.height], [1, 1]);
      assert.deepEqual(result.palette, [[255, 0, 0, 255]]);
      assert.deepEqual([...result.imageData.data], [255, 0, 0, 255]);
      assert.deepEqual([...result.pngBytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(Object.getPrototypeOf(result.imageData), Object.prototype);
      assert.equal(typeof globalThis.Worker, 'undefined');
      assert.equal(typeof globalThis.ImageData, 'undefined');
    } finally { q.dispose(); }
  });
}

test('Node accepts Uint8Array, ArrayBuffer, Blob, and raw RGBA inputs', async () => {
  const q = new Quantizer();
  try {
    const bytes = new Uint8Array(png);
    for (const input of [bytes, bytes.buffer, new Blob([bytes])]) {
      assert.equal((await q.quantizePng(input)).width, 1);
    }
    assert.deepEqual((await q.quantizeImageData(image())).palette, [[255, 0, 0, 255]]);
    for (const width of [0, -1, 1.5, 4294967297]) {
      await assert.rejects(q.quantizeImageData({ ...image(), width }), /dimensions/);
    }
  } finally { q.dispose(); }
});

test('Node shares cold initialization and keeps concurrent results independent', async () => {
  const q = new Quantizer();
  try {
    const results = await Promise.all(Array.from({ length: 5 }, () => q.quantizePng(png)));
    for (const result of results) assert.deepEqual(result.palette, [[255, 0, 0, 255]]);
    results[0].pngBytes[0] = 0;
    assert.equal(results[1].pngBytes[0], 137);
  } finally { q.dispose(); }
});

test('Node preserves errors and permits valid requests after rejected input', async () => {
  const q = new Quantizer();
  try {
    await assert.rejects(q.quantizePng(new Uint8Array([1, 2, 3])), /Failed to read PNG/);
    await assert.rejects(q.quantizePng(png, { maxColors: 4294967300 }), /maxColors/);
    assert.equal((await q.quantizePng(png)).width, 1);
  } finally { q.dispose(); }
});

test('Node disposal rejects initialization and subsequent calls', async () => {
  const q = new Quantizer({ initTimeout: 5000 });
  const operation = q.quantizePng(png);
  q.dispose();
  q.dispose();
  await assert.rejects(operation, /disposed/);
  await assert.rejects(q.quantizePng(png), /disposed/);
});

test('Blob preparation is covered by disposal', async () => {
  class SlowBlob extends Blob { arrayBuffer() { return new Promise(() => {}); } }
  const q = new Quantizer();
  const operation = q.quantizePng(new SlowBlob([png]));
  q.dispose();
  await assert.rejects(operation, /disposed/);
});

test('byte views preserve offsets and input ownership across worker transfers', async () => {
  const q = new Quantizer();
  try {
    const storage = Buffer.concat([Buffer.alloc(7), png, Buffer.alloc(9)]);
    const input = storage.subarray(7, 7 + png.length);
    const pending = q.quantizePng(input);
    input.fill(0);
    assert.equal((await pending).width, 1);
    assert.equal(storage.byteLength, png.length + 16);
    const pixels = Buffer.from([255, 0, 0, 255]);
    const result = await q.quantizeImageData({ data: pixels, width: 1, height: 1 });
    assert.deepEqual([...pixels], [255, 0, 0, 255]);
    assert.deepEqual([...result.imageData.data], [...pixels]);
    await assert.rejects(q.quantizePng(new Uint16Array([1, 2])), /PNG input/);
    await assert.rejects(q.quantizeImageData({ ...image(), data: [255, 0, 0, 255] }), /RGBA data/);
  } finally { q.dispose(); }
});

test('Node works from eval input and exits after disposal', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import Quantizer from 'libimagequant-wasm/node';
    const q = new Quantizer();
    try { console.log((await q.quantizeImageData({ data: new Uint8ClampedArray([255,0,0,255]), width:1, height:1 })).width); }
    finally { q.dispose(); }
  `], { cwd: fileURLToPath(new URL('../../', import.meta.url)), timeout: 5000 });
  assert.equal(stdout.trim(), '1');
});

test('Node rejects startup failures and unexpected worker exits promptly', async () => {
  for (const source of [
    "throw new Error('startup exploded')",
    "import { parentPort } from 'node:worker_threads'; parentPort.postMessage({ type:'ready' }); parentPort.once('message', () => process.exit(0));",
  ]) {
    const q = new Quantizer({ workerUrl: new URL(`data:text/javascript,${encodeURIComponent(source)}`), operationTimeout: 5000 });
    try {
      await assert.rejects(q.quantizeImageData(image()), /Worker error: (startup exploded|Quantization worker exited \(0\))/);
      await assert.rejects(q.quantizeImageData(image()), /Worker error:/);
    } finally { q.dispose(); }
  }
});
