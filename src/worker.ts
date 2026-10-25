// Web Worker for libimagequant WASM module
// Import will be done dynamically at runtime

import type { QuantizationOptions } from ".";
import initializeBundledWasm, * as bundledWasm from 'virtual:libimagequant-wasm';


type WorkerMessage = {
  id: number;
  action: 'quantize_png';
  data: PngQuantizationData;
} | {
  id: number;
  action: 'quantize_imagedata';
  data: ImageDataQuantizationData;

}

interface ConfigureMessage {
  type: "configure";
  wasmUrl: string;
}

interface PngQuantizationData {
  pngBytes: number[];
  options?: QuantizationOptions;
}

interface ImageDataQuantizationData {
  imageData: number[];
  width: number;
  height: number;
  options?: QuantizationOptions;
}

let isInitialized: boolean = false;
let initialization: Promise<boolean> | undefined;
let wasmModule: any = null;
let customWasmUrl: string | undefined = undefined;

// Initialize WASM module
async function initializeWasm(): Promise<boolean> {
  if (isInitialized) return true;
  if (!initialization) initialization = (async () => {
    if (!customWasmUrl) {
      await initializeBundledWasm();
      wasmModule = bundledWasm;
      isInitialized = true;
      return true;
    }
    // Initialize the WASM module
    const binaryOverride = customWasmUrl && /\.wasm(?:[?#]|$)/i.test(customWasmUrl);
    const directory = new URL(customWasmUrl && !binaryOverride
      ? customWasmUrl.replace(/\/?$/, '/') : './wasm/', import.meta.url);
    const wasmLoaderPath = new URL('libimagequant_wasm.js', directory).href;
    wasmModule = await import(wasmLoaderPath);
    const binary = binaryOverride ? new URL(customWasmUrl!, import.meta.url).href
      : new URL('libimagequant_wasm_bg.wasm', directory).href;
    await wasmModule.default({ module_or_path: binary });
    isInitialized = true;
    return true;
  })().catch(error => {
    // A failed load can be retried after correcting the asset configuration.
    initialization = undefined;
    throw error;
  });
  return initialization;
}

// Message handler for worker
self.onmessage = async function (
  e: MessageEvent<WorkerMessage | ConfigureMessage>
) {
  const message = e.data;

  // Handle configuration message
  if ("type" in message && message.type === "configure") {
    customWasmUrl = message.wasmUrl;
    return;
  }

  // Handle regular operation messages
  const { id, action, data } = message as WorkerMessage;

  try {
    // Ensure WASM is initialized
    await initializeWasm();

    let result;

    switch (action) {
      case "quantize_png":
        result = await quantizePng(data);
        break;
      case "quantize_imagedata":
        result = await quantizeImageData(data);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // Send success response
    self.postMessage({
      id,
      success: true,
      result,
    });
  } catch (error) {
    // Send error response
    self.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

async function quantizePng(data: PngQuantizationData) {
  const { pngBytes, options = {} } = data;

  // Convert PNG bytes to Uint8Array
  const pngData = new Uint8Array(pngBytes);

  // Decode PNG to RGBA
  const decodedResult = wasmModule.decode_png_to_rgba(pngData);
  const rgbaData = decodedResult[0]; // Uint8ClampedArray
  const width = decodedResult[1];
  const height = decodedResult[2];

  return await quantizeRgbaData(rgbaData, width, height, options);
}

async function quantizeImageData(data: ImageDataQuantizationData) {
  const { imageData, width, height, options = {} } = data;

  // Convert to Uint8ClampedArray
  const rgbaData = new Uint8ClampedArray(imageData);

  return await quantizeRgbaData(rgbaData, width, height, options);
}

async function quantizeRgbaData(
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
      const imageData = new ImageData(remappedData, width, height);

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

// Send ready message when worker is loaded
self.postMessage({ type: "ready" });
