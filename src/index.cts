// Declaration-only facade matching the constructor exported by index.cjs.
declare const LibImageQuant: typeof import('./index.js', { with: { 'resolution-mode': 'import' } }).default;
declare namespace LibImageQuant {
  type QuantizationOptions = import('./index.js', { with: { 'resolution-mode': 'import' } }).QuantizationOptions;
  type QuantizationResult = import('./index.js', { with: { 'resolution-mode': 'import' } }).QuantizationResult;
  type LibImageQuantOptions = import('./index.js', { with: { 'resolution-mode': 'import' } }).LibImageQuantOptions;
  type RgbaImageData = import('./index.js', { with: { 'resolution-mode': 'import' } }).RgbaImageData;
  type RgbaImageInput = import('./index.js', { with: { 'resolution-mode': 'import' } }).RgbaImageInput;
}
export = LibImageQuant;
