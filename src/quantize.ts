import type { QuantizationOptions } from './types.js';
type WasmModule = typeof import('virtual:libimagequant-wasm');

export interface PngQuantizationData {
  pngBytes: number[];
  options?: QuantizationOptions;
}

export interface ImageDataQuantizationData {
  imageData: number[];
  width: number;
  height: number;
  options?: QuantizationOptions;
}

export async function quantizePng(wasmModule: WasmModule, data: PngQuantizationData) {
  const { pngBytes, options = {} } = data;

  // Convert PNG bytes to Uint8Array
  const pngData = new Uint8Array(pngBytes);

  // Decode PNG to RGBA
  const decodedResult = wasmModule.decode_png_to_rgba(pngData);
  const rgbaData = decodedResult[0]; // Uint8ClampedArray
  const width = decodedResult[1];
  const height = decodedResult[2];

  return await quantizeRgbaData(wasmModule, rgbaData, width, height, options);
}

export async function quantizeImageData(wasmModule: WasmModule, data: ImageDataQuantizationData) {
  const { imageData, width, height, options = {} } = data;

  // Convert to Uint8ClampedArray
  const rgbaData = new Uint8ClampedArray(imageData);

  return await quantizeRgbaData(wasmModule, rgbaData, width, height, options);
}

async function quantizeRgbaData(
  wasmModule: WasmModule,
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number,
  options: QuantizationOptions
) {
  // Create quantizer instance
  const quantizer = new wasmModule.ImageQuantizer();

  try {
    // Apply options
    if (options.speed !== undefined) {
      quantizer.setSpeed(options.speed);
    }

    if (options.quality !== undefined) {
      const { min = 0, target = 100 } = options.quality;
      quantizer.setQuality(min, target);
    }

    if (options.maxColors !== undefined) {
      quantizer.setMaxColors(options.maxColors);
    }

    if (options.posterization !== undefined) {
      quantizer.setPosterization(options.posterization);
    }

    // Quantize the image
    const quantResult = quantizer.quantizeImage(rgbaData, width, height);

    try {
      // Extract results
      const quality = quantResult.getQuantizationQuality();

      // Set dithering if specified
      if (options.dithering !== undefined) {
        quantResult.setDithering(options.dithering);
      }

      // Get palette indices (single remap operation)
      const paletteIndices = quantResult.getPaletteIndices(rgbaData, width, height);
      // Remapping refines the colors; its indices refer to this final palette.
      const palette = quantResult.getPalette();
      const paletteLength = palette.length;

      // Reconstruct RGBA data from palette + indices (avoids a second remap)
      const pixelCount = width * height;
      const remappedData = new Uint8ClampedArray(pixelCount * 4);
      for (let i = 0; i < pixelCount; i++) {
        const color = palette[paletteIndices[i]];
        const offset = i * 4;
        remappedData[offset] = color[0];
        remappedData[offset + 1] = color[1];
        remappedData[offset + 2] = color[2];
        remappedData[offset + 3] = color[3];
      }

      // Generate indexed PNG
      const pngBytes = wasmModule.encode_palette_to_png(
        paletteIndices,
        palette,
        width,
        height
      );

      // Generate ImageData
      const imageData = { data: remappedData, width, height };

      return {
        palette,
        pngBytes,
        imageData,
        quality,
        paletteLength,
        width,
        height,
      };
    } finally {
      quantResult.free();
    }
  } finally {
    quantizer.free();
  }
}

