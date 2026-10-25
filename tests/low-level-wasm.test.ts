import { describe, it, expect, beforeAll } from 'vitest';
import initWasm, {
  ImageQuantizer,
  decode_png_to_rgba,
  encode_palette_to_png,
} from '../dist/wasm/libimagequant_wasm.js';
import { createTestImageData, createTestPng, hasValidPngSignature } from './helpers';

beforeAll(async () => {
  await initWasm();
});

describe('ImageQuantizer', () => {
  it('constructor creates instance', () => {
    const q = new ImageQuantizer();
    expect(q).toBeDefined();
    q.free();
  });

  it('setSpeed with valid values (1, 5, 10)', () => {
    const q = new ImageQuantizer();
    try {
      expect(() => q.setSpeed(1)).not.toThrow();
      expect(() => q.setSpeed(5)).not.toThrow();
      expect(() => q.setSpeed(10)).not.toThrow();
    } finally {
      q.free();
    }
  });

  it('setSpeed with invalid value throws', () => {
    const q = new ImageQuantizer();
    try {
      expect(() => q.setSpeed(0)).toThrow();
      expect(() => q.setSpeed(11)).toThrow();
    } finally {
      q.free();
    }
  });

  it('setQuality with valid range', () => {
    const q = new ImageQuantizer();
    try {
      expect(() => q.setQuality(0, 100)).not.toThrow();
      expect(() => q.setQuality(50, 90)).not.toThrow();
    } finally {
      q.free();
    }
  });

  it('setMaxColors with valid range', () => {
    const q = new ImageQuantizer();
    try {
      expect(() => q.setMaxColors(2)).not.toThrow();
      expect(() => q.setMaxColors(128)).not.toThrow();
      expect(() => q.setMaxColors(256)).not.toThrow();
    } finally {
      q.free();
    }
  });

  it('setPosterization with valid values', () => {
    const q = new ImageQuantizer();
    try {
      expect(() => q.setPosterization(0)).not.toThrow();
      expect(() => q.setPosterization(2)).not.toThrow();
      expect(() => q.setPosterization(4)).not.toThrow();
    } finally {
      q.free();
    }
  });

  it('quantizeImage with valid data', () => {
    const q = new ImageQuantizer();
    try {
      const imageData = createTestImageData(10, 10, 'solid-red');
      const result = q.quantizeImage(imageData.data, 10, 10);
      expect(result).toBeDefined();
      result.free();
    } finally {
      q.free();
    }
  });

  it('quantizeImage with wrong data length throws', () => {
    const q = new ImageQuantizer();
    try {
      const wrongData = new Uint8ClampedArray(100); // not 10*10*4
      expect(() => q.quantizeImage(wrongData, 10, 10)).toThrow();
    } finally {
      q.free();
    }
  });

  it('free() releases resources', () => {
    const q = new ImageQuantizer();
    q.free();
    // After free, calling methods should throw
    expect(() => q.setSpeed(5)).toThrow();
  });
});

function createQuantResult(width = 10, height = 10) {
  const q = new ImageQuantizer();
  const imageData = createTestImageData(width, height, 'gradient');
  const result = q.quantizeImage(imageData.data, width, height);
  q.free();
  return { result, imageData };
}

describe('QuantizationResult', () => {
  it('getPalette returns array of RGBA arrays', () => {
    const { result } = createQuantResult();
    try {
      const palette = result.getPalette();
      expect(Array.isArray(palette)).toBe(true);
      expect(palette.length).toBeGreaterThanOrEqual(1);
      for (const color of palette) {
        expect(color).toHaveLength(4);
        for (const channel of color) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    } finally {
      result.free();
    }
  });

  it('getPaletteLength matches palette array length', () => {
    const { result } = createQuantResult();
    try {
      const palette = result.getPalette();
      const length = result.getPaletteLength();
      expect(length).toBe(palette.length);
    } finally {
      result.free();
    }
  });

  it('getQuantizationQuality returns number in [0, 1]', () => {
    const { result } = createQuantResult();
    try {
      const quality = result.getQuantizationQuality();
      expect(typeof quality).toBe('number');
      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(1);
    } finally {
      result.free();
    }
  });

  it('setDithering with valid values does not throw', () => {
    const { result } = createQuantResult();
    try {
      expect(() => result.setDithering(0.0)).not.toThrow();
      expect(() => result.setDithering(0.5)).not.toThrow();
      expect(() => result.setDithering(1.0)).not.toThrow();
    } finally {
      result.free();
    }
  });

  it('remapImage returns Uint8ClampedArray with correct length', () => {
    const { result, imageData } = createQuantResult(10, 10);
    try {
      const remapped = result.remapImage(imageData.data, 10, 10);
      expect(remapped).toBeInstanceOf(Uint8ClampedArray);
      expect(remapped.length).toBe(10 * 10 * 4);
    } finally {
      result.free();
    }
  });

  it('getPaletteIndices returns Uint8Array with correct length', () => {
    const { result, imageData } = createQuantResult(10, 10);
    try {
      const indices = result.getPaletteIndices(imageData.data, 10, 10);
      expect(indices).toBeInstanceOf(Uint8Array);
      expect(indices.length).toBe(10 * 10);
    } finally {
      result.free();
    }
  });

  it('palette indices are within palette range', () => {
    const { result, imageData } = createQuantResult(10, 10);
    try {
      const palette = result.getPalette();
      const indices = result.getPaletteIndices(imageData.data, 10, 10);
      for (let i = 0; i < indices.length; i++) {
        expect(indices[i]).toBeLessThan(palette.length);
      }
    } finally {
      result.free();
    }
  });

  it('free() releases resources', () => {
    const { result } = createQuantResult();
    result.free();
    expect(() => result.getPalette()).toThrow();
  });
});

describe('decode_png_to_rgba', () => {
  it('decodes valid PNG', async () => {
    const png = await createTestPng(10, 10, 'solid-red');
    const result = decode_png_to_rgba(png);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
    const [rgba, width, height] = result;
    expect(rgba).toBeInstanceOf(Uint8ClampedArray);
    expect(width).toBe(10);
    expect(height).toBe(10);
    expect(rgba.length).toBe(10 * 10 * 4);
  });

  it('decoded RGBA has correct pixel values for solid color', async () => {
    const png = await createTestPng(4, 4, 'solid-red');
    const [rgba] = decode_png_to_rgba(png);

    // Every pixel should be red
    for (let i = 0; i < rgba.length; i += 4) {
      expect(rgba[i]).toBe(255); // R
      expect(rgba[i + 1]).toBe(0); // G
      expect(rgba[i + 2]).toBe(0); // B
      expect(rgba[i + 3]).toBe(255); // A
    }
  });

  it('throws on invalid data', () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    expect(() => decode_png_to_rgba(garbage)).toThrow();
  });

  it('throws on empty data', () => {
    const empty = new Uint8Array(0);
    expect(() => decode_png_to_rgba(empty)).toThrow();
  });
});

