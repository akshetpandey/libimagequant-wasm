import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium, firefox, webkit } from 'playwright';
import {
  compositingApng,
  compositedPixels,
  parseIndexedApng,
  makeApng,
  red,
  green,
  blue,
  clear,
  inspectTransfers,
  addMetadata,
  chunk,
  chunksOf,
} from './apng-fixtures.mjs';

const browserTypes = { chromium, firefox, webkit };
const browserName = process.env.TEST_BROWSER ?? 'chromium';
if (!Object.hasOwn(browserTypes, browserName)) {
  throw new Error('TEST_BROWSER must be chromium, firefox, or webkit');
}
const browserType = browserTypes[browserName];

let server, browser, page, consumer;
const bundles = new Map();
before(async () => {
  consumer = await mkdtemp(join(tmpdir(), 'libimagequant-browser-'));
  await mkdir(join(consumer, 'node_modules'));
  await symlink(
    fileURLToPath(new URL('../../', import.meta.url)),
    join(consumer, 'node_modules/libimagequant-wasm'),
  );
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
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
    const file =
      path === '/relocated/worker.mjs'
        ? 'worker.mjs'
        : path.startsWith('/assets/')
          ? `wasm/${path.slice(8)}`
          : path.startsWith('/dist/')
            ? path.slice(6)
            : null;
    try {
      if (!file || file.includes('..')) throw new Error('Unknown asset');
      res.setHeader(
        'Content-Type',
        file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
      );
      res.end(await readFile(new URL(`../../dist/${file}`, import.meta.url)));
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await browserType.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (consumer) await rm(consumer, { recursive: true, force: true });
});

async function quantize(requestOptions) {
  return page.evaluate(async (options) => {
    const { default: Quantizer } = await import('/dist/index.mjs');
    const q = new Quantizer({ initTimeout: 2000, operationTimeout: 5000, ...options });
    try {
      const result = await q.quantizeImageData(
        new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1),
      );
      return { palette: result.palette, width: result.width, height: result.height };
    } finally {
      q.dispose();
    }
  }, requestOptions);
}

test('APNG retains all frames through browser workers and native decoding', async () => {
  const browserResult = await page.evaluate(
    async (bytes) => {
      const { default: Quantizer } = await import('/dist/index.mjs');
      const q = new Quantizer();
      try {
        const result = await q.quantizePng(new Uint8Array(bytes), {
          maxColors: 8,
          dithering: 0,
          includeFrameData: true,
        });
        const nativeFrames = [];
        const Decoder = globalThis.ImageDecoder;
        if (Decoder) {
          const decoder = new Decoder({
            data: result.pngBytes,
            type: 'image/png',
            preferAnimation: true,
          });
          try {
            await decoder.tracks.ready;
            for (let i = 0; i < decoder.tracks.selectedTrack.frameCount; i++) {
              const { image } = await decoder.decode({ frameIndex: i });
              try {
                const pixels = new Uint8Array(result.width * result.height * 4);
                await image.copyTo(pixels, { format: 'RGBA' });
                nativeFrames.push([...pixels]);
              } finally {
                image.close();
              }
            }
          } finally {
            decoder.close();
          }
        }
        return {
          bytes: [...result.pngBytes],
          frames: result.animation.frames.map((f) => [...f.imageData.data]),
          nativeImageData: result.animation.frames.every((f) => f.imageData instanceof ImageData),
          sharedPreview: result.imageData === result.animation.frames[0].imageData,
          plays: result.animation.numPlays,
          nativeFrames,
        };
      } finally {
        q.dispose();
      }
    },
    [...compositingApng()],
  );
  assert.equal(browserResult.nativeImageData, true);
  assert.equal(browserResult.sharedPreview, true);
  assert.equal(browserResult.plays, 3);
  const encoded = parseIndexedApng(browserResult.bytes);
  assert.deepEqual(
    encoded.frames.map((f) => f.pixels),
    browserResult.frames,
  );
  for (const [i, frame] of browserResult.frames.entries()) {
    for (let channel = 0; channel < frame.length; channel++) {
      assert(Math.abs(frame[channel] - compositedPixels[i][channel]) <= 1);
    }
  }
  if (browserName === 'chromium') {
    assert.equal(browserResult.nativeFrames.length, 4);
    assert.deepEqual(browserResult.nativeFrames, browserResult.frames);
  }
});

test('the default constructor works without copying worker or WASM assets', async () => {
  assert.deepEqual(await quantize({}), { palette: [[255, 0, 0, 255]], width: 1, height: 1 });
});

