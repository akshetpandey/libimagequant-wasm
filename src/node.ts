import { Worker } from 'node:worker_threads';
import QuantizerClient, { type WorkerTransport } from './client.js';
import type {
  LibImageQuantOptions as ClientOptions,
  QuantizationResult as Result,
  RgbaImageData,
  AnimationFrame as Frame,
  QuantizedAnimation as Animation,
} from './types.js';

export type { QuantizationOptions, RgbaImageData, RgbaImageInput } from './types.js';
export type LibImageQuantOptions = Pick<ClientOptions, 'initTimeout' | 'operationTimeout'> & {
  /** Override the worker location when bundling or relocating the Node entry. */
  workerUrl?: URL;
  /** Worker environment; defaults to a copy of process.env, including NODE_OPTIONS. */
  workerEnv?: Record<string, string | undefined>;
};
export type QuantizationResult = Result<RgbaImageData>;
export type AnimationFrame = Frame<RgbaImageData>;
export type QuantizedAnimation = Animation<RgbaImageData>;

class ThreadTransport implements WorkerTransport {
  onmessage: WorkerTransport['onmessage'] = null;
  onerror: WorkerTransport['onerror'] = null;
  private closed = false;
  private thread: Worker;

  constructor(workerUrl?: URL, env?: Record<string, string | undefined>) {
    // The Node-platform build preserves this in ESM and supplies the correct
    // __filename-based URL in CommonJS, without consulting application globals.
    const base = import.meta.url;
    // The bundled worker needs no app loaders or process-specific CLI flags.
    this.thread = new Worker(workerUrl ?? new URL('./node-worker.mjs', base), {
      execArgv: [],
      env,
    });
    this.thread.on('message', (data) => this.onmessage?.({ data }));
    this.thread.on('error', (error) => this.fail(error));
    this.thread.on('messageerror', (error) => this.fail(error));
    this.thread.on('exit', (code) => this.fail(new Error(`Quantization worker exited (${code})`)));
  }

  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    this.onerror?.({ message: error.message, preventDefault() {} });
  }

  postMessage(message: unknown, transfer: ArrayBuffer[] = []) {
    this.thread.postMessage(message, transfer);
  }
  terminate() {
    this.closed = true;
    return this.thread.terminate();
  }
}

/** Node API backed by a worker thread. Results contain DOM-free RGBA pixel data. */
export default class LibImageQuant extends QuantizerClient<RgbaImageData> {
  constructor(options: LibImageQuantOptions = {}) {
    super(
      { initTimeout: options.initTimeout, operationTimeout: options.operationTimeout },
      () => new ThreadTransport(options.workerUrl, options.workerEnv),
    );
  }
}