describe('encode_palette_to_png', () => {
  it('produces valid PNG bytes', () => {
    const width = 4;
    const height = 4;
    const indices = new Uint8Array(width * height).fill(0);
    const palette = [[255, 0, 0, 255]];

    const pngBytes = encode_palette_to_png(indices, palette, width, height);
    expect(pngBytes).toBeInstanceOf(Uint8Array);
    expect(hasValidPngSignature(pngBytes)).toBe(true);
  });

  it('encodes multiple palette colors', () => {
    const width = 2;
    const height = 2;
    const indices = new Uint8Array([0, 1, 2, 3]);
    const palette = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
    ];

    const pngBytes = encode_palette_to_png(indices, palette, width, height);
    expect(hasValidPngSignature(pngBytes)).toBe(true);
  });

  it('handles transparency correctly', () => {
    const width = 2;
    const height = 1;
    const indices = new Uint8Array([0, 1]);
    const palette = [
      [255, 0, 0, 255], // opaque
      [0, 0, 255, 128], // semi-transparent
    ];

    const pngBytes = encode_palette_to_png(indices, palette, width, height);
    expect(hasValidPngSignature(pngBytes)).toBe(true);

    // Decode it back and verify dimensions
    const [rgba, w, h] = decode_png_to_rgba(pngBytes);
    expect(w).toBe(2);
    expect(h).toBe(1);
    expect(rgba.length).toBe(2 * 1 * 4);
  });

  it('throws on indices length mismatch', () => {
    const indices = new Uint8Array([0, 1]); // 2 pixels
    const palette = [[255, 0, 0, 255]];
    // width*height = 4, but only 2 indices
    expect(() => encode_palette_to_png(indices, palette, 2, 2)).toThrow();
  });
});

describe('PNG encode/decode roundtrip', () => {
  it('full roundtrip preserves dimensions', () => {
    const q = new ImageQuantizer();
    const imageData = createTestImageData(20, 15, 'four-quadrants');
    const quantResult = q.quantizeImage(imageData.data, 20, 15);
    q.free();

    try {
      const palette = quantResult.getPalette();
      const indices = quantResult.getPaletteIndices(imageData.data, 20, 15);
      const pngBytes = encode_palette_to_png(indices, palette, 20, 15);

      expect(hasValidPngSignature(pngBytes)).toBe(true);

      const [decoded, w, h] = decode_png_to_rgba(pngBytes);
      expect(w).toBe(20);
      expect(h).toBe(15);
      expect(decoded.length).toBe(20 * 15 * 4);
    } finally {
      quantResult.free();
    }
  });

  it('roundtrip produces pixels that map to palette colors', () => {
    const q = new ImageQuantizer();
    q.setMaxColors(4);
    const imageData = createTestImageData(10, 10, 'four-quadrants');
    const quantResult = q.quantizeImage(imageData.data, 10, 10);
    q.free();

    try {
      const palette = quantResult.getPalette();
      const indices = quantResult.getPaletteIndices(imageData.data, 10, 10);
      const pngBytes = encode_palette_to_png(indices, palette, 10, 10);
      const [decoded] = decode_png_to_rgba(pngBytes);

      // Every decoded pixel should match a palette entry
      for (let i = 0; i < decoded.length; i += 4) {
        const pixel = [decoded[i], decoded[i + 1], decoded[i + 2], decoded[i + 3]];
        const matchesPalette = palette.some(
          (c: number[]) =>
            c[0] === pixel[0] && c[1] === pixel[1] && c[2] === pixel[2] && c[3] === pixel[3],
        );
        expect(matchesPalette).toBe(true);
      }
    } finally {
      quantResult.free();
    }
  });
});
