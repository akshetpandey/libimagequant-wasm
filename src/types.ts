export interface QuantizationOptions {
  /** Speed vs quality trade-off (1-10, lower = better quality) */
  speed?: number;
  /** Quality settings */
  quality?: {
    min: number;
    target: number;
  };
  /** Maximum colors in palette (2-256) */
  maxColors?: number;
  /** Dithering level (0.0-1.0) */
  dithering?: number;
  /** Posterization level (0-4) */
  posterization?: number;
}

/** Raw RGBA input, including Node Buffers and shared-memory byte views. */
export interface RgbaImageInput {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RgbaImageData {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export interface QuantizationResult<T extends RgbaImageData = RgbaImageData> {
  /** Color palette array */
  palette: number[][];
  /** PNG bytes (Uint8Array) - quantized image as indexed PNG */
  pngBytes: Uint8Array<ArrayBuffer>;
  /** Quantized RGBA data; browser results are native ImageData objects. */
  imageData: T;
  /** Achieved quality (0-1) */
  quality: number;
  /** Number of colors in palette */
  paletteLength: number;
  /** Image width */
  width: number;
  /** Image height */
  height: number;
}

export interface LibImageQuantOptions {
  /** Custom path to worker.js file */
  workerUrl?: string;
  /** Custom path to WASM module directory (should contain libimagequant_wasm.js) */
  wasmUrl?: string;
  /** Timeout for worker initialization in milliseconds (default: 10000) */
  initTimeout?: number;
  /** Timeout for individual operations in milliseconds (default: 30000) */
  operationTimeout?: number;
}

