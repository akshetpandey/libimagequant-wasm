declare const LibImageQuant: typeof import('./node.js', { with: { 'resolution-mode': 'import' } }).default;
declare namespace LibImageQuant {
  type QuantizationOptions = import('./node.js', { with: { 'resolution-mode': 'import' } }).QuantizationOptions;
  type QuantizationResult = import('./node.js', { with: { 'resolution-mode': 'import' } }).QuantizationResult;
  type LibImageQuantOptions = import('./node.js', { with: { 'resolution-mode': 'import' } }).LibImageQuantOptions;
  type RgbaImageData = import('./node.js', { with: { 'resolution-mode': 'import' } }).RgbaImageData;
  type RgbaImageInput = import('./node.js', { with: { 'resolution-mode': 'import' } }).RgbaImageInput;
}
export = LibImageQuant;
