import { parentPort } from 'node:worker_threads';
import { loadWasm } from './wasm.js';
import { quantizePng, quantizeImageData, type PngQuantizationData, type ImageDataQuantizationData } from './quantize.js';

type Request = { id: number; action: 'quantize_png'; data: PngQuantizationData }
  | { id: number; action: 'quantize_imagedata'; data: ImageDataQuantizationData };

const port = parentPort;
if (!port) throw new Error('The Node worker must run in a worker thread');
port.on('message', async (message: Request) => {
  const id = message?.id;
  try {
    if (!message || typeof message !== 'object' || !Number.isSafeInteger(id) || !message.data) {
      throw new Error('Invalid quantization request');
    }
    const wasm = await loadWasm();
    let result;
    if (message.action === 'quantize_png') result = await quantizePng(wasm, message.data);
    else if (message.action === 'quantize_imagedata') result = await quantizeImageData(wasm, message.data);
    else throw new Error('Unknown quantization action');
    port.postMessage({ id, success: true, result }, [result.pngBytes.buffer, result.imageData.data.buffer]);
  } catch (error) {
    port.postMessage({ id, success: false, error: error instanceof Error ? error.message : String(error) });
  }
});
port.postMessage({ type: 'ready' });
