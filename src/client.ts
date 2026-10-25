import type { LibImageQuantOptions, QuantizationOptions, QuantizationResult, RgbaImageData, RgbaImageInput } from './types.js';

export interface WorkerTransport {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((error: { message?: string; preventDefault(): void }) => void) | null;
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  terminate(): unknown;
}

interface PendingOperation<T extends RgbaImageData> {
  resolve: (value: QuantizationResult<T>) => void;
  reject: (reason?: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Brand checks keep byte inputs from iframes usable across realms, including
// Buffer subclasses in Node. instanceof alone rejects those browser views.
function isByteView(value: unknown): value is Uint8Array | Uint8ClampedArray {
  return ArrayBuffer.isView(value)
    && ['[object Uint8Array]', '[object Uint8ClampedArray]'].includes(Object.prototype.toString.call(value));
}

function timeout(value: number | undefined, fallback: number, name: string): number {
  const milliseconds = value ?? fallback;
  if (!Number.isInteger(milliseconds) || milliseconds <= 0 || milliseconds > 0x7fffffff) {
    throw new RangeError(`${name} must be an integer between 1 and 2147483647 milliseconds`);
  }
  return milliseconds;
}

export default class QuantizerClient<T extends RgbaImageData> {
  private worker: WorkerTransport | null = null;
  private disposed = false;
  private failure?: Error;
  private initTimer?: ReturnType<typeof setTimeout>;
  private rejectInitialization?: (error: Error) => void;
  private isReady: boolean = false;
  private pendingOperations = new Map<number, PendingOperation<T>>();
  private operationCounter: number = 0;
  private wasmUrl?: string;
  private initTimeout: number;
  private operationTimeout: number;
  private initPromise: Promise<void>;

  constructor(options: LibImageQuantOptions, private workerFactory: () => WorkerTransport) {
    this.wasmUrl = options.wasmUrl;
    this.initTimeout = timeout(options.initTimeout, 10000, 'initTimeout');
    this.operationTimeout = timeout(options.operationTimeout, 30000, 'operationTimeout');
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
        this.worker = this.workerFactory();

        this.initTimer = setTimeout(() => {
          this.shutdown(new Error("Worker initialization timeout"));
        }, this.initTimeout);

        this.worker.onmessage = (e) => {
          if (!e.data || typeof e.data !== 'object') {
            this.shutdown(new Error('Invalid worker response'));
            return;
          }
          const { type, id, success, result, error } = e.data as Record<string, unknown>;

          if (type === "ready") {
            if (this.disposed || this.isReady) return;
            // Send WASM URL configuration to worker if provided
            if (this.wasmUrl) {
              try {
                this.worker?.postMessage({ type: 'configure', wasmUrl: this.wasmUrl });
              } catch (error) {
                this.shutdown(error instanceof Error ? error : new Error(String(error)));
                return;
              }
            }
            this.isReady = true;
            clearTimeout(this.initTimer);
            this.initTimer = undefined;
            this.rejectInitialization = undefined;
            resolve();
            return;
          }

          if (typeof id !== 'number') return;

          const operation = this.pendingOperations.get(id);
          if (operation) {
            if (typeof success !== 'boolean' || (success && (!result || typeof result !== 'object'))) {
              this.shutdown(new Error('Invalid worker response'));
              return;
            }
            this.pendingOperations.delete(id);
            clearTimeout(operation.timer);

            if (success) {
              operation.resolve(result as QuantizationResult<T>);
            } else {
              operation.reject(new Error(typeof error === 'string' ? error : 'Quantization failed'));
            }
          }
        };

        this.worker.onerror = (error) => {
          error.preventDefault();
          this.failure = new Error(`Worker error: ${error.message || 'Worker execution failed'}`);
          this.shutdown(this.failure);
        };
      } catch (error) {
        this.shutdown(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Send a message to the worker and return a promise
   */
  private async sendMessage(action: string, data: Record<string, unknown>, transfer: ArrayBuffer[] = []): Promise<QuantizationResult<T>> {
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
        this.worker!.postMessage({ id, action, data }, transfer);
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
  ): Promise<QuantizationResult<T>> {
    this.assertActive();
    let pngBytes: Uint8Array<ArrayBuffer> | Blob;
    if (Object.prototype.toString.call(pngData) === '[object Blob]') {
      // Blob reading belongs to the worker operation so timeout/disposal also
      // cover asynchronous input preparation. Blobs are immutable and cloneable.
      pngBytes = pngData as Blob;
    } else if (Object.prototype.toString.call(pngData) === '[object ArrayBuffer]') {
      pngBytes = new Uint8Array(new Uint8Array(pngData as ArrayBuffer));
    } else if (isByteView(pngData) && Object.prototype.toString.call(pngData) === '[object Uint8Array]') {
      // Own the transferred bytes without detaching or retaining the caller's
      // Buffer pool, subarray, or shared memory.
      pngBytes = new Uint8Array(pngData);
    } else {
      throw new TypeError('PNG input must be a Uint8Array, ArrayBuffer, or Blob');
    }

    return this.sendMessage("quantize_png", {
      pngBytes,
      options: structuredClone(options),
    }, pngBytes instanceof Uint8Array ? [pngBytes.buffer] : []);
  }

  /**
   * Quantize from ImageData and return as PNG bytes or ImageData
   */
  async quantizeImageData(
    imageData: RgbaImageInput,
    options: QuantizationOptions = {}
  ): Promise<QuantizationResult<T>> {
    this.assertActive();
    if (!imageData || !isByteView(imageData.data)) {
      throw new TypeError('RGBA data must be a Uint8Array or Uint8ClampedArray');
    }
    const length = imageData.width * imageData.height * 4;
    if (!Number.isInteger(imageData.width) || imageData.width <= 0 || imageData.width > 0xffffffff
      || !Number.isInteger(imageData.height) || imageData.height <= 0 || imageData.height > 0xffffffff
      || !Number.isSafeInteger(length) || length !== imageData.data.length) {
      throw new Error('Image data dimensions must be positive integers matching the RGBA byte length');
    }
    if (imageData.width * imageData.height > 16_777_216) {
      throw new Error('Image exceeds the maximum of 16777216 pixels');
    }
    const pixels = new Uint8ClampedArray(imageData.data);
    return this.sendMessage("quantize_imagedata", {
      imageData: pixels,
      width: imageData.width,
      height: imageData.height,
      options: structuredClone(options),
    }, [pixels.buffer]);
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
    this.failure ??= error;
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
