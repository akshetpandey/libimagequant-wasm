# libimagequant-wasm

A TypeScript/JavaScript WebAssembly wrapper for the [libimagequant](https://github.com/ImageOptim/libimagequant) image quantization library. This package provides high-quality image color quantization in browsers and Node.js, using workers to keep processing off the main thread.

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

- **Browser API:** a modern browser with ES2025, WebAssembly, and module Web Worker support.
- **Node API:** Node.js 24 or newer, using the explicit `libimagequant-wasm/node` entry point.

Consumers do not need Rust, wasm-pack, or a particular package manager. The
repository's `devEngines` settings apply to contributors building this package.

## Quick Start

| Environment | Import / require          | Result pixels                                |
| ----------- | ------------------------- | -------------------------------------------- |
| Browser     | `libimagequant-wasm`      | Native `ImageData`                           |
| Node.js 24+ | `libimagequant-wasm/node` | `{ data: Uint8ClampedArray, width, height }` |

The root entry always selects the browser API. Choose `/node` explicitly in
server code. Both entries support ESM and CommonJS and expose the same methods.

### Browser: Quantize a PNG

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
(including a `Buffer` as `data`) for raw RGBA input. The Node constructor accepts
`initTimeout`, `operationTimeout`, an optional `workerUrl`, and `workerEnv`;
worker and WASM assets are resolved from the installed package. Its prebuilt
worker clears CLI `execArgv` flags. It still inherits `NODE_OPTIONS` through its
environment. Dispose of each instance when finished, and reuse it for multiple
requests.

For server bundles, keep `libimagequant-wasm` external so its worker remains next
to the installed Node entry. If you bundle or relocate the library, copy the file
exported as `libimagequant-wasm/node-worker` and set `workerUrl` to its absolute
`file:` URL. For example, an unbundled application can obtain that URL with
`new URL(import.meta.resolve('libimagequant-wasm/node-worker'))`; CommonJS can use
`pathToFileURL(require.resolve('libimagequant-wasm/node-worker'))` from `node:url`.

Application preloads supplied through `NODE_OPTIONS` must support worker threads.
For an app-only preload, override the worker environment explicitly with
`new LibImageQuant({ workerEnv: { ...process.env, NODE_OPTIONS: '' } })`.
`workerEnv` supplies the full worker environment and defaults to a copy of
`process.env`; overrides leave the parent environment unchanged.

## API Reference

### LibImageQuant

#### Constructor

```typescript
const quantizer = new LibImageQuant(options?: LibImageQuantOptions);
```

| Option             | Type                                  | Default               | Description                                       |
| ------------------ | ------------------------------------- | --------------------- | ------------------------------------------------- |
| `workerUrl`        | Browser: `string`; Node: `URL`        | bundled worker        | Browser worker path or absolute Node worker URL   |
| `wasmUrl`          | `string`                              | embedded WASM         | Browser only: custom WASM directory or binary URL |
| `workerEnv`        | `Record<string, string \| undefined>` | copy of `process.env` | Node only: worker environment override            |
| `initTimeout`      | `number`                              | `10000`               | Worker initialization timeout (ms)                |
| `operationTimeout` | `number`                              | `30000`               | Per-operation timeout (ms)                        |

Timeouts must be positive integers at most 2,147,483,647 ms. Initialization covers
worker startup; WASM initialization is lazy and covered by the first operation's
timeout. An operation timeout rejects that request without cancelling computation;
call `dispose()` to terminate the worker and all queued work.

#### Methods

##### `quantizePng(pngData, options?)`

Quantizes a PNG image from binary data. For APNG, only the first decoded image is
processed. The output is a new indexed PNG; source metadata is not preserved.

- `pngData`: `Uint8Array | ArrayBuffer | Blob` - PNG file bytes (`Buffer` also works in Node)
- `options`: `QuantizationOptions` (optional)
- Returns: `Promise<QuantizationResult>`

##### `quantizeImageData(imageData, options?)`

Quantizes an `ImageData` object (e.g. from canvas) or raw RGBA byte data.

- `imageData`: `ImageData | RgbaImageInput` - RGBA image data
- `options`: `QuantizationOptions` (optional)
- Returns: `Promise<QuantizationResult>`

##### `dispose()`

Terminates the worker, rejects any pending operations, and releases resources. Safe to call multiple times.

Each call snapshots byte inputs and options before waiting for worker startup;
the library never detaches your buffers. Blob reading runs in the worker and is covered by operation timeout
and disposal. Output byte arrays are independently owned by each result.

PNG and raw RGBA images are limited to 16,777,216 pixels (64 MiB of RGBA data).
Oversized PNG headers are rejected before allocating the decoded image. Resize
larger images before quantization; actual working memory exceeds the RGBA size.

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
  imageData: ImageData | RgbaImageData; // Native ImageData in browsers; plain RGBA in Node
  quality: number;         // Achieved quality (0.0-1.0)
  paletteLength: number;   // Number of colors in palette
  width: number;           // Image width in pixels
  height: number;          // Image height in pixels
}
```

### Low-level WASM exports

The `/wasm/libimagequant_wasm.js` and `/wasm/libimagequant_wasm_bg.wasm` exports
expose the generated wasm-bindgen API for manual initialization. In Node, pass
the binary bytes explicitly; Node's `fetch` does not load `file:` URLs:

```typescript
import init, { decode_png_to_rgba } from 'libimagequant-wasm/wasm/libimagequant_wasm.js';
import { readFile } from 'node:fs/promises';