test(
  'browser APNG workers transfer every owned buffer exactly once',
  { timeout: 15000 },
  async () => {
    const input = await readFile(new URL('../fixtures/beach-ball.apng', import.meta.url));
    for (const [bytes, expected, includeFrameData = true] of [
      [input, 21],
      [input, 2, false],
      [makeApng({ poster: [...red, ...red], frames: [{ samples: [...blue, ...green] }] }), 3],
    ]) {
      const report = await page.evaluate(
        async ({ png, hook, includeFrameData: includePixels }) => {
          const source = `self.postMessage = (${hook})(self.postMessage.bind(self));
        await import(${JSON.stringify(new URL('/dist/worker.mjs', location.href).href)});`;
          const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
          const worker = new Worker(url, { type: 'module' });
          try {
            return await new Promise((resolve, reject) => {
              let result;
              worker.onerror = (event) => reject(new Error(event.message));
              worker.onmessage = ({ data }) => {
                if (data.type === 'ready')
                  worker.postMessage({
                    id: 1,
                    action: 'quantize_png',
                    data: {
                      pngBytes: new Uint8Array(png),
                      options: { includeFrameData: includePixels },
                    },
                  });
                else if (data.success === false) reject(new Error(data.error));
                else if (data.result) result = data.result;
                else if (data.type === 'transfer-inspection')
                  resolve({
                    ...data,
                    native: result.animation.frames.every((frame) =>
                      includePixels ? frame.imageData instanceof ImageData : !frame.imageData,
                    ),
                    received:
                      result.pngBytes.byteLength > 0 &&
                      result.animation.frames.every((frame) =>
                        includePixels ? frame.imageData.data.byteLength > 0 : !frame.imageData,
                      ),
                  });
              };
            });
          } finally {
            worker.terminate();
            URL.revokeObjectURL(url);
          }
        },
        { png: [...bytes], hook: inspectTransfers.toString(), includeFrameData },
      );
      assert.deepEqual(report, {
        type: 'transfer-inspection',
        expected,
        supplied: expected,
        detached: true,
        native: true,
        received: true,
      });
    }
  },
);

for (const file of ['beach-ball.apng', 'beach-ball-45.apng']) {
  test(`real ${file} agrees with native source and output decoding`, async () => {
    const input = await readFile(new URL(`../fixtures/${file}`, import.meta.url));
    const expectedDelays = chunksOf(input)
      .filter((c) => c.type === 'fcTL')
      .map((c) => (c.data.readUInt16BE(20) * 1000) / (c.data.readUInt16BE(22) || 100));
    const checked = await page.evaluate(
      async (bytes) => {
        const { default: Quantizer } = await import('/dist/index.mjs');
        const raw = await import('/dist/wasm/libimagequant_wasm.js');
        await raw.default();
        const source = new Uint8Array(bytes);
        const decoded = raw.decode_png_animation(source);
        const q = new Quantizer();
        try {
          const result = await q.quantizePng(source, {
            maxColors: 64,
            dithering: 0,
            includeFrameData: true,
          });
          const counts = [decoded.animation.frames.length, result.animation.frames.length];
          const nativeErrors = [];
          const durations = [];
          if (globalThis.ImageDecoder) {
            for (const [png, expected] of [
              [source, decoded.animation.frames],
              [result.pngBytes, result.animation.frames],
            ]) {
              const decoder = new ImageDecoder({
                data: png,
                type: 'image/png',
                preferAnimation: true,
              });
              let worst = 0;
              try {
                await decoder.completed;
                await decoder.tracks.ready;
                counts.push(decoder.tracks.selectedTrack.frameCount);
                for (let i = 0; i < decoder.tracks.selectedTrack.frameCount; i++) {
                  const { image } = await decoder.decode({ frameIndex: i });
                  try {
                    durations.push(image.duration);
                    const pixels = new Uint8Array(decoded.width * decoded.height * 4);
                    await image.copyTo(pixels, { format: 'RGBA' });
                    const wanted = expected[i].imageData.data;
                    for (let p = 0; p < pixels.length; p++) {
                      const alpha = p - (p % 4) + 3;
                      const a =
                        p % 4 === 3 ? pixels[p] : Math.round((pixels[p] * pixels[alpha]) / 255);
                      const b =
                        p % 4 === 3 ? wanted[p] : Math.round((wanted[p] * wanted[alpha]) / 255);
                      worst = Math.max(worst, Math.abs(a - b));
                    }
                  } finally {
                    image.close();
                  }
                }
              } finally {
                decoder.close();
              }
              nativeErrors.push(worst);
            }
          }
          return {
            counts,
            nativeErrors,
            durations,
            nativeImages: result.animation.frames.every((f) => f.imageData instanceof ImageData),
            plays: result.animation.numPlays,
            delays: result.animation.frames.map((f) => f.durationMs),
          };
        } finally {
          q.dispose();
        }
      },
      [...input],
    );
    assert.equal(checked.nativeImages, true);
    assert.equal(checked.plays, 0);
    assert.deepEqual(checked.delays, expectedDelays);
    assert(checked.counts.every((n) => n === 20));
    if (browserName === 'chromium') {
      assert.deepEqual(checked.nativeErrors, [0, 0]);
      assert.deepEqual(
        checked.durations,
        [...expectedDelays, ...expectedDelays].map((n) => n * 1000),
      );
    }
  });
}

