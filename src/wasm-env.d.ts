/// <reference lib="esnext.disposable" />
// Module-local compatibility types for wasm-bindgen's web-target declarations.
// Keep browser-native types when present without adding globals to Node projects.
export {};
type RequestInfo = Request | string;
type BufferSource = ArrayBuffer | ArrayBufferView<ArrayBuffer>;
type NativeWasmInstance<Name extends string, Fallback> = typeof globalThis extends {
  WebAssembly: Record<Name, abstract new (...args: any[]) => infer Instance>;
} ? Instance : Fallback;
declare namespace WebAssembly {
  type Module = NativeWasmInstance<'Module', object>;
  type Memory = NativeWasmInstance<'Memory', {
    readonly buffer: ArrayBuffer;
    grow(delta: number): number;
  }>;
  type Table = NativeWasmInstance<'Table', {
    readonly length: number;
    get(index: number): any;
    grow(delta: number, value?: any): number;
    set(index: number, value?: any): void;
  }>;
}
