# libimagequant-wasm

A TypeScript/JavaScript WebAssembly wrapper for the [libimagequant](https://github.com/ImageOptim/libimagequant) image quantization library. This package provides high-quality image color quantization in the browser using Web Workers for optimal performance.

## Features

- **High-quality image quantization** - Convert 24/32-bit images to 8-bit palette with alpha channel
- **Web Worker support** - Non-blocking image processing using Web Workers
- **Node.js support** - Separate worker-thread API with Buffer and raw RGBA inputs
- **TypeScript support** - Full TypeScript definitions included
- **Promise-based API** - Modern, easy-to-use async interface
- **Optimized WASM** - Size and performance optimized WebAssembly build
- **Browser compatible** - Works in all modern browsers supporting WebAssembly
- **Multiple formats** - Supports ESM and CommonJS

## Installation

```bash
pnpm add libimagequant-wasm
```

### Requirements

- Modern browser with WebAssembly and Web Worker support

## Quick Start

### Quantize a PNG

```typescript
import LibImageQuant from 'libimagequant-wasm';

const quantizer = new LibImageQuant();

// Fetch a PNG and quantize it
const response = await fetch('image.png');
const pngData = new Uint8Array(await response.arrayBuffer());

const result = await quantizer.quantizePng(pngData, {
  maxColors: 64,
  quality: { min: 0, target: 100 },
  speed: 3,
});

console.log(`Quantized to ${result.paletteLength} colors`);
console.log(`Quality: ${Math.round(result.quality * 100)}%`);

// result.pngBytes - quantized indexed PNG as Uint8Array
// result.imageData - quantized image as ImageData (for canvas rendering)

quantizer.dispose();
```

### Quantize from Canvas

```typescript
import LibImageQuant from 'libimagequant-wasm';

const quantizer = new LibImageQuant();

const canvas = document.getElementById('myCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

const result = await quantizer.quantizeImageData(imageData, {
  maxColors: 32,
  speed: 1,
  dithering: 0.8,
});

// Draw quantized result back to canvas
ctx.putImageData(result.imageData, 0, 0);

quantizer.dispose();
```

### Input Formats

`quantizePng` accepts multiple input types:

```typescript
// Uint8Array
const result = await quantizer.quantizePng(pngBytes);

// ArrayBuffer
const result = await quantizer.quantizePng(arrayBuffer);

// Blob
const result = await quantizer.quantizePng(blob);
```

## API Reference

### Node.js

Node.js 24+ applications can use the separate worker-thread entry point. It runs
the same WASM quantizer without browser globals or extra runtime dependencies:

```typescript
import LibImageQuant from 'libimagequant-wasm/node';
import { readFile, writeFile } from 'node:fs/promises';

const quantizer = new LibImageQuant();
try {
  const result = await quantizer.quantizePng(await readFile('input.png'), { maxColors: 64 });
  await writeFile('output.png', result.pngBytes);
  // result.imageData is { data: Uint8ClampedArray, width, height } in Node.
} finally {
  quantizer.dispose(); // terminate the worker thread
}
```

CommonJS: `const LibImageQuant = require('libimagequant-wasm/node')`.
`quantizePng` accepts `Buffer`, `Uint8Array`, `ArrayBuffer`, and `Blob` inputs.
`quantizeImageData` accepts `{ data: Uint8Array | Uint8ClampedArray, width, height }`
(including a `Buffer` as `data`) for raw
RGBA input. The Node constructor accepts `initTimeout` and `operationTimeout`;
worker and WASM assets are resolved from the installed package. Its prebuilt
worker does not inherit application-specific CLI loaders or flags. Dispose of
each instance when finished, and reuse it for multiple requests.

For server bundles, keep `libimagequant-wasm` external so its worker remains next
to the installed Node entry. If you bundle or relocate the library, copy the file
exported as `libimagequant-wasm/node-worker` and set `workerUrl` to its absolute
`file:` URL. For example, an unbundled application can obtain that URL with
`new URL(import.meta.resolve('libimagequant-wasm/node-worker'))`; CommonJS can use
`pathToFileURL(require.resolve('libimagequant-wasm/node-worker'))` from `node:url`.

### LibImageQuant

#### Constructor

```typescript
const quantizer = new LibImageQuant(options?: LibImageQuantOptions);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `workerUrl` | `string` | auto-detected | Custom path to the worker module |
| `wasmUrl` | `string` | auto-detected | Custom path to the WASM module directory |
| `initTimeout` | `number` | `10000` | Worker initialization timeout (ms) |
| `operationTimeout` | `number` | `30000` | Per-operation timeout (ms) |

#### Methods

##### `quantizePng(pngData, options?)`

Quantizes a PNG image from binary data.

- `pngData`: `Uint8Array | ArrayBuffer | Blob` - PNG file bytes
- `options`: `QuantizationOptions` (optional)
- Returns: `Promise<QuantizationResult>`

##### `quantizeImageData(imageData, options?)`

Quantizes an `ImageData` object (e.g. from canvas) or raw RGBA byte data.

- `imageData`: `ImageData | RgbaImageInput` - RGBA image data
- `options`: `QuantizationOptions` (optional)
- Returns: `Promise<QuantizationResult>`

##### `dispose()`

Terminates the worker, rejects any pending operations, and releases resources. Safe to call multiple times.

Inputs are copied before transfer to the worker; the library never detaches your
buffers. Blob reading also runs in the worker and is covered by operation timeout
and disposal. Output byte arrays are independently owned by each result.

### QuantizationOptions

```typescript
{
  speed?: number;          // Speed vs quality (1-10, lower = better quality)
  quality?: {
    min: number;           // Minimum acceptable quality (0-100)
    target: number;        // Target quality (0-100)
  };
  maxColors?: number;      // Maximum colors in palette (2-256)
  dithering?: number;      // Dithering level (0.0-1.0)
  posterization?: number;  // Posterization level (0-4)
}
```

### QuantizationResult

```typescript
{
  palette: number[][];     // Color palette as [[r,g,b,a], ...]
  pngBytes: Uint8Array;    // Quantized indexed PNG file bytes
  imageData: ImageData;    // Quantized RGBA image data (for canvas)
  quality: number;         // Achieved quality (0.0-1.0)
  paletteLength: number;   // Number of colors in palette
  width: number;           // Image width in pixels
  height: number;          // Image height in pixels
}
```

## Build from Source

### Prerequisites

- [Rust](https://rustup.rs/) with the `wasm32-unknown-unknown` target
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) 0.15.0 or newer
- Node.js 24 LTS (^24.22.1; see `.node-version` and `devEngines.runtime` in `package.json`)
- [pnpm](https://pnpm.io/installation) 12.15.0 (pinned in `package.json`)
- [wasm-opt](https://github.com/WebAssembly/binaryen) (optional, for WASM size optimization)

### Setup

```bash
# Install Rust and wasm-pack
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install wasm-pack --locked --version 0.15.0
rustup target add wasm32-unknown-unknown

# Install dependencies
pnpm install --frozen-lockfile

# Install the test browser
pnpm exec playwright install chromium

# Build
pnpm build
```

### Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Full build (WASM + TypeScript + types) |
| `pnpm build:wasm` | Build WASM module only |
| `pnpm build:types` | Generate TypeScript declarations only |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm test` | Run tests (Vitest + headless Chromium; build first) |
| `pnpm test:package` | Validate built package files |
| `pnpm test:integration` | Run built-artifact and package-consumer regressions |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm dev` | Start Vite dev server |
| `pnpm clean` | Remove build output |

## Testing

Tests run in a real browser via [Vitest](https://vitest.dev/) with `@vitest/browser` and Playwright. No mocks — the actual WASM module is loaded and executed.

```bash
# Build first (tests run against built output)
pnpm build

# Run tests (headless Chromium)
pnpm test

# Validate package files and check Rust
pnpm test:package
cargo check --locked --target wasm32-unknown-unknown
cargo test --locked
```

The test suite covers:
- **High-level API** - `LibImageQuant` class, all input formats, options, disposal, concurrency, error handling
- **Low-level WASM** - `ImageQuantizer`, `QuantizationResult`, PNG encode/decode, memory management
- **Result validation** - Color accuracy, PNG integrity, transparency roundtrips

## Browser Support

Use a modern browser supporting ES modules, module Web Workers, and WebAssembly.
The published JavaScript targets ES2025. The default embedded worker requires
`blob:` workers and `data:` fetches permitted by Content Security Policy; a
separately hosted worker can be configured with `workerUrl`.

## Performance Tips

1. **Reuse quantizer instances** when processing multiple images
2. **Use appropriate speed settings** - higher speed for real-time, lower for final output
3. **Consider image size** - quantization time scales with pixel count
4. **Call `dispose()`** when done to release the Web Worker

## Examples

See `examples/test.html` for a complete working example with:
- File upload
- Real-time parameter adjustment
- Visual comparison
- Palette display
- Performance metrics

## License

MIT License - See LICENSE file for details.

**Important Note**: This project wraps the libimagequant library, which is dual-licensed under GPL-3.0 and commercial licenses. While this wrapper is MIT licensed, you must ensure you comply with the appropriate libimagequant license for your use case. For commercial use, you may need to obtain a commercial license from the libimagequant authors.

## Contributing

See [AGENTS.md](AGENTS.md) for repository guidance shared by all coding agents.

1. Fork the repository
2. Create your feature branch
3. Build: `pnpm build`
4. Test: `pnpm test`
5. Submit a pull request

## Troubleshooting

### Worker Loading Issues
Ensure the worker module is served from the same origin, or pass a custom `workerUrl` to the constructor.

### WASM Loading Issues
- Verify WebAssembly support: `typeof WebAssembly === 'object'`
- Check browser console for loading errors
- Ensure proper MIME type for `.wasm` files (`application/wasm`)
- Pass a custom `wasmUrl` if the WASM files are hosted separately

`wasmUrl` names the directory containing both `libimagequant_wasm.js` and
`libimagequant_wasm_bg.wasm`. Absolute URLs and paths relative to the worker are
supported. For example, `{ workerUrl: '/workers/worker.mjs', wasmUrl: '/assets/quantizer/' }`.
A URL ending in `.wasm` overrides only the binary and uses the bundled JavaScript
loader. Use a directory override when providing matching external glue and WASM.

The default worker embeds its JavaScript and WASM, so ordinary usage requires no
asset copying. Its Content Security Policy needs `blob:` workers and `data:` fetches
for the embedded WASM, along with permission to compile WebAssembly. Applications
that require separately hosted workers can supply `workerUrl` and `wasmUrl`.
Relative WASM paths resolve against an explicit worker URL, or against the page
URL when using the default embedded worker.

### Performance Issues
- Large images may take significant time to quantize
- Consider resizing images before quantization
- Use higher `speed` settings for real-time applications
