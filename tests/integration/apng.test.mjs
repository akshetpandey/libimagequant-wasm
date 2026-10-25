import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import Quantizer from 'libimagequant-wasm/node';
import * as wasm from '../../dist/wasm/libimagequant_wasm.js';
import {
  chunk,
  chunksOf,
  makeApng,
  parseIndexedApng,
  compositingApng,
  compositedPixels,
  red,
  green,
  blue,
  clear,
} from './apng-fixtures.mjs';

wasm.initSync({
  module: await readFile(new URL('../../dist/wasm/libimagequant_wasm_bg.wasm', import.meta.url)),
});
const common = createRequire(import.meta.url)('libimagequant-wasm/node');

function near(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    if (i % 4 !== 3 && expected[i - (i % 4) + 3] === 0) continue;
    assert(Math.abs(actual[i] - expected[i]) <= 1, `channel ${i}: ${actual[i]} != ${expected[i]}`);
  }
}

function check(result, expected) {
  const encoded = parseIndexedApng(result.pngBytes);
  assert.equal(encoded.frames.length, expected.length);
  assert.equal(result.animation.frames.length, expected.length);
  assert.deepEqual(encoded.palette, result.palette);
  assert.equal(encoded.numPlays, result.animation.numPlays);
  for (const [i, frame] of encoded.frames.entries()) {
    assert.deepEqual(
      [frame.width, frame.height, frame.x, frame.y, frame.blend, frame.dispose],
      [result.width, result.height, 0, 0, 0, 0],
    );
    const metadata = result.animation.frames[i];
    assert.deepEqual(frame.delay, [metadata.delayNumerator, metadata.delayDenominator]);
    assert.equal(
      metadata.durationMs,
      (metadata.delayNumerator * 1000) / (metadata.delayDenominator || 100),
    );
    assert.deepEqual(frame.pixels, [...metadata.imageData.data]);
    near(frame.pixels, expected[i]);
  }
  assert.deepEqual(encoded.poster, [...result.imageData.data]);
  return encoded;
}

test('raw APNG decoding exposes original composited frames without quantization', () => {
  const decoded = wasm.decode_png_animation(compositingApng());
  assert.deepEqual(
    decoded.animation.frames.map((f) => [...f.imageData.data]),
    compositedPixels,
  );
  assert.equal(decoded.imageData, decoded.animation.frames[0].imageData);
  const png = wasm.encode_palette_to_png(new Uint8Array([0]), [red], 1, 1);
  assert.equal(wasm.decode_png_animation(png), undefined);
});

for (const [format, Q] of [
  ['ESM', Quantizer],
  ['CommonJS', common],
]) {
  test(`${format} converts the real 20-frame beach-ball APNG without losing frames or colors`, async (t) => {
    const q = new Q();
    t.after(() => q.dispose());
    const input = await readFile(new URL('../fixtures/beach-ball.apng', import.meta.url));
    const original = wasm.decode_png_animation(input);
    const result = await q.quantizePng(input, { maxColors: 64, dithering: 0 });
    const encoded = parseIndexedApng(result.pngBytes);
    assert.deepEqual([result.width, result.height, encoded.frames.length], [100, 100, 20]);
    assert.equal(result.animation.numPlays, 0);
    assert.equal(result.animation.defaultImageIsFrame, true);
    assert.equal(result.imageData, result.animation.frames[0].imageData);
    assert(result.paletteLength <= 64);
    assert.deepEqual(encoded.palette, result.palette);
    assert.equal(new Set(result.animation.frames.map((f) => f.imageData.data.buffer)).size, 20);
    for (const [i, frame] of encoded.frames.entries()) {
      assert.deepEqual(frame.delay, [75, 1000]);
      const output = result.animation.frames[i];
      assert.equal(output.durationMs, 75);
      assert.deepEqual(frame.pixels, [...output.imageData.data]);
      const source = original.animation.frames[i].imageData.data;
      let error = 0;
      for (let p = 0; p < source.length; p++) {
        const alpha = p - (p % 4) + 3;
        const difference =
          p % 4 === 3
            ? source[p] - frame.pixels[p]
            : (source[p] * source[alpha] - frame.pixels[p] * frame.pixels[alpha]) / 255;
        error += difference * difference;
      }
      assert(error / source.length < 25, `frame ${i} lost visible colors`);
    }
  });

  test(`${format} preserves APNG compositing, timing, plays, and a shared palette`, async (t) => {
    const q = new Q();
    t.after(() => q.dispose());
    const input = compositingApng();
    const pending = q.quantizePng(input, { maxColors: 8, dithering: 0, speed: 1 });
    input.fill(0); // The client must snapshot the entire APNG before startup.
    const result = await pending;
    assert.equal(result.animation.numPlays, 3);
    assert.equal(result.animation.defaultImageIsFrame, true);
    assert.equal(result.imageData, result.animation.frames[0].imageData);
    assert.deepEqual(
      result.animation.frames.map((f) => [f.delayNumerator, f.delayDenominator]),
      [
        [2, 0],
        [1, 5],
        [3, 100],
        [0, 1000],
      ],
    );
    assert(result.paletteLength <= 8);
    assert(result.quality >= 0 && result.quality <= 1);
    check(result, compositedPixels);
  });
}

