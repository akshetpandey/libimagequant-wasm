import initializeBundledWasm, * as bundledWasm from 'virtual:libimagequant-wasm';

let isInitialized = false;
let wasmModule: typeof bundledWasm;
let initialization: Promise<typeof bundledWasm> | undefined;

// Initialize WASM module
export async function loadWasm(customWasmUrl?: string): Promise<typeof bundledWasm> {
  if (isInitialized) return wasmModule;
  if (!initialization) initialization = (async () => {
    if (!customWasmUrl) {
      await initializeBundledWasm();
      wasmModule = bundledWasm;
      isInitialized = true;
      return wasmModule;
    }
    // Initialize the WASM module
    if (/\.wasm(?:[?#]|$)/i.test(customWasmUrl)) {
      await initializeBundledWasm({ module_or_path: new URL(customWasmUrl, import.meta.url).href });
      wasmModule = bundledWasm;
      isInitialized = true;
      return wasmModule;
    }
    const directory = new URL(customWasmUrl.replace(/\/?$/, '/'), import.meta.url);
    const wasmLoaderPath = new URL('libimagequant_wasm.js', directory).href;
    wasmModule = await import(wasmLoaderPath);
    const binary = new URL('libimagequant_wasm_bg.wasm', directory).href;
    await wasmModule.default({ module_or_path: binary });
    isInitialized = true;
    return wasmModule;
  })().catch(error => {
    // A failed load can be retried after correcting the asset configuration.
    initialization = undefined;
    throw error;
  });
  return initialization;
}

