import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import QuantizerClient, { type WorkerTransport } from './client.js';
import type { LibImageQuantOptions as ClientOptions, QuantizationResult as Result, RgbaImageData } from './types.js';

export type { QuantizationOptions, RgbaImageData } from './types.js';
export type LibImageQuantOptions = Pick<ClientOptions, 'initTimeout' | 'operationTimeout'>;
export type QuantizationResult = Result<RgbaImageData>;

class ThreadTransport implements WorkerTransport {
  onmessage: WorkerTransport['onmessage'] = null;
  onerror: WorkerTransport['onerror'] = null;
  private closed = false;
  private thread: Worker;

  constructor() {
    // __filename covers the CommonJS build without relying on import.meta there.
    const base = typeof __filename === 'string' ? pathToFileURL(__filename).href : import.meta.url;
    // The bundled worker needs no app loaders or process-specific CLI flags.
    this.thread = new Worker(new URL('./node-worker.mjs', base), { execArgv: [] });
    this.thread.on('message', data => this.onmessage?.({ data }));
    this.thread.on('error', error => this.fail(error));
    this.thread.on('exit', code => this.fail(new Error(`Quantization worker exited (${code})`)));
  }

  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    this.onerror?.({ message: error.message, preventDefault() {} });
  }

  postMessage(message: unknown) { this.thread.postMessage(message); }
  terminate() { this.closed = true; return this.thread.terminate(); }
}

/** Node API backed by a worker thread. Results contain DOM-free RGBA pixel data. */
export default class LibImageQuant extends QuantizerClient<RgbaImageData> {
  constructor(options: LibImageQuantOptions = {}) {
    super(options, () => new ThreadTransport());
  }
}