test('preserves a separate fallback image and starts the animation on a clear canvas', async (t) => {
  const q = new Quantizer();
  t.after(() => q.dispose());
  const result = await q.quantizePng(
    makeApng({
      poster: [...green, ...green],
      frames: [
        { width: 1, x: 1, samples: blue, dispose: 2 },
        { width: 1, x: 0, samples: red, blend: 1 },
      ],
    }),
    { maxColors: 8, dithering: 0 },
  );
  assert.equal(result.animation.defaultImageIsFrame, false);
  assert.equal(result.animation.numPlays, 0);
  near(result.imageData.data, [...green, ...green]);
  check(result, [
    [...clear, ...blue],
    [...red, ...clear],
  ]);
});

test('source blending clears transparent pixels and background disposal clears only its rectangle', async (t) => {
  const q = new Quantizer();
  t.after(() => q.dispose());
  const result = await q.quantizePng(
    makeApng({
      frames: [
        { samples: [...red, ...blue] },
        { width: 1, x: 0, samples: green, dispose: 1 },
        { width: 1, x: 0, samples: red },
        { width: 1, x: 1, samples: clear },
        { width: 1, x: 0, samples: clear, blend: 1 },
      ],
    }),
    { maxColors: 8, dithering: 0 },
  );
  check(result, [
    [...red, ...blue],
    [...green, ...blue],
    [...red, ...blue],
    [...red, ...clear],
    [...red, ...clear],
  ]);
});

test('normalizes interlaced offset subframes using the canvas stride', async (t) => {
  const q = new Quantizer();
  t.after(() => q.dispose());
  const result = await q.quantizePng(
    makeApng({
      width: 3,
      height: 2,
      interlaced: true,
      frames: [
        { samples: Array(6).fill(red).flat() },
        { width: 2, height: 2, x: 1, samples: [...blue, ...green, ...green, ...blue] },
      ],
    }),
    { maxColors: 8, dithering: 0 },
  );
  check(result, [
    Array(6).fill(red).flat(),
    [...red, ...blue, ...green, ...red, ...green, ...blue],
  ]);
});

test('previous disposal restores an offset rectangle across multiple rows', async (t) => {
  const q = new Quantizer();
  t.after(() => q.dispose());
  const result = await q.quantizePng(
    makeApng({
      width: 3,
      height: 3,
      frames: [
        { samples: Array(9).fill(red).flat() },
        { width: 2, height: 2, x: 1, y: 1, samples: Array(4).fill(blue).flat(), dispose: 2 },
        { width: 1, height: 1, x: 2, y: 2, samples: clear, blend: 1 },
      ],
    }),
    { dithering: 0 },
  );
  check(result, [
    Array(9).fill(red).flat(),
    [...red, ...red, ...red, ...red, ...blue, ...blue, ...red, ...blue, ...blue],
    Array(9).fill(red).flat(),
  ]);
});

