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
  /** Include full composited APNG frame pixels (default: false). */
  includeFrameData?: boolean;
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

/** A complete composited animation frame, with its original APNG delay fraction. */
export interface AnimationFrame<T extends RgbaImageData = RgbaImageData> {
  imageData?: T;
  delayNumerator: number;
  /** A zero denominator means 100, as specified by APNG. */
  delayDenominator: number;
  durationMs: number;
}

export interface QuantizedAnimation<T extends RgbaImageData = RgbaImageData> {
  /** Number of plays; zero means infinite looping. */
  numPlays: number;
  /** False when imageData is a separate static fallback, outside the animation. */
  defaultImageIsFrame: boolean;
  frames: AnimationFrame<T>[];
}

export interface QuantizationResult<T extends RgbaImageData = RgbaImageData> {
  /** Color palette array */
  palette: number[][];
  /** Indexed PNG bytes; APNG inputs retain animation in the encoded output. */
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
  /** Present for APNG input, including one-frame animations. */
  animation?: QuantizedAnimation<T>;
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
