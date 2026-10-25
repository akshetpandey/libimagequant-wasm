/// <reference types="vite/client" />

declare module 'virtual:libimagequant-wasm' {
  export default function initialize(input?: unknown): Promise<unknown>;
  export const ImageQuantizer: any;
  export function decode_png_to_rgba(
    bytes: Uint8Array,
  ): [Uint8ClampedArray<ArrayBuffer>, number, number];
  export function encode_palette_to_png(
    indices: Uint8Array,
    palette: number[][],
    width: number,
    height: number,
  ): Uint8Array<ArrayBuffer>;
}
