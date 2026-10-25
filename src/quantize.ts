import type { QuantizationOptions, QuantizationResult } from './types.js';
type WasmModule = typeof import('virtual:libimagequant-wasm');
type Quantizer = InstanceType<WasmModule['ImageQuantizer']>;

export interface PngQuantizationData {
  pngBytes: Uint8Array | Blob | number[];
  options?: QuantizationOptions;
}

export interface ImageDataQuantizationData {
  imageData: Uint8ClampedArray | number[];
  width: number;
  height: number;
  options?: QuantizationOptions;
}

export async function quantizePng(
  wasmModule: WasmModule,
  data: PngQuantizationData,
): Promise<QuantizationResult> {
  const { pngBytes, options = {} } = data;
  const pngData =
    pngBytes instanceof Blob
      ? new Uint8Array(await pngBytes.arrayBuffer())
      : pngBytes instanceof Uint8Array
        ? pngBytes
        : new Uint8Array(pngBytes);

  return withQuantizer(wasmModule, options, (quantizer) => {
    if (hasAnimationControl(pngData)) {
      const animation = quantizer.quantizePngAnimation(
        pngData,
        options.dithering,
        options.includeFrameData,
        options.metadata,
      );
      if (!animation) throw new Error('Missing APNG animation control');
      return animation;
    }
    return quantizer.quantizePng(pngData, options.dithering, options.metadata);
  });
}

// Sniff headers only; static images retain their single Rust decode/copy path.
function hasAnimationControl(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset + 8 <= bytes.length; offset += 12 + view.getUint32(offset)) {
    const chunk = view.getUint32(offset + 4);
    if (chunk === 0x6163544c) return true; // acTL
    if (chunk === 0x49444154 || chunk === 0x49454e44) return false; // IDAT / IEND
  }
  return false;
}

export async function quantizeImageData(
  wasmModule: WasmModule,
  data: ImageDataQuantizationData,
): Promise<QuantizationResult> {
  const { imageData, width, height, options = {} } = data;
  const rgba =
    imageData instanceof Uint8ClampedArray ? imageData : new Uint8ClampedArray(imageData);
  return withQuantizer(wasmModule, options, (quantizer) =>
    quantizeRgbaData(wasmModule, quantizer, rgba, width, height, options.dithering),
  );
}

function withQuantizer<T>(
  wasm: WasmModule,
  options: QuantizationOptions,
  run: (quantizer: Quantizer) => T,
): T {
  if (options.includeFrameData !== undefined && typeof options.includeFrameData !== 'boolean')
    throw new TypeError('includeFrameData must be a boolean');
  if (options.metadata !== undefined && !['safe', 'all', 'none'].includes(options.metadata))
    throw new TypeError("metadata must be 'safe', 'all', or 'none'");
  const quantizer = new wasm.ImageQuantizer();
  try {
    if (options.speed !== undefined) quantizer.setSpeed(options.speed);
    if (options.quality !== undefined) {
      const { min = 0, target = 100 } = options.quality;
      quantizer.setQuality(min, target);
    }
    if (options.maxColors !== undefined) quantizer.setMaxColors(options.maxColors);
    if (options.posterization !== undefined) quantizer.setPosterization(options.posterization);
    return run(quantizer);
  } finally {
    quantizer.free();
  }
}

function quantizeRgbaData(
  wasm: WasmModule,
  quantizer: Quantizer,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  dithering?: number,
): QuantizationResult {
  const result = quantizer.quantizeImage(rgba, width, height);
  try {
    const quality = result.getQuantizationQuality();
    if (dithering !== undefined) result.setDithering(dithering);
    const indices = result.getPaletteIndices(rgba, width, height);
    // Remapping refines colors; use the final palette for these indices.
    const palette = result.getPalette();
    const remapped = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < indices.length; i++) {
      const color = palette[indices[i]];
      const offset = i * 4;
      remapped[offset] = color[0];
      remapped[offset + 1] = color[1];
      remapped[offset + 2] = color[2];
      remapped[offset + 3] = color[3];
    }
    return {
      palette,
      pngBytes: wasm.encode_palette_to_png(indices, palette, width, height),
      imageData: { data: remapped, width, height },
      quality,
      paletteLength: palette.length,
      width,
      height,
    };
  } finally {
    result.free();
  }
}

/** The first animation frame and still preview may share a buffer. Transfer it once. */
export function transferResultBuffers(result: QuantizationResult): ArrayBuffer[] {
  const buffers = [result.pngBytes.buffer, result.imageData.data.buffer];
  for (const frame of result.animation?.frames ?? [])
    if (frame.imageData) buffers.push(frame.imageData.data.buffer);
  return [...new Set(buffers)];
}
