/** Browser API; Node applications should import libimagequant-wasm/node. */
import DefaultWorker from './worker?worker&inline';
import QuantizerClient, { type WorkerTransport } from './client.js';
import type { LibImageQuantOptions, QuantizationResult as Result } from './types.js';

export type { QuantizationOptions, LibImageQuantOptions, RgbaImageData } from './types.js';
export type QuantizationResult = Result<ImageData>;

export default class LibImageQuant extends QuantizerClient<ImageData> {
  constructor(options: LibImageQuantOptions = {}) {
    let wasmUrl = options.wasmUrl;
    if (wasmUrl) {
      const pageUrl = globalThis.location.href;
      const workerUrl = new URL(options.workerUrl || pageUrl, pageUrl);
      const base = ['http:', 'https:'].includes(workerUrl.protocol) ? workerUrl.href : pageUrl;
      wasmUrl = new URL(wasmUrl, base).href;
    }
    super({ ...options, wasmUrl }, () => {
      const worker = options.workerUrl ? new Worker(options.workerUrl, { type: 'module' }) : new DefaultWorker();
      const transport: WorkerTransport = {
        onmessage: null, onerror: null,
        postMessage: message => worker.postMessage(message),
        terminate: () => {
          worker.onmessage = null;
          worker.onerror = null;
          worker.terminate();
        },
      };
      worker.onmessage = event => transport.onmessage?.({ data: event.data });
      worker.onerror = error => transport.onerror?.(error);
      return transport;
    });
  }
}
