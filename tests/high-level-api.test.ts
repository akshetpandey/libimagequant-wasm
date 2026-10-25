import { describe, it, expect } from 'vitest';
import LibImageQuant from '../dist/index.mjs';
import type { QuantizationOptions, QuantizationResult } from '../dist/index.mjs';
import {
  createTestPng,
  createTestImageData,
  hasValidPngSignature,
} from './helpers';

const WORKER_URL = '/worker.mjs';

function createInstance(opts: Record<string, unknown> = {}) {
  return new LibImageQuant({ workerUrl: WORKER_URL, ...opts });
}

describe('LibImageQuant - Initialization', () => {
  it('creates an instance and initializes without error', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(4, 4, 'solid-red');
      const result = await instance.quantizePng(png);
      expect(result).toBeDefined();
    } finally {
      instance.dispose();
    }
  });

  it('accepts custom workerUrl', async () => {
    const instance = new LibImageQuant({ workerUrl: WORKER_URL });
    try {
      const png = await createTestPng(4, 4, 'solid-red');
      const result = await instance.quantizePng(png);
      expect(result.width).toBe(4);
    } finally {
      instance.dispose();
    }
  });

  it('rejects with timeout on invalid workerUrl', async () => {
    const instance = new LibImageQuant({
      workerUrl: '/nonexistent-worker.mjs',
      initTimeout: 500,
    });
    const png = await createTestPng(4, 4, 'solid-red');
    await expect(instance.quantizePng(png)).rejects.toThrow();
    // dispose to prevent leaked rejection after timeout
    instance.dispose();
    // Allow time for any async error handlers to settle
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('reports initialization failures to operations started after the worker fails', async () => {
    const instance = new LibImageQuant({
      workerUrl: '/nonexistent-worker.mjs',
      initTimeout: 500,
    });
    try {
      // Let initialization reject before attaching an operation's error handler.
      await new Promise(resolve => setTimeout(resolve, 600));
      const imageData = createTestImageData(4, 4, 'solid-red');
      await expect(instance.quantizeImageData(imageData)).rejects.toThrow(
        /Worker (error|initialization timeout)/
      );
    } finally {
      instance.dispose();
    }
  });
});

describe('LibImageQuant - quantizePng', () => {
  it('quantizes a solid-color PNG', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(10, 10, 'solid-red');
      const result = await instance.quantizePng(png);

      expect(result.width).toBe(10);
      expect(result.height).toBe(10);
      expect(result.paletteLength).toBeGreaterThanOrEqual(1);
      expect(result.palette.length).toBe(result.paletteLength);
      expect(result.quality).toBeGreaterThanOrEqual(0);
      expect(result.quality).toBeLessThanOrEqual(1);
      expect(result.pngBytes).toBeInstanceOf(Uint8Array);
      expect(result.pngBytes.length).toBeGreaterThan(8);
      expect(result.imageData).toBeInstanceOf(ImageData);
      expect(result.imageData.width).toBe(10);
      expect(result.imageData.height).toBe(10);
    } finally {
      instance.dispose();
    }
  });

  it('quantizes a gradient PNG', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(50, 50, 'gradient');
      const result = await instance.quantizePng(png);

      expect(result.width).toBe(50);
      expect(result.height).toBe(50);
      expect(result.paletteLength).toBeGreaterThan(1);
      expect(result.imageData.data.length).toBe(50 * 50 * 4);
    } finally {
      instance.dispose();
    }
  });

  it('accepts Uint8Array input', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(8, 8, 'solid-blue');
      const result = await instance.quantizePng(png);
      expect(result.width).toBe(8);
    } finally {
      instance.dispose();
    }
  });

  it('accepts ArrayBuffer input', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(8, 8, 'solid-blue');
      const result = await instance.quantizePng(png.buffer as ArrayBuffer);
      expect(result.width).toBe(8);
    } finally {
      instance.dispose();
    }
  });

  it('accepts Blob input', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(8, 8, 'solid-blue');
      const blob = new Blob([png], { type: 'image/png' });
      const result = await instance.quantizePng(blob);
      expect(result.width).toBe(8);
    } finally {
      instance.dispose();
    }
  });

  it('returns valid PNG bytes', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(10, 10, 'gradient');
      const result = await instance.quantizePng(png);
      expect(hasValidPngSignature(result.pngBytes)).toBe(true);
    } finally {
      instance.dispose();
    }
  });

  it('returns imageData with correct pixel count', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(20, 15, 'gradient');
      const result = await instance.quantizePng(png);
      expect(result.imageData.data.length).toBe(20 * 15 * 4);
    } finally {
      instance.dispose();
    }
  });
});

describe('LibImageQuant - quantizeImageData', () => {
  it('quantizes a simple ImageData', async () => {
    const instance = createInstance();
    try {
      const imageData = createTestImageData(10, 10, 'solid-red');
      const result = await instance.quantizeImageData(imageData);

      expect(result.width).toBe(10);
      expect(result.height).toBe(10);
      expect(result.paletteLength).toBeGreaterThanOrEqual(1);
      expect(result.imageData).toBeInstanceOf(ImageData);
    } finally {
      instance.dispose();
    }
  });

  it('quantizes a gradient ImageData', async () => {
    const instance = createInstance();
    try {
      const imageData = createTestImageData(50, 50, 'gradient');
      const result = await instance.quantizeImageData(imageData);

      expect(result.width).toBe(50);
      expect(result.height).toBe(50);
      expect(result.paletteLength).toBeGreaterThan(1);
    } finally {
      instance.dispose();
    }
  });

  it('result dimensions match input', async () => {
    const instance = createInstance();
    try {
      const imageData = createTestImageData(30, 20, 'checkerboard');
      const result = await instance.quantizeImageData(imageData);

      expect(result.width).toBe(30);
      expect(result.height).toBe(20);
      expect(result.imageData.width).toBe(30);
      expect(result.imageData.height).toBe(20);
    } finally {
      instance.dispose();
    }
  });
});

