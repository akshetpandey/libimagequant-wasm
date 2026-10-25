import { loadWasm } from './wasm.js';
import { quantizePng, quantizeImageData, type PngQuantizationData, type ImageDataQuantizationData } from './quantize.js';

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

let customWasmUrl: string | undefined;

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
    const wasmModule = await loadWasm(customWasmUrl);

    let result;

    switch (action) {
      case "quantize_png":
        result = await quantizePng(wasmModule, data);
        break;
      case "quantize_imagedata":
        result = await quantizeImageData(wasmModule, data);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    result.imageData = new ImageData(result.imageData.data, result.width, result.height);

    // Send success response
    self.postMessage({
      id,
      success: true,
      result,
    }, [result.pngBytes.buffer, result.imageData.data.buffer]);
  } catch (error) {
    // Send error response
    self.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Send ready message when worker is loaded
self.postMessage({ type: "ready" });