test('browser APNG results retain a separate native fallback and independent frames', async () => {
  const images = await page.evaluate(
    async (bytes) => {
      const { default: Quantizer } = await import('/dist/index.mjs');
      const q = new Quantizer();
      try {
        const result = await q.quantizePng(new Uint8Array(bytes), {
          maxColors: 8,
          dithering: 0,
          includeFrameData: true,
        });
        const frames = result.animation.frames.map((frame) => frame.imageData);
        return {
          native: [result.imageData, ...frames].every((image) => image instanceof ImageData),
          separate: !result.animation.defaultImageIsFrame && result.imageData !== frames[0],
          distinctBuffers: new Set([result.imageData, ...frames].map((image) => image.data.buffer))
            .size,
          preview: [...result.imageData.data],
          frames: frames.map((image) => [...image.data]),
        };
      } finally {
        q.dispose();
      }
    },
    [
      ...makeApng({
        poster: [...green, ...green],
        frames: [
          { width: 1, x: 1, samples: blue, dispose: 2 },
          { width: 1, x: 0, samples: red },
        ],
      }),
    ],
  );
  assert.equal(images.native, true);
  assert.equal(images.separate, true);
  assert.equal(images.distinctBuffers, 3);
  assert.deepEqual(images.preview, [...green, ...green]);
  for (const [i, expected] of [
    [...clear, ...blue],
    [...red, ...clear],
  ].entries()) {
    for (let channel = 0; channel < expected.length; channel++) {
      if (channel % 4 !== 3 && expected[channel - (channel % 4) + 3] === 0) continue;
      assert(Math.abs(images.frames[i][channel] - expected[channel]) <= 1);
    }
  }
});

test('browser transfers preserve caller buffers and accept iframe byte views', async () => {
  assert.deepEqual(
    await page.evaluate(async () => {
      const { default: Quantizer } = await import('/dist/index.mjs');
      const frame = document.createElement('iframe');
      document.body.append(frame);
      const data = new frame.contentWindow.Uint8ClampedArray([255, 0, 0, 255]);
      const q = new Quantizer();
      try {
        const options = { maxColors: 4 };
        const pending = q.quantizeImageData({ data, width: 1, height: 1 }, options);
        options.maxColors = 0;
        data.fill(0);
        const result = await pending;
        return {
          palette: result.palette,
          inputLength: data.byteLength,
          native: result.imageData instanceof ImageData,
        };
      } finally {
        q.dispose();
        frame.remove();
      }
    }),
    { palette: [[255, 0, 0, 255]], inputLength: 4, native: true },
  );
});

test('the embedded worker accepts a custom WASM directory', async () => {
  assert.equal((await quantize({ wasmUrl: '/assets/' })).width, 1);
});

for (const format of ['esm', 'cjs']) {
  test(`a production ${format} consumer can use the default constructor`, async () => {
    const entry = join(consumer, format === 'esm' ? 'app.mjs' : 'app.cjs');
    const declaration =
      format === 'esm'
        ? "import Quantizer from 'libimagequant-wasm';"
        : "const Quantizer = require('libimagequant-wasm');";
    const body = `async function run() {
      const q = new Quantizer();
      try { return (await q.quantizeImageData(new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1))).palette; }
      finally { q.dispose(); }
    }`;
    await writeFile(
      entry,
      `${declaration}\n${body}\n${format === 'esm' ? 'export { run };' : 'exports.run = run;'}`,
    );
    const built = await build({
      configFile: false,
      root: consumer,
      logLevel: 'silent',
      build: { write: false, lib: { entry, formats: ['es'] } },
    });
    const output = Array.isArray(built) ? built[0].output : built.output;
    bundles.set(`/consumer-${format}.mjs`, output.find((item) => item.type === 'chunk').code);
    assert.deepEqual(
      await page.evaluate(async (outputFormat) => {
        const module = await import(`/consumer-${outputFormat}.mjs`);
        return await (module.run ?? module.default.run)();
      }, format),
      [[255, 0, 0, 255]],
    );
  });
}