test('one-pixel previous disposal does not allocate another full WASM canvas', async () => {
  const binary = await readFile(
    new URL('../../dist/wasm/libimagequant_wasm_bg.wasm', import.meta.url),
  );
  const samples = Array(1024 * 1024)
    .fill(red)
    .flat();
  const peaks = [];
  for (const dispose of [0, 2]) {
    // Separate glue instances give each run a fresh allocator and memory high-water mark.
    const url = new URL('../../dist/wasm/libimagequant_wasm.js', import.meta.url);
    url.searchParams.set('disposal-memory', dispose);
    const raw = await import(url.href);
    const { memory } = raw.initSync({ module: binary });
    const result = raw.decode_png_animation(
      makeApng({
        width: 1024,
        height: 1024,
        frames: [
          { samples },
          { width: 1, height: 1, x: 512, y: 512, samples: blue },
          { width: 1, height: 1, x: 513, y: 513, samples: green, dispose },
        ],
      }),
    );
    assert.equal(result.animation.frames.length, 3);
    assert.deepEqual(
      [
        ...result.animation.frames[2].imageData.data.subarray(
          (513 * 1024 + 513) * 4,
          (513 * 1024 + 513) * 4 + 4,
        ),
      ],
      green,
    );
    peaks.push(memory.buffer.byteLength);
  }
  assert(peaks[1] <= peaks[0] + 65536, `PREVIOUS added ${peaks[1] - peaks[0]} bytes for one pixel`);
});

test('packed RGBA APNG decoding avoids a duplicate normalized frame allocation', async () => {
  const url = new URL('../../dist/wasm/libimagequant_wasm.js', import.meta.url);
  url.searchParams.set('rgba-memory', 'fresh');
  const raw = await import(url.href);
  const { memory } = raw.initSync({
    module: await readFile(new URL('../../dist/wasm/libimagequant_wasm_bg.wasm', import.meta.url)),
  });
  const retained = raw.decode_png_animation(makeApng({ width: 1, frames: [{ samples: blue }] }));
  const firstBuffer = retained.imageData.data.buffer;
  const result = raw.decode_png_animation(
    makeApng({
      width: 1024,
      height: 1024,
      frames: [
        {
          samples: Array(1024 * 1024)
            .fill(red)
            .flat(),
        },
      ],
    }),
  );
  assert.equal(result.animation.frames.length, 1);
  assert.deepEqual([...result.imageData.data.subarray(-4)], red);
  assert.notEqual(firstBuffer, memory.buffer);
  assert.deepEqual(
    [...retained.imageData.data],
    blue,
    'WASM memory growth changed an earlier result',
  );
  // One decoder buffer, one composition canvas, one saved result, plus allocator overhead.
  assert(memory.buffer.byteLength <= 14 * 1024 * 1024, `${memory.buffer.byteLength} bytes used`);
});

test('a final previous-disposal frame does not allocate an unused restoration canvas', async () => {
  const url = new URL('../../dist/wasm/libimagequant_wasm.js', import.meta.url);
  url.searchParams.set('final-disposal-memory', 'fresh');
  const raw = await import(url.href);
  const { memory } = raw.initSync({
    module: await readFile(new URL('../../dist/wasm/libimagequant_wasm_bg.wasm', import.meta.url)),
  });
  const result = raw.decode_png_animation(
    makeApng({
      width: 1024,
      height: 1024,
      frames: [
        {
          samples: Array(1024 * 1024)
            .fill(red)
            .flat(),
          dispose: 2,
        },
      ],
    }),
  );
  assert.deepEqual([...result.imageData.data.subarray(-4)], red);
  assert(memory.buffer.byteLength <= 14 * 1024 * 1024, `${memory.buffer.byteLength} bytes used`);
});

