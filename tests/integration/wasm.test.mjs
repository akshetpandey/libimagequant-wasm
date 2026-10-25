import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as wasm from '../../dist/wasm/libimagequant_wasm.js';
import png16 from '../fixtures/png-16bit.json' with { type: 'json' };

wasm.initSync({ module: await readFile(new URL('../../dist/wasm/libimagequant_wasm_bg.wasm', import.meta.url)) });

for (const fixture of png16) {
  test(`normalizes 16-bit ${fixture.name} PNGs to RGBA8`, () => {
    const [rgba, width, height] = wasm.decode_png_to_rgba(Buffer.from(fixture.base64, 'base64'));
    assert.deepEqual([width, height], [1, 1]);
    assert.deepEqual([...rgba], fixture.expected);
    const q = new wasm.ImageQuantizer();
    try {
      const result = q.quantizeImage(rgba, width, height);
      result.free();
    } finally {
      q.free();
    }
  });
}

test('rejects numeric options before integer narrowing or rounding', () => {
  const q = new wasm.ImageQuantizer();
  try {
    for (const value of [NaN, Infinity, -1, 1.5, 4294967300]) {
      assert.throws(() => q.setSpeed(value));
      assert.throws(() => q.setMaxColors(value));
      assert.throws(() => q.setPosterization(value));
    }
    for (const value of [NaN, Infinity, -1, 1.5, 256, 356]) {
      assert.throws(() => q.setQuality(value, 100));
      assert.throws(() => q.setQuality(0, value));
    }
    assert.throws(() => q.setQuality(256, 356));
    q.setQuality(0, 100);
    q.setSpeed(1);
    q.setSpeed(10);
    q.setMaxColors(2);
    q.setMaxColors(256);
    q.setPosterization(0);
    q.setPosterization(4);
    const result = q.quantizeImage(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
    try {
      for (const value of [NaN, Infinity, -1, 1 + 1e-8]) assert.throws(() => result.setDithering(value));
      result.setDithering(0);
      result.setDithering(1);
    } finally { result.free(); }
  } finally { q.free(); }
});

test('rejects PNG palette indices without a corresponding color', () => {
  const palette = [[255, 0, 0, 255]];
  for (const index of [1, 255]) {
    assert.throws(() => wasm.encode_palette_to_png(new Uint8Array([index]), palette, 1, 1), /outside the palette/);
  }
  assert.throws(() => wasm.encode_palette_to_png(new Uint8Array([0]), [], 1, 1), /at least one color/);
  const png = wasm.encode_palette_to_png(new Uint8Array([0]), palette, 1, 1);
  assert.deepEqual([...wasm.decode_png_to_rgba(png)[0]], palette[0]);
});
