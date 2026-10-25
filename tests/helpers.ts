/**
 * Test helpers for libimagequant-wasm.
 * These run directly in the browser via @vitest/browser.
 */

/** PNG file signature bytes */
export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export type ImageType =
  | 'solid-red'
  | 'solid-blue'
  | 'gradient'
  | 'checkerboard'
  | 'four-quadrants'
  | 'transparent';

/**
 * Create an ImageData with a deterministic pattern.
 */
export function createTestImageData(width: number, height: number, type: ImageType): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r: number, g: number, b: number, a: number;

      switch (type) {
        case 'solid-red':
          [r, g, b, a] = [255, 0, 0, 255];
          break;
        case 'solid-blue':
          [r, g, b, a] = [0, 0, 255, 255];
          break;
        case 'gradient':
          r = Math.floor((x / width) * 255);
          g = Math.floor((y / height) * 255);
          b = Math.floor(((x + y) / (width + height)) * 255);
          a = 255;
          break;
        case 'checkerboard': {
          const size = 4;
          const isWhite = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0;
          [r, g, b, a] = isWhite ? [255, 255, 255, 255] : [0, 0, 0, 255];
          break;
        }
        case 'four-quadrants': {
          const isRight = x >= width / 2;
          const isBottom = y >= height / 2;
          if (!isRight && !isBottom) [r, g, b, a] = [255, 0, 0, 255];
          else if (isRight && !isBottom) [r, g, b, a] = [0, 255, 0, 255];
          else if (!isRight && isBottom) [r, g, b, a] = [0, 0, 255, 255];
          else [r, g, b, a] = [255, 255, 255, 255];
          break;
        }
        case 'transparent':
          [r, g, b, a] = [255, 0, 0, x < width / 2 ? 255 : 0];
          break;
        default:
          [r, g, b, a] = [128, 128, 128, 255];
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }

  return new ImageData(data, width, height);
}

/**
 * Create a PNG Uint8Array from an ImageData using OffscreenCanvas.
 */
export async function createTestPng(
  width: number,
  height: number,
  type: ImageType,
): Promise<Uint8Array> {
  const imageData = createTestImageData(width, height, type);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Check if a color is close to an expected color (within tolerance per channel).
 */
export function colorCloseTo(actual: number[], expected: number[], tolerance = 10): boolean {
  if (actual.length < 4 || expected.length < 4) return false;
  return (
    Math.abs(actual[0] - expected[0]) <= tolerance &&
    Math.abs(actual[1] - expected[1]) <= tolerance &&
    Math.abs(actual[2] - expected[2]) <= tolerance &&
    Math.abs(actual[3] - expected[3]) <= tolerance
  );
}

/**
 * Check if a palette contains a color close to the expected one.
 */
export function paletteContainsColor(
  palette: number[][],
  expected: number[],
  tolerance = 10,
): boolean {
  return palette.some((color) => colorCloseTo(color, expected, tolerance));
}

/**
 * Verify a PNG byte sequence starts with the correct signature.
 */
export function hasValidPngSignature(bytes: Uint8Array | number[]): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}