const binary = new URL(import.meta.resolve('libimagequant-wasm/wasm/libimagequant_wasm_bg.wasm'));
await init({ module_or_path: await readFile(binary) });
const [rgba, width, height] = decode_png_to_rgba(await readFile('input.png'));
```

Use the JavaScript glue and WASM from the same build. Low-level `ImageQuantizer`
and `QuantizationResult` instances own Rust allocations: call their `free()`
methods in `finally` blocks. The high-level browser and Node clients manage these
allocations for each operation.

## Build from Source

### Prerequisites

- [Rust](https://rustup.rs/) 1.94.1 with the `wasm32-unknown-unknown` target (pinned in `rust-toolchain.toml`)
- [wasm-pack](https://wasm-bindgen.github.io/wasm-pack/) 0.15.0
- Node.js 24 LTS (^24.22.1; see `.node-version` and `devEngines.runtime` in `package.json`)
- [pnpm](https://pnpm.io/installation) 12.15.0 (pinned in `package.json`)
- wasm-pack manages [wasm-opt](https://github.com/WebAssembly/binaryen), using an installed Binaryen binary or its downloaded cache

### Setup

```bash
# Install Rust and wasm-pack
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install wasm-pack --locked --version 0.15.0
# rustup reads rust-toolchain.toml and installs its compiler and target
rustup show

# Install dependencies
pnpm install --frozen-lockfile

# Install the test browser
pnpm exec playwright install chromium

