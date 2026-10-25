// Declaration-only facade matching the constructor exported by index.cjs.
declare const LibImageQuant: typeof import('./index.js', { with: { 'resolution-mode': 'import' } }).default;
declare namespace LibImageQuant {
  type QuantizationOptions = import('./index.js', { with: { 'resolution-mode': 'import' } }).QuantizationOptions;
  type QuantizationResult = import('./index.js', { with: { 'resolution-mode': 'import' } }).QuantizationResult;
  type LibImageQuantOptions = import('./index.js', { with: { 'resolution-mode': 'import' } }).LibImageQuantOptions;
}
export = LibImageQuant;