for (const fixture of [
  {
    name: 'one-bit indexed alpha',
    colorType: 3,
    bitDepth: 1,
    palette: [red, clear],
    samples: [[0], [1]],
    expected: [red, clear],
  },
  {
    name: 'two-bit grayscale',
    colorType: 0,
    bitDepth: 2,
    samples: [[0], [3]],
    expected: [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ],
  },
  {
    name: '16-bit RGB',
    colorType: 2,
    bitDepth: 16,
    samples: [
      [65535, 0, 0],
      [0, 65535, 0],
    ],
    expected: [red, green],
  },
  {
    name: '16-bit RGBA',
    colorType: 6,
    bitDepth: 16,
    samples: [
      [65535, 0, 0, 65535],
      [0, 0, 65535, 32768],
    ],
    expected: [red, [0, 0, 255, 128]],
  },
  {
    name: '16-bit grayscale alpha',
    colorType: 4,
    bitDepth: 16,
    samples: [
      [65535, 65535],
      [32768, 32768],
    ],
    expected: [
      [255, 255, 255, 255],
      [128, 128, 128, 128],
    ],
  },
]) {
  test(`normalizes animated ${fixture.name} images`, async (t) => {
    const q = new Quantizer();
    t.after(() => q.dispose());
    const result = await q.quantizePng(
      makeApng({ ...fixture, width: 1, frames: fixture.samples.map((samples) => ({ samples })) }),
      { maxColors: 8, dithering: 0 },
    );
    check(result, fixture.expected);
  });
}

test('retains one-frame APNG and leaves static PNG results unanimated', async (t) => {
  const q = new Quantizer();
  t.after(() => q.dispose());
  const result = await q.quantizePng(
    makeApng({ width: 1, frames: [{ samples: red, delay: [65535, 1] }] }),
  );
  check(result, [red]);
  const png = wasm.encode_palette_to_png(new Uint8Array([0]), [red], 1, 1);
  assert.equal((await q.quantizePng(png)).animation, undefined);
  const raw = new wasm.ImageQuantizer();
  try {
    assert.equal(raw.quantizePngAnimation(png), undefined);
    const animation = raw.quantizePngAnimation(compositingApng(), 0);
    check(animation, compositedPixels);
  } finally {
    raw.free();
  }
});

test('uses one maxColors budget and rejects an unattainable animation quality', async (t) => {
  const q = new Quantizer();
  t.after(() => q.dispose());
  const png = makeApng({ width: 1, frames: [red, green, blue].map((samples) => ({ samples })) });
  const result = await q.quantizePng(png, { maxColors: 2, dithering: 0 });
  assert(result.paletteLength <= 2);
  const encoded = parseIndexedApng(result.pngBytes);
  for (const [i, frame] of encoded.frames.entries())
    assert.deepEqual(frame.pixels, [...result.animation.frames[i].imageData.data]);
  await assert.rejects(
    q.quantizePng(png, { maxColors: 2, quality: { min: 100, target: 100 } }),
    /quantize|quality/i,
  );
  for (const dithering of [NaN, Infinity, -1, 1.00001])
    await assert.rejects(q.quantizePng(png, { dithering }), /dithering/);
  assert.equal((await q.quantizePng(png)).animation.frames.length, 3);
});

function rewrite(bytes, type, update, which = 0) {
  let seen = 0;
  return Buffer.concat([
    Buffer.from(bytes).subarray(0, 8),
    ...chunksOf(bytes).map((c) => {
      const data = Buffer.from(c.data);
      if (c.type === type && seen++ === which) update(data);
      return chunk(c.type, data);
    }),
  ]);
}