# Build
pnpm build
```

### Scripts

| Script                  | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `pnpm build`            | Full build (WASM + TypeScript + types)                       |
| `pnpm build:wasm`       | Build WASM module only                                       |
| `pnpm build:types`      | Generate TypeScript declarations only                        |
| `pnpm format`           | Format source, examples, documentation, and Rust             |
| `pnpm format:check`     | Check oxfmt and Rust formatting without writing              |
| `pnpm lint`             | Check formatting, oxlint, native/WASM Clippy, and TypeScript |
| `pnpm typecheck`        | Run TypeScript type checking                                 |
| `pnpm test`             | Run tests (Vitest + headless Chromium; build first)          |
| `pnpm test:package`     | Validate built package files                                 |
| `pnpm test:integration` | Run built-artifact and package-consumer regressions          |
| `pnpm test:watch`       | Run tests in watch mode                                      |
| `pnpm dev`              | Start Vite dev server                                        |
| `pnpm clean`            | Remove build output                                          |

All WASM builds use `scripts/build-wasm.mjs`, `--release`, `--target web`, and
`--locked`. wasm-pack selects the wasm-bindgen CLI matching `Cargo.lock` and
applies the single `-Oz` optimization pass from `Cargo.toml`. The web target's
explicit initialization works in both workers; Node does not require a separate
WASI or native addon build. Browser and Node JavaScript are bundled separately
with ES2025 and Node 24 targets. The Rust compiler is pinned because its default
WebAssembly feature set can change between releases.

`pnpm build:wasm` refreshes the raw assets in `dist/wasm/`; run `pnpm build` to
refresh the embedded workers too. `./build.sh` builds the same WASM into `pkg/`.
`pnpm clean` removes `dist/` and `pkg/` while preserving Rust's incremental cache;
use `cargo clean` to clear that cache.

## Releasing

Use the pinned Node 24, pnpm, and Rust toolchains, with the Playwright test browser
installed. Update the version in `package.json` and `Cargo.toml`, refresh the root
package entry in `Cargo.lock` with Cargo, and commit all changes on `main`.
Releases require an explicit stable `major.minor.patch` version newer than the
published npm versions.

```bash
# Authenticate outside the repo's pnpm-only contributor checks
(cd /tmp && npm login --registry=https://registry.npmjs.org/)

# Run the complete pipeline without tagging, pushing, or publishing
pnpm release 0.4.0 --dry-run

# Validate, tag, push main and its tag atomically, and publish to npm
pnpm release 0.4.0
```

The command checks the version in all three manifests, the clean working tree,
local/remote tag conflicts, npm versions, and whether `origin/main` can advance
without a force push. It installs with the frozen lockfile, runs oxfmt, oxlint,
rustfmt, native/WASM Clippy, TypeScript checks, release-workflow tests, a production
build, browser tests, native Rust tests, and package validation.

It then packs a staged copy with the source `gitHead`, runs the integration suite
against that exact tarball (including an installed npm consumer), and checks an
npm publication dry run. Only after validation does it create the annotated
`v<version>` tag, atomically push the commit to `origin/main` and its tag, and
publish the tested archive as `latest`. Publication skips lifecycle scripts so
nothing rebuilds after validation; the registry's commit and SHA-512 integrity
must match the artifact.

Artifacts and release metadata are retained under the ignored `releases/`
directory. If publication fails after the tag push, fix authentication or the
reported failure and retry the same command at the same commit. Matching tags
are reused; conflicting tags are never moved. A confirmed, already published
release is reported without publishing it again. npm credentials come from your
user configuration or environment; npm runs outside the repo so `devEngines`
does not block authentication or tarball publishing. npm may request publishing
2FA in your terminal.

npm may accept an upload before the version becomes available. The command records
that acceptance and waits up to ten minutes for registry confirmation. If processing
takes longer, rerun at the same commit to verify the recorded submission without
building or publishing it again. Preserve `releases/v<version>.json` when retrying.

## Testing

Browser tests run in a real browser via [Vitest](https://vitest.dev/) with `@vitest/browser` and Playwright. The actual WASM module is loaded and executed. Node integration tests exercise worker threads, ESM/CommonJS packages, strict TypeScript without DOM types, and installed tarball consumers.

```bash
# Build first (tests run against built output)
pnpm build

# Run tests (headless Chromium)
pnpm test

# Test Node, browser bundles, and installed package consumers
pnpm test:integration

# Validate package files and check Rust
pnpm test:package
cargo check --locked --target wasm32-unknown-unknown
cargo test --locked
```

The test suite covers:

- **High-level API** - `LibImageQuant` class, all input formats, options, disposal, concurrency, error handling
- **Node and packaging** - Worker startup/exit, malformed messages, byte ownership, server bundling, and published declarations
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
4. **Call `dispose()`** when done to release the browser worker or Node thread

## Examples

After `pnpm build`, process a PNG in Node with:

```bash
node examples/node.mjs input.png output.png
```

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
4. Test: `pnpm test && pnpm test:integration`
5. Submit a pull request

## Troubleshooting

### Node Worker Loading Issues

Import `libimagequant-wasm/node`, use Node.js 24+, and include the installed
package's worker when deploying. Server bundlers should externalize this package
or set `workerUrl` as described above. The `/worker` export is a browser worker;
`/node-worker` is the prebuilt Node worker asset. They are loaded by the respective
clients and are not interchangeable API constructors.

A worker crash or unexpected exit rejects pending and subsequent calls. Dispose
of that instance and create a new quantizer to recover. Always use `try/finally`
for short-lived scripts so a live thread does not keep the process running.

### Browser Worker Loading Issues

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
base URL (`document.baseURI`) when using the default embedded worker. Relative
worker paths also respect `<base>`. Directory query parameters are forwarded to
both the JavaScript loader and WASM binary.

### Performance Issues

- Large images may take significant time to quantize
- Consider resizing images before quantization
- Use higher `speed` settings for real-time applications
