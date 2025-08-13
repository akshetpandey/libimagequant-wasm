# libimagequant-wasm

A TypeScript/JavaScript WebAssembly wrapper for the [libimagequant](https://github.com/ImageOptim/libimagequant) image quantization library. This package provides high-quality image color quantization in the browser using Web Workers for optimal performance.

## Features

- **🎨 High-quality image quantization** - Convert 24/32-bit images to 8-bit palette with alpha channel
- **⚡ Web Worker support** - Non-blocking image processing using Web Workers
- **📦 TypeScript support** - Full TypeScript definitions included
- **🔄 Promise-based API** - Modern, easy-to-use async interface
- **🧵 Threading support** - Utilizes libimagequant's multi-threading capabilities
- **🚀 Optimized WASM** - Size and performance optimized WebAssembly build
- **🌐 Browser compatible** - Works in all modern browsers supporting WebAssembly
- **📱 Multiple formats** - Supports ESM and CommonJS

## Installation

```bash
npm install libimagequant-wasm
```

### Requirements

- Node.js >= 16.0.0
- Modern browser with WebAssembly and Web Worker support

## Build from Source

1. Install dependencies:
```bash
npm install
```

2. Install Rust and wasm-pack:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
rustup target add wasm32-unknown-unknown
```

3. Build the project:
```bash
npm run build
```

This will:
- Build the WASM module with wasm-pack
- Compile TypeScript to ESM and CommonJS
- Generate TypeScript declarations
- Optimize the output

## Quick Start

### Basic Usage

```typescript
import LibImageQuant, { QuantizationOptions } from 'libimagequant-wasm';

// Create quantizer instance
const quantizer = new LibImageQuant();

// Quantize an image from canvas
const canvas = document.getElementById('myCanvas') as HTMLCanvasElement;
const options: QuantizationOptions = {
    maxColors: 64,
    quality: { min: 70, target: 100 },
    speed: 3
};

const result = await quantizer.quantizeCanvas(canvas, options);

console.log(`Quantized to ${result.paletteLength} colors`);
console.log(`Quality: ${Math.round(result.quality * 100)}%`);

// Apply result to another canvas
const outputCanvas = document.getElementById('outputCanvas') as HTMLCanvasElement;
quantizer.applyToCanvas(outputCanvas, result);

// Clean up
quantizer.dispose();
```

### Convenience Functions

```javascript
import { quantizeCanvas, quantizeImage } from 'libimagequant-wasm';

// One-shot quantization (automatically handles worker lifecycle)
const result = await quantizeCanvas(canvas, { maxColors: 128 });

// Quantize from image element
const img = document.getElementById('myImage');
const result = await quantizeImage(img, { 
    maxColors: 64,
    dithering: 0.8 
});
```

### Working with ImageData

```javascript
import LibImageQuant from 'libimagequant-wasm';

const quantizer = new LibImageQuant();

// Get ImageData from canvas
const ctx = canvas.getContext('2d');
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

// Quantize
const result = await quantizer.quantizeImageData(imageData, {
    maxColors: 32,
    speed: 1, // Slower but higher quality
    quality: { min: 80, target: 100 }
});

// Convert back to ImageData
const quantizedImageData = quantizer.toImageData(result);
ctx.putImageData(quantizedImageData, 0, 0);

quantizer.dispose();
```

## API Reference

### LibImageQuant Class

#### Constructor
```javascript
const quantizer = new LibImageQuant(options)
```

Options:
- `workerUrl` (string): Custom path to worker.js file

#### Methods

**quantizeCanvas(canvas, options)**
- Quantizes image from HTMLCanvasElement
- Returns: Promise<QuantizationResult>

**quantizeImage(image, options)**
- Quantizes image from HTMLImageElement
- Returns: Promise<QuantizationResult>

**quantizeImageData(imageData, options)**
- Quantizes ImageData object
- Returns: Promise<QuantizationResult>

**applyToCanvas(canvas, result)**
- Applies quantization result to canvas

**toImageData(result)**
- Converts result to ImageData object

**dispose()**
- Terminates worker and cleans up resources

### Quantization Options

```javascript
const options = {
    maxColors: 256,        // Maximum colors in palette (2-256)
    speed: 3,              // Speed vs quality (1-10, lower = better quality)
    quality: {             // Quality settings
        min: 0,            // Minimum quality (0-100)
        target: 100        // Target quality (0-100)
    },
    dithering: 1.0,        // Dithering level (0.0-1.0)
    posterization: 0       // Posterization level (0-4)
};
```

### QuantizationResult

```javascript
{
    palette: [[r, g, b, a], ...],  // Color palette array
    indexedData: [index, ...],      // Palette indices for each pixel
    imageData: [r, g, b, a, ...],   // RGBA data (if returnRgba !== false)
    quality: 0.95,                  // Achieved quality (0-1)
    paletteLength: 64,              // Number of colors in palette
    width: 400,                     // Image width
    height: 300                     // Image height
}
```

## Browser Support

- Chrome 57+
- Firefox 52+
- Safari 11+
- Edge 16+

Requires WebAssembly and Web Worker support.

## Performance Tips

1. **Reuse quantizer instances** when processing multiple images
2. **Use appropriate speed settings** - higher speed for real-time, lower for final output
3. **Batch process** similar images with the same settings
4. **Consider image size** - quantization time scales with pixel count

## Examples

See `test.html` for a complete working example with:
- File upload
- Real-time parameter adjustment
- Visual comparison
- Palette display
- Performance metrics

## License

MIT License - See LICENSE file for details.

**Important Note**: This project wraps the libimagequant library, which is dual-licensed under GPL-3.0 and commercial licenses. While this wrapper is MIT licensed, you must ensure you comply with the appropriate libimagequant license for your use case. For commercial use, you may need to obtain a commercial license from the libimagequant authors.

## Contributing

1. Fork the repository
2. Create your feature branch
3. Test your changes with `npm test`
4. Submit a pull request

## Troubleshooting

### Worker Loading Issues
Ensure `worker.js` is served from the same origin or configure CORS headers.

### WASM Loading Issues
- Verify WebAssembly support: `typeof WebAssembly === 'object'`
- Check browser console for loading errors
- Ensure proper MIME type for .wasm files

### Performance Issues
- Large images may take significant time to quantize
- Consider resizing images before quantization
- Use higher speed settings for real-time applications

## Changelog

### 0.1.0
- Initial release
- Basic quantization functionality
- Web Worker support
- Promise-based API