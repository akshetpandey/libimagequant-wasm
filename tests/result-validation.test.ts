import { describe, it, expect, beforeAll } from 'vitest';
import initWasm, {
  ImageQuantizer,
  decode_png_to_rgba,
  encode_palette_to_png,
} from '../dist/wasm/libimagequant_wasm.js';
import LibImageQuant from '../dist/index.mjs';
import {
  createTestImageData,
  createTestPng,
  hasValidPngSignature,
  paletteContainsColor,
} from './helpers';

const WORKER_URL = '/worker.mjs';

beforeAll(async () => {
  await initWasm();
});

describe('Color accuracy', () => {
  it('uses the final remapping palette for PNG and ImageData output', async () => {
    let seed = 17;
    const pixels = Uint8ClampedArray.from({ length: 64 * 64 * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24,
    );
    const q = new ImageQuantizer();
    const instance = new LibImageQuant({ workerUrl: WORKER_URL });
    try {
      q.setSpeed(3);
      q.setMaxColors(8);
      const reference = q.quantizeImage(pixels, 64, 64);
      try {
        reference.setDithering(1);
        const expected = reference.remapImage(pixels, 64, 64);
        const result = await instance.quantizeImageData(new ImageData(pixels, 64, 64), {
          speed: 3,
          maxColors: 8,
          dithering: 1,
        });
        expect(result.palette).toEqual(reference.getPalette());
        expect(result.imageData.data).toEqual(expected);
        expect(decode_png_to_rgba(result.pngBytes)[0]).toEqual(expected);
      } finally {
        reference.free();
      }
    } finally {
      q.free();
      instance.dispose();
    }
  });

  it('solid red image preserves red in palette', async () => {
    const instance = new LibImageQuant({ workerUrl: WORKER_URL });
    try {
      const png = await createTestPng(10, 10, 'solid-red');
      const result = await instance.quantizePng(png);

      expect(paletteContainsColor(result.palette, [255, 0, 0, 255], 5)).toBe(true);
    } finally {
      instance.dispose();
    }
  });

  it('solid blue image preserves blue in palette', async () => {
    const instance = new LibImageQuant({ workerUrl: WORKER_URL });
    try {
      const png = await createTestPng(10, 10, 'solid-blue');
      const result = await instance.quantizePng(png);

      expect(paletteContainsColor(result.palette, [0, 0, 255, 255], 5)).toBe(true);
    } finally {
      instance.dispose();
    }
  });

  it('four-quadrant image with maxColors=4 captures each color', async () => {
    const instance = new LibImageQuant({ workerUrl: WORKER_URL });
    try {
      const png = await createTestPng(20, 20, 'four-quadrants');
      const result = await instance.quantizePng(png, { maxColors: 4 });

      expect(result.paletteLength).toBeLessThanOrEqual(4);
      // Each quadrant color should be approximately present
      expect(paletteContainsColor(result.palette, [255, 0, 0, 255], 30)).toBe(true);
      expect(paletteContainsColor(result.palette, [0, 255, 0, 255], 30)).toBe(true);
      expect(paletteContainsColor(result.palette, [0, 0, 255, 255], 30)).toBe(true);
      expect(paletteContainsColor(result.palette, [255, 255, 255, 255], 30)).toBe(true);
    } finally {
      instance.dispose();
    }
  });

  it('checkerboard with maxColors=2 produces 2 colors', async () => {
    const instance = new LibImageQuant({ workerUrl: WORKER_URL });
    try {
      const png = await createTestPng(20, 20, 'checkerboard');
      const result = await instance.quantizePng(png, { maxColors: 2, dithering: 0 });

      expect(result.paletteLength).toBeLessThanOrEqual(2);
      expect(paletteContainsColor(result.palette, [255, 255, 255, 255], 10)).toBe(true);
      expect(paletteContainsColor(result.palette, [0, 0, 0, 255], 10)).toBe(true);
    } finally {
      instance.dispose();
    }
  });
});

describe('PNG output integrity', () => {
  it('output PNG has valid signature', async () => {
    const instance = new LibImageQuant({ workerUrl: WORKER_URL });
    try {
      const png = await createTestPng(20, 20, 'gradient');
      const result = await instance.quantizePng(png);

      expect(hasValidPngSignature(result.pngBytes)).toBe(true);
    } finally {
      instance.dispose();
    }
  });

  it('output indexed PNG has reasonable size', async () => {
    const instance = new LibImageQuant({ workerUrl: WORKER_URL });
    try {
      const inputPng = await createTestPng(50, 50, 'gradient');
      const result = await instance.quantizePng(inputPng, { maxColors: 16 });

      // Output should be a valid non-empty PNG
      expect(result.pngBytes.length).toBeGreaterThan(8);
      expect(hasValidPngSignature(result.pngBytes)).toBe(true);
    } finally {
      instance.dispose();
    }
  });

  it('output PNG can be decoded back to same dimensions', async () => {
    const instance = new LibImageQuant({ workerUrl: WORKER_URL });
    try {
      const png = await createTestPng(25, 15, 'gradient');
      const result = await instance.quantizePng(png);

      const [decoded, w, h] = decode_png_to_rgba(result.pngBytes);
      expect(w).toBe(25);
      expect(h).toBe(15);
      expect(decoded.length).toBe(25 * 15 * 4);
    } finally {
      instance.dispose();
    }
  });
});

describe('ImageData output integrity', () => {
  it('imageData dimensions match input', async () => {
    const instance = new LibImageQuant({ workerUrl: WORKER_URL });
    try {
      const png = await createTestPng(30, 20, 'gradient');
      const result = await instance.quantizePng(png);

      expect(result.imageData.width).toBe(30);
      expect(result.imageData.height).toBe(20);
    } finally {
      instance.dispose();
    }
  });

  it('imageData pixel count is correct', async () => {
    const instance = new LibImageQuant({ workerUrl: WORKER_URL });
    try {
      const png = await createTestPng(15, 25, 'gradient');
      const result = await instance.quantizePng(png);

      expect(result.imageData.data.length).toBe(15 * 25 * 4);
    } finally {
      instance.dispose();
    }
  });

  it('imageData pixels only use palette colors', async () => {
    const instance = new LibImageQuant({ workerUrl: WORKER_URL });
    try {
      const png = await createTestPng(10, 10, 'four-quadrants');
      const result = await instance.quantizePng(png, { maxColors: 8 });

      const data = result.imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const pixel = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        const matchesPalette = result.palette.some(
          (c: number[]) =>
            c[0] === pixel[0] && c[1] === pixel[1] && c[2] === pixel[2] && c[3] === pixel[3],
        );
        expect(matchesPalette).toBe(true);
      }
    } finally {
      instance.dispose();
    }
  });
});

describe('Transparency handling', () => {
  it('transparent image preserves alpha in palette', () => {
    const q = new ImageQuantizer();
    try {
      const imageData = createTestImageData(10, 10, 'transparent');
      const result = q.quantizeImage(imageData.data, 10, 10);
      try {
        const palette = result.getPalette();
        // Should have at least one fully transparent color
        const hasTransparent = palette.some((c: number[]) => c[3] === 0);
        const hasOpaque = palette.some((c: number[]) => c[3] === 255);
        expect(hasTransparent).toBe(true);
        expect(hasOpaque).toBe(true);
      } finally {
        result.free();
      }
    } finally {
      q.free();
    }
  });

  it('transparency roundtrips through PNG encode/decode', () => {
    const q = new ImageQuantizer();
    try {
      const imageData = createTestImageData(10, 10, 'transparent');
      const result = q.quantizeImage(imageData.data, 10, 10);
      try {
        const palette = result.getPalette();
        const indices = result.getPaletteIndices(imageData.data, 10, 10);
        const pngBytes = encode_palette_to_png(indices, palette, 10, 10);

        expect(hasValidPngSignature(pngBytes)).toBe(true);

        const [decoded, w, h] = decode_png_to_rgba(pngBytes);
        expect(w).toBe(10);
        expect(h).toBe(10);

        // Check that decoded data contains both transparent and opaque pixels
        let hasTransparentPixel = false;
        let hasOpaquePixel = false;
        for (let i = 0; i < decoded.length; i += 4) {
          if (decoded[i + 3] === 0) hasTransparentPixel = true;
          if (decoded[i + 3] === 255) hasOpaquePixel = true;
        }
        expect(hasTransparentPixel).toBe(true);
        expect(hasOpaquePixel).toBe(true);
      } finally {
        result.free();
      }
    } finally {
      q.free();
    }
  });
});