describe('LibImageQuant - QuantizationOptions', () => {
  it('speed option: both extremes succeed', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(20, 20, 'gradient');
      const fast = await instance.quantizePng(png, { speed: 10 });
      expect(fast.width).toBe(20);
    } finally {
      instance.dispose();
    }

    const instance2 = createInstance();
    try {
      const png = await createTestPng(20, 20, 'gradient');
      const slow = await instance2.quantizePng(png, { speed: 1 });
      expect(slow.width).toBe(20);
    } finally {
      instance2.dispose();
    }
  });

  it('maxColors limits palette size', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(30, 30, 'gradient');
      const result = await instance.quantizePng(png, { maxColors: 4 });
      expect(result.paletteLength).toBeLessThanOrEqual(4);
    } finally {
      instance.dispose();
    }
  });

  it('maxColors: 2 produces at most 2 colors', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(20, 20, 'gradient');
      const result = await instance.quantizePng(png, { maxColors: 2 });
      expect(result.paletteLength).toBeLessThanOrEqual(2);
    } finally {
      instance.dispose();
    }
  });

  it('maxColors: 256 allows full palette', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(50, 50, 'gradient');
      const result = await instance.quantizePng(png, { maxColors: 256 });
      expect(result.paletteLength).toBeLessThanOrEqual(256);
      expect(result.paletteLength).toBeGreaterThan(4);
    } finally {
      instance.dispose();
    }
  });

  it('quality option succeeds', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(20, 20, 'gradient');
      const result = await instance.quantizePng(png, {
        quality: { min: 0, target: 100 },
      });
      expect(result.quality).toBeGreaterThanOrEqual(0);
    } finally {
      instance.dispose();
    }
  });

  it('dithering 0.0 and 1.0 produce different output', async () => {
    const png = await createTestPng(20, 20, 'gradient');

    const instance1 = createInstance();
    let noDither: QuantizationResult;
    try {
      noDither = await instance1.quantizePng(png, { dithering: 0.0, maxColors: 4 });
    } finally {
      instance1.dispose();
    }

    const instance2 = createInstance();
    let fullDither: QuantizationResult;
    try {
      fullDither = await instance2.quantizePng(png, { dithering: 1.0, maxColors: 4 });
    } finally {
      instance2.dispose();
    }

    // The pixel data should differ between no dithering and full dithering
    const data1 = noDither!.imageData.data;
    const data2 = fullDither!.imageData.data;
    let diffCount = 0;
    for (let i = 0; i < data1.length; i++) {
      if (data1[i] !== data2[i]) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  it('posterization option succeeds', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(20, 20, 'gradient');
      const result = await instance.quantizePng(png, { posterization: 4 });
      expect(result.width).toBe(20);
    } finally {
      instance.dispose();
    }
  });

  it('combined options work together', async () => {
    const instance = createInstance();
    try {
      const png = await createTestPng(30, 30, 'gradient');
      const result = await instance.quantizePng(png, {
        speed: 3,
        maxColors: 16,
        dithering: 0.5,
        quality: { min: 0, target: 90 },
      });
      expect(result.paletteLength).toBeLessThanOrEqual(16);
      expect(result.width).toBe(30);
    } finally {
      instance.dispose();
    }
  });
});

describe('LibImageQuant - dispose', () => {
  it('dispose during init rejects subsequent operations', async () => {
    const instance = createInstance();
    // Immediately dispose before init completes
    instance.dispose();

    const png = await createTestPng(4, 4, 'solid-red');
    await expect(instance.quantizePng(png)).rejects.toThrow();
  });

  it('dispose is idempotent', () => {
    const instance = createInstance();
    instance.dispose();
    expect(() => instance.dispose()).not.toThrow();
  });

  it('operations after dispose reject', async () => {
    const instance = createInstance();
    instance.dispose();

    const png = await createTestPng(4, 4, 'solid-red');
    await expect(instance.quantizePng(png)).rejects.toThrow();
  });
});

describe('LibImageQuant - Concurrent operations', () => {
  it('handles multiple simultaneous quantizations', async () => {
    const instance = createInstance();
    try {
      const png1 = await createTestPng(10, 10, 'solid-red');
      const png2 = await createTestPng(10, 10, 'solid-blue');
      const png3 = await createTestPng(10, 10, 'gradient');

      const [r1, r2, r3] = await Promise.all([
        instance.quantizePng(png1),
        instance.quantizePng(png2),
        instance.quantizePng(png3),
      ]);

      expect(r1.width).toBe(10);
      expect(r2.width).toBe(10);
      expect(r3.width).toBe(10);
    } finally {
      instance.dispose();
    }
  });
});

describe('LibImageQuant - Error handling', () => {
  it('rejects on invalid PNG data', async () => {
    const instance = createInstance();
    try {
      const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      await expect(instance.quantizePng(garbage)).rejects.toThrow();
    } finally {
      instance.dispose();
    }
  });

  it('rejects on empty input', async () => {
    const instance = createInstance();
    try {
      const empty = new Uint8Array(0);
      await expect(instance.quantizePng(empty)).rejects.toThrow();
    } finally {
      instance.dispose();
    }
  });
});
