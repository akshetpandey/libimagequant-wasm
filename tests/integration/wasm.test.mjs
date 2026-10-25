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
