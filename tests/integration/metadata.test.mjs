import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { deflateSync, inflateSync } from 'node:zlib';
import Quantizer from 'libimagequant-wasm/node';
import * as wasm from '../../dist/wasm/libimagequant_wasm.js';
import { chunk, chunksOf, compositingApng, red, blue, addMetadata } from './apng-fixtures.mjs';

wasm.initSync({
  module: await readFile(new URL('../../dist/wasm/libimagequant_wasm_bg.wasm', import.meta.url)),
});
const CommonQuantizer = createRequire(import.meta.url)('libimagequant-wasm/node');
const exif = Buffer.from([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const density = Buffer.from([0, 0, 11, 19, 0, 0, 11, 19, 1]);
const gamma = Buffer.alloc(4);
gamma.writeUInt32BE(45455);
const chroma = Buffer.alloc(32);
[31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000].forEach((n, i) =>
  chroma.writeUInt32BE(n, i * 4),
);

function sample(animated) {
  const source = animated
    ? compositingApng()
    : wasm.encode_palette_to_png(new Uint8Array([0, 1]), [red, blue], 2, 1);
  return addMetadata(
    source,
    [chunk('gAMA', gamma), chunk('cHRM', chroma), chunk('pHYs', density), chunk('eXIf', exif)],
    [
      chunk('tEXt', Buffer.from('Author\0Example')),
      chunk('zTXt', Buffer.concat([Buffer.from('Comment\0\0'), deflateSync('Compressed text')])),
      chunk('iTXt', Buffer.from('Title\0\0\0en\0Title\0Beach ball')),
      chunk('vpAg', Buffer.from('unknown unsafe data')),
    ],
  );
}
function fields(bytes) {
  return new Map(chunksOf(bytes).map((c) => [c.type, c.data]));
}

for (const [label, Q] of [
  ['ESM', Quantizer],
  ['CommonJS', CommonQuantizer],
]) {
  test(`${label} selects metadata for static PNG and APNG, including text after image data`, async (t) => {
    const q = new Q();
    t.after(() => q.dispose());
    for (const animated of [false, true]) {
      const input = sample(animated);
      const results = [];
      for (const metadata of ['safe', 'all', 'none']) {
        const result = await q.quantizePng(input, { metadata, dithering: 0 });
        const output = fields(result.pngBytes);
        assert.equal(Boolean(result.animation), animated);
        for (const name of ['gAMA', 'cHRM', 'pHYs']) {
          assert.equal(output.has(name), metadata !== 'none', name);
          if (output.has(name)) assert.deepEqual(output.get(name), fields(input).get(name));
        }
        for (const name of ['tEXt', 'zTXt', 'iTXt', 'eXIf'])
          assert.equal(output.has(name), metadata === 'all', name);
        if (metadata === 'all') {
          assert.deepEqual(output.get('eXIf'), exif);
          assert.equal(output.get('tEXt').toString(), 'Author\0Example');
          assert.equal(
            inflateSync(output.get('zTXt').subarray('Comment'.length + 2)).toString(),
            'Compressed text',
          );
          assert.equal(output.get('iTXt').toString(), 'Title\0\0\0en\0Title\0Beach ball');
        }
        for (const name of ['vpAg', 'sBIT', 'hIST', 'bKGD']) assert(!output.has(name), name);
        results.push(result);
      }
      assert.deepEqual(results[0].imageData.data, results[1].imageData.data);
      assert.deepEqual(results[0].imageData.data, results[2].imageData.data);
      assert.deepEqual(
        (await q.quantizePng(input, { dithering: 0 })).pngBytes,
        results[0].pngBytes,
      );
    }
    for (const metadata of ['invalid', true, {}, null])
      await assert.rejects(q.quantizePng(sample(false), { metadata }), /metadata/);
  });
}

test('RGB ICC profiles are preserved and grayscale profiles are omitted from indexed RGB', async (t) => {
  const q = new Quantizer();
  t.after(() => q.dispose());
  const source = await readFile(new URL('../fixtures/beach-ball.apng', import.meta.url));
  for (const colorSpace of ['RGB ', 'GRAY']) {
    const profile = Buffer.alloc(132);
    profile.writeUInt32BE(profile.length);
    profile.write(colorSpace, 16);
    profile.write('acsp', 36);
    const input = addMetadata(source, [
      chunk('iCCP', Buffer.concat([Buffer.from('Test\0\0'), deflateSync(profile)])),
    ]);
    const result = await q.quantizePng(input, { maxColors: 64, dithering: 0 });
    const output = fields(result.pngBytes);
    assert.equal(output.has('iCCP'), colorSpace === 'RGB ');
    if (output.has('iCCP')) {
      const iccp = output.get('iCCP');
      assert.deepEqual(inflateSync(iccp.subarray(iccp.indexOf(0) + 2)), profile);
    }
    assert(!fields((await q.quantizePng(input, { metadata: 'none' })).pngBytes).has('iCCP'));
  }
});

test('metadata preservation rejects oversized and compressed text without poisoning the worker', async (t) => {
  const q = new Quantizer();
  t.after(() => q.dispose());
  const source = await readFile(new URL('../fixtures/beach-ball-45.apng', import.meta.url));
  for (const extra of [
    chunk('tEXt', Buffer.from(`Comment\0${'x'.repeat(1048577)}`)),
    chunk('zTXt', Buffer.concat([Buffer.from('Comment\0\0'), deflateSync('x'.repeat(1048577))])),
  ]) {
    const input = addMetadata(source, [], [extra]);
    await assert.rejects(q.quantizePng(input, { metadata: 'all' }), /metadata/);
    assert.equal((await q.quantizePng(input, { metadata: 'safe' })).animation.frames.length, 20);
  }
});

test('linear PNG gamma survives quantization and stale palette metadata is dropped', async (t) => {
  const q = new Quantizer();
  t.after(() => q.dispose());
  const source = wasm.encode_palette_to_png(new Uint8Array([0, 1]), [red, blue], 2, 1);
  const linear = Buffer.alloc(4);
  linear.writeUInt32BE(100000);
  const input = addMetadata(
    source,
    [chunk('gAMA', linear)],
    [
      chunk('bKGD', Buffer.from([0])),
      chunk('hIST', Buffer.alloc(4)),
      chunk('sBIT', Buffer.from([8, 8, 8])),
    ],
  );
  const result = await q.quantizePng(input, { dithering: 0 });
  assert.deepEqual(fields(result.pngBytes).get('gAMA'), linear);
  for (const name of ['bKGD', 'hIST', 'sBIT']) assert(!fields(result.pngBytes).has(name));
  assert.deepEqual([...result.imageData.data], [...red, ...blue]);
});

test('sRGB takes precedence over gAMA and uncommon valid gamma values remain supported', async (t) => {
  const q = new Quantizer();
  t.after(() => q.dispose());
  const colors = [
    [128, 64, 32, 255],
    [64, 128, 200, 255],
  ];
  const source = wasm.encode_palette_to_png(new Uint8Array([0, 1]), colors, 2, 1);
  for (const value of [100000, 200000]) {
    const encoded = Buffer.alloc(4);
    encoded.writeUInt32BE(value);
    const input = addMetadata(source, [chunk('gAMA', encoded)]);
    const output = await q.quantizePng(input, { dithering: 0 });
    assert.deepEqual(fields(output.pngBytes).get('gAMA'), encoded);
    for (const [i, channel] of output.imageData.data.entries())
      assert(Math.abs(channel - colors.flat()[i]) <= 1);
  }
  const tagged = addMetadata(source, [chunk('gAMA', gamma), chunk('sRGB', Buffer.from([0]))]);
  assert.deepEqual(fields((await q.quantizePng(tagged)).pngBytes).get('sRGB'), Buffer.from([0]));
});
