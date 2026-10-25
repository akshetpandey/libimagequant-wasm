/** Browser API; Node applications should import libimagequant-wasm/node. */
// oxlint-disable-next-line import/default -- Vite provides this virtual module's worker constructor.
import DefaultWorker from './worker?worker&inline';
import QuantizerClient, { type WorkerTransport } from './client.js';
import type { LibImageQuantOptions, QuantizationResult as Result } from './types.js';

export type {
  QuantizationOptions,
  LibImageQuantOptions,
  RgbaImageData,
  RgbaImageInput,
} from './types.js';
export type QuantizationResult = Result<ImageData>;

export default class LibImageQuant extends QuantizerClient<ImageData> {
  constructor(options: LibImageQuantOptions = {}) {
    let wasmUrl = options.wasmUrl;
    const documentUrl = globalThis.document?.baseURI ?? globalThis.location?.href;
    const workerUrl = options.workerUrl ? new URL(options.workerUrl, documentUrl).href : undefined;
    if (wasmUrl) {
      const worker = workerUrl && new URL(workerUrl);
      const base =
        worker && ['http:', 'https:'].includes(worker.protocol) ? worker.href : documentUrl;
      wasmUrl = new URL(wasmUrl, base).href;
    }
    super({ ...options, wasmUrl }, () => {
      const worker = workerUrl ? new Worker(workerUrl, { type: 'module' }) : new DefaultWorker();
      const transport: WorkerTransport = {
        onmessage: null,
        onerror: null,
        postMessage: (message, transfer = []) => worker.postMessage(message, transfer),
        terminate: () => {
          worker.onmessage = null;
          worker.onerror = null;
          worker.onmessageerror = null;
          worker.terminate();
        },
      };
      worker.onmessage = (event) => transport.onmessage?.({ data: event.data });
      worker.onerror = (error) => transport.onerror?.(error);
      worker.onmessageerror = (event) =>
        transport.onerror?.({
          message: 'Could not deserialize worker response',
          preventDefault: () => event.preventDefault(),
        });
      return transport;
    });
  }
}