test('loads a custom WASM directory independently of the worker location', async () => {
  for (const directory of [
    '/assets/',
    '/assets',
    '/assets?v=1',
    '/assets?v=example.wasm',
    new URL('/assets/', page.url()).href,
  ]) {
    assert.deepEqual(await quantize({ workerUrl: '/relocated/worker.mjs', wasmUrl: directory }), {
      palette: [[255, 0, 0, 255]],
      width: 1,
      height: 1,
    });
  }
});

test('relative worker and WASM paths respect the document base URL', async () => {
  await page.evaluate(() => {
    const base = document.createElement('base');
    base.href = '/dist/';
    document.head.append(base);
  });
  try {
    for (const workerUrl of [undefined, 'worker.mjs']) {
      assert.equal((await quantize({ workerUrl, wasmUrl: 'wasm' })).width, 1);
    }
  } finally {
    await page.evaluate(() => document.querySelector('base').remove());
  }
});

test('preserves binary-only WASM URL overrides', async () => {
  for (const workerUrl of [undefined, '/dist/worker.mjs', '/relocated/worker.mjs']) {
    assert.equal(
      (await quantize({ workerUrl, wasmUrl: '/assets/libimagequant_wasm_bg.wasm' })).width,
      1,
    );
  }
});

test('the CommonJS worker entry delegates to a working module worker', async () => {
  assert.deepEqual(await quantize({ workerUrl: '/dist/worker.cjs' }), {
    palette: [[255, 0, 0, 255]],
    width: 1,
    height: 1,
  });
});

test('the exported browser worker survives malformed requests', async () => {
  assert.deepEqual(
    await page.evaluate(async () => {
      const worker = new Worker('/dist/worker.mjs', { type: 'module' });
      const next = () =>
        new Promise((resolve, reject) => {
          worker.onmessage = (event) => resolve(event.data);
          worker.onerror = (event) => reject(new Error(event.message));
        });
      try {
        await next();
        const errors = [];
        for (const message of [
          null,
          undefined,
          {},
          { id: 7, action: 'quantize_imagedata', data: null },
        ]) {
          const pending = next();
          worker.postMessage(message);
          errors.push((await pending).error);
        }
        const pending = next();
        worker.postMessage({
          id: 1,
          action: 'quantize_imagedata',
          data: { imageData: [255, 0, 0, 255], width: 1, height: 1 },
        });
        return { errors, palette: (await pending).result.palette };
      } finally {
        worker.terminate();
      }
    }),
    { errors: Array(4).fill('Invalid quantization request'), palette: [[255, 0, 0, 255]] },
  );
});

test('browser PNG and APNG workers apply metadata policy with compact frame results', async () => {
  const real = await readFile(new URL('../fixtures/beach-ball-45.apng', import.meta.url));
  const density = Buffer.from([0, 0, 11, 19, 0, 0, 11, 19, 1]);
  const input = addMetadata(
    real,
    [chunk('pHYs', density)],
    [chunk('tEXt', Buffer.from('Author\0Example'))],
  );
  const outputs = await page.evaluate(
    async (bytes) => {
      const { default: Quantizer } = await import('/dist/index.mjs');
      const q = new Quantizer();
      try {
        const results = [];
        for (const metadata of ['safe', 'all', 'none']) {
          const result = await q.quantizePng(new Uint8Array(bytes), { metadata });
          results.push({
            png: [...result.pngBytes],
            omitted: result.animation.frames.every((f) => !f.imageData),
            preview: result.imageData instanceof ImageData,
          });
        }
        return results;
      } finally {
        q.dispose();
      }
    },
    [...input],
  );
  for (const [i, output] of outputs.entries()) {
    assert(output.omitted && output.preview);
    const types = chunksOf(output.png).map((c) => c.type);
    assert.equal(types.includes('pHYs'), i !== 2);
    assert.equal(types.includes('tEXt'), i === 1);
  }
});
