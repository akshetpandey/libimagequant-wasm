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
    const directory = new URL(customWasmUrl, import.meta.url);
    if (directory.pathname.toLowerCase().endsWith('.wasm')) {
      await initializeBundledWasm({ module_or_path: directory.href });
      wasmModule = bundledWasm;
      isInitialized = true;
      return wasmModule;
    }
    if (!directory.pathname.endsWith('/')) directory.pathname += '/';
    const loader = new URL('libimagequant_wasm.js', directory);
    const binary = new URL('libimagequant_wasm_bg.wasm', directory);
    loader.search = binary.search = directory.search;
    wasmModule = await import(loader.href);
    await wasmModule.default({ module_or_path: binary.href });
    isInitialized = true;
    return wasmModule;
  })().catch(error => {
    // A failed load can be retried after correcting the asset configuration.
    initialization = undefined;
    throw error;
  });
  return initialization;
}