test('raw and worker APIs reject corrupt APNG checksums and invalid animation controls', async (t) => {
  const q = new Quantizer();
  t.after(() => q.dispose());
  const original = compositingApng();
  const corrupt = [
    rewrite(original, 'acTL', (b) => b.writeUInt32BE(0)),
    rewrite(original, 'acTL', (b) => b.writeUInt32BE(0x80000000, 4)),
  ];
  for (const type of ['acTL', 'fcTL', 'fdAT']) {
    const bytes = Buffer.from(original);
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      if (bytes.toString('ascii', offset + 4, offset + 8) === type) {
        bytes[offset + 8 + length] ^= 1;
        break;
      }
      offset += 12 + length;
    }
    corrupt.push(bytes);
  }
  const raw = new wasm.ImageQuantizer();
  try {
    for (const bytes of corrupt) {
      assert.throws(() => wasm.decode_png_animation(bytes));
      assert.throws(() => raw.quantizePngAnimation(bytes));
      await assert.rejects(q.quantizePng(bytes));
    }
    assert.equal(wasm.decode_png_animation(original).animation.frames.length, 4);
    assert.equal((await q.quantizePng(original)).animation.frames.length, 4);
  } finally {
    raw.free();
  }
});

test('rejects malformed APNG counts, sequences, rectangles, trailing data, and limits without poisoning the worker', async (t) => {
  const q = new Quantizer();
  t.after(() => q.dispose());
  const original = compositingApng();
  const bad = [
    original.subarray(0, -1),
    Buffer.concat([original, Buffer.from([0])]),
    rewrite(original, 'acTL', (b) => b.writeUInt32BE(3)),
    rewrite(original, 'acTL', (b) => b.writeUInt32BE(5)),
    rewrite(original, 'acTL', (b) => b.writeUInt32BE(1001)),
    rewrite(original, 'acTL', (b) => b.writeUInt32BE(0)),
    rewrite(original, 'fcTL', (b) => b.writeUInt32BE(99)),
    rewrite(original, 'fcTL', (b) => b.writeUInt32BE(99, 12), 1),
    rewrite(original, 'fcTL', (b) => b.writeUInt32BE(0, 4), 1),
    rewrite(
      original,
      'fcTL',
      (b) => {
        b[24] = 3;
      },
      1,
    ),
    rewrite(
      original,
      'fcTL',
      (b) => {
        b[25] = 2;
      },
      1,
    ),
    rewrite(original, 'fdAT', (b) => {
      b[4] ^= 255;
    }),
  ];
  let huge = rewrite(original, 'IHDR', (b) => {
    b.writeUInt32BE(4096);
    b.writeUInt32BE(4096, 4);
  });
  huge = rewrite(huge, 'fcTL', (b) => {
    b.writeUInt32BE(4096, 4);
    b.writeUInt32BE(4096, 8);
  });
  huge = rewrite(huge, 'acTL', (b) => b.writeUInt32BE(5));
  bad.push(huge);
  const crc = Buffer.from(original);
  crc[crc.length - 1] ^= 1;
  bad.push(crc);
  for (const png of bad)
    await assert.rejects(q.quantizePng(png), (error) => {
      assert(!/unreachable|out of bounds memory/i.test(error.message), error.message);
      return true;
    });
  check(await q.quantizePng(original, { dithering: 0 }), compositedPixels);
});

test('concurrent cold APNG calls own their frame arrays and preserve caller buffers', async (t) => {
  const q = new Quantizer();
  t.after(() => q.dispose());
  const png = compositingApng(),
    before = Buffer.from(png);
  const [a, b] = await Promise.all([q.quantizePng(png), q.quantizePng(new Blob([png]))]);
  assert.deepEqual(png, before);
  assert.notEqual(
    a.animation.frames[0].imageData.data.buffer,
    a.animation.frames[1].imageData.data.buffer,
  );
  assert.notEqual(
    a.animation.frames[0].imageData.data.buffer,
    b.animation.frames[0].imageData.data.buffer,
  );
  const bytes = [...b.animation.frames[0].imageData.data];
  a.animation.frames[0].imageData.data.fill(42);
  assert.deepEqual([...b.animation.frames[0].imageData.data], bytes);
});
