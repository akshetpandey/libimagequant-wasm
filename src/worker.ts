// Web Worker for libimagequant WASM module
// Import will be done dynamically at runtime

import type { QuantizationOptions } from ".";


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
let wasmModule: any = null;
let customWasmUrl: string | null = null;

// Initialize WASM module
async function initializeWasm(): Promise<boolean> {
  if (!isInitialized) {
    // Use custom WASM URL if provided, otherwise use default relative path
    const wasmPath = customWasmUrl
      ? new URL("libimagequant_wasm.js", customWasmUrl).href
      : new URL("./wasm/libimagequant_wasm.js", import.meta.url).href;

    wasmModule = await import(wasmPath);
    await wasmModule.default(); // Initialize the WASM module
    isInitialized = true;
  }
  return true;
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
      error: error instanceof Error ? error.message : "Unknown error occurred",
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
  options: any
) {
  // Create quantizer instance
  const quantizer = new wasmModule.ImageQuantizer();

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

  // Extract results
  const palette = quantResult.getPalette();
  const quality = quantResult.getQuantizationQuality();
  const paletteLength = quantResult.getPaletteLength();

  // Set dithering if specified
  if (options.dithering !== undefined) {
    quantResult.setDithering(options.dithering);
  }

  const remappedRgbaData = quantResult.remapImage(rgbaData, width, height);

  // Get palette indices directly from Rust
  const paletteIndices = quantResult.getPaletteIndices(rgbaData, width, height);

  // Generate indexed PNG
  const pngBytes = wasmModule.encode_palette_to_png(
    paletteIndices,
    palette,
    width,
    height
  );

  // Generate ImageData
  const imageData = new ImageData(remappedRgbaData, width, height);

  return {
    palette,
    pngBytes,
    imageData,
    quality,
    paletteLength,
    width,
    height,
  };
}

// Send ready message when worker is loaded
self.postMessage({ type: "ready" });
