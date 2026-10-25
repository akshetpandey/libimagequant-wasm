/**
 * libimagequant WASM - Promise-based API for PNG image quantization in browsers
 *
 * This module provides a high-level, promise-based interface for the libimagequant
 * image quantization library running in a Web Worker with WASM.
 */

import DefaultWorker from './worker?worker&inline';

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

export interface QuantizationResult {
  /** Color palette array */
  palette: number[][];
  /** PNG bytes (Uint8Array) - quantized image as indexed PNG */
  pngBytes: Uint8Array<ArrayBuffer>;
  /** ImageData object - quantized image as RGBA data */
  imageData: ImageData;
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

interface PendingOperation {
  resolve: (value: QuantizationResult) => void;
  reject: (reason?: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export default class LibImageQuant {
  private worker: Worker | null = null;
  private disposed = false;
  private failure?: Error;
  private initTimer?: ReturnType<typeof setTimeout>;
  private rejectInitialization?: (error: Error) => void;
  private isReady: boolean = false;
  private pendingOperations = new Map<number, PendingOperation>();
  private operationCounter: number = 0;
  private workerUrl?: string;
  private wasmUrl?: string;
  private initTimeout: number;
  private operationTimeout: number;
  private initPromise: Promise<void>;

  constructor(options: LibImageQuantOptions = {}) {
    this.workerUrl = options.workerUrl;
    if (options.wasmUrl) {
      const pageUrl = globalThis.location.href;
      const workerUrl = new URL(options.workerUrl || pageUrl, pageUrl);
      const base = ['http:', 'https:'].includes(workerUrl.protocol) ? workerUrl.href : pageUrl;
      this.wasmUrl = new URL(options.wasmUrl, base).href;
    }
    this.initTimeout = options.initTimeout || 10000;
    this.operationTimeout = options.operationTimeout || 30000;
    this.initPromise = this.initialize();
    // Initialization can fail before a caller awaits an operation. Mark it as
    // handled now while preserving the rejected promise for subsequent callers.
    this.initPromise.catch(() => {});
  }

  /**
   * Initialize the worker and WASM module
   */
  private async initialize(): Promise<void> {
    if (this.isReady) return;

    return new Promise((resolve, reject) => {
      this.rejectInitialization = reject;
      try {
        this.worker = this.workerUrl
          ? new Worker(this.workerUrl, { type: 'module' })
          : new DefaultWorker();

        this.initTimer = setTimeout(() => {
          this.shutdown(new Error("Worker initialization timeout"));
        }, this.initTimeout);

        this.worker.onmessage = (e) => {
          const { type, id, success, result, error } = e.data;

          if (type === "ready") {
            if (this.disposed) return;
            // Send WASM URL configuration to worker if provided
            if (this.wasmUrl) {
              this.worker?.postMessage({
                type: "configure",
                wasmUrl: this.wasmUrl,
              });
            }
            this.isReady = true;
            clearTimeout(this.initTimer);
            this.initTimer = undefined;
            this.rejectInitialization = undefined;
            resolve();
            return;
          }

          const operation = this.pendingOperations.get(id);
          if (operation) {
            this.pendingOperations.delete(id);
            clearTimeout(operation.timer);

            if (success) {
              operation.resolve(result);
            } else {
              operation.reject(new Error(error));
            }
          }
        };

        this.worker.onerror = (error) => {
          error.preventDefault();
          this.failure = new Error(`Worker error: ${error.message || 'Worker execution failed'}`);
          this.shutdown(this.failure);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Send a message to the worker and return a promise
   */
  private async sendMessage(action: string, data: Record<string, unknown>): Promise<QuantizationResult> {
    this.assertActive();
    await this.initPromise;
    this.assertActive();

    return new Promise((resolve, reject) => {
      const id = ++this.operationCounter;

      const timer = setTimeout(() => {
        if (this.pendingOperations.has(id)) {
          this.pendingOperations.delete(id);
          reject(new Error("Operation timeout"));
        }
      }, this.operationTimeout);

      this.pendingOperations.set(id, { resolve, reject, timer });

      try {
        this.worker!.postMessage({ id, action, data });
      } catch (error) {
        this.pendingOperations.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Quantize a PNG from bytes or Blob
   */
  async quantizePng(
    pngData: Uint8Array | ArrayBuffer | Blob,
    options: QuantizationOptions = {}
  ): Promise<QuantizationResult> {
    let pngBytes: Uint8Array;

    if (pngData instanceof Blob) {
      const arrayBuffer = await pngData.arrayBuffer();
      pngBytes = new Uint8Array(arrayBuffer);
    } else if (pngData instanceof ArrayBuffer) {
      pngBytes = new Uint8Array(pngData);
    } else {
      pngBytes = pngData;
    }

    return this.sendMessage("quantize_png", {
      pngBytes: Array.from(pngBytes),
      options,
    });
  }

  /**
   * Quantize from ImageData and return as PNG bytes or ImageData
   */
  async quantizeImageData(
    imageData: ImageData,
    options: QuantizationOptions = {}
  ): Promise<QuantizationResult> {
    return this.sendMessage("quantize_imagedata", {
      imageData: Array.from(imageData.data),
      width: imageData.width,
      height: imageData.height,
      options,
    });
  }

  /**
   * Terminate the worker and clean up resources
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.shutdown(new Error("LibImageQuant disposed"));
  }

  private assertActive() {
    if (this.disposed) throw new Error("LibImageQuant disposed");
    if (this.failure) throw this.failure;
  }

  private shutdown(error: Error) {
    clearTimeout(this.initTimer);
    this.initTimer = undefined;
    this.rejectInitialization?.(error);
    this.rejectInitialization = undefined;
    for (const operation of this.pendingOperations.values()) {
      clearTimeout(operation.timer);
      operation.reject(error);
    }
    this.pendingOperations.clear();
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.isReady = false;
  }
}
