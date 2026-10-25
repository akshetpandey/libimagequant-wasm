# libimagequant-wasm

Quantize PNGs, animated PNGs, and RGBA images into indexed PNGs with up to 256 colors and alpha transparency.
Uses [libimagequant](https://github.com/ImageOptim/libimagequant) compiled to WebAssembly,
with processing in a browser worker or Node.js worker thread. Includes TypeScript declarations,
ES modules, and CommonJS exports.

## Install

```bash
npm install libimagequant-wasm
```

| Environment    | Entry point               | Result pixels                                |
| -------------- | ------------------------- | -------------------------------------------- |
| Browser        | `libimagequant-wasm`      | Native `ImageData`                           |
| Node.js 22.12+ | `libimagequant-wasm/node` | `{ data: Uint8ClampedArray, width, height }` |

Use `/node` explicitly in server code. The root entry is the browser API.
Neither entry requires Rust or additional runtime dependencies.

## Browser

```typescript
import LibImageQuant from 'libimagequant-wasm';

const quantizer = new LibImageQuant();
try {
  const response = await fetch('/input.png');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const result = await quantizer.quantizePng(await response.blob(), {
    maxColors: 64,
    speed: 3,
    dithering: 0.8,
  });

  const png = new Blob([result.pngBytes], { type: 'image/png' });
  // Save the Blob, or draw result.imageData to a canvas.
} finally {
  quantizer.dispose();
}
```

To quantize a canvas, pass its `ImageData`:

```typescript
const quantizer = new LibImageQuant();
try {
  const context = canvas.getContext('2d')!;
  const input = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = await quantizer.quantizeImageData(input, { maxColors: 32 });
  context.putImageData(result.imageData, 0, 0);
} finally {
  quantizer.dispose();
}
```

## Node.js

### ES modules

```javascript
import LibImageQuant from 'libimagequant-wasm/node';
import { readFile, writeFile } from 'node:fs/promises';

const quantizer = new LibImageQuant();
try {
  const result = await quantizer.quantizePng(await readFile('input.png'), { maxColors: 64 });
  await writeFile('output.png', result.pngBytes);
} finally {
  quantizer.dispose();
}
```

### CommonJS

```javascript
const LibImageQuant = require('libimagequant-wasm/node');
const { readFile, writeFile } = require('node:fs/promises');

async function main() {
  const quantizer = new LibImageQuant();
  try {
    const result = await quantizer.quantizePng(await readFile('input.png'), { maxColors: 64 });
    await writeFile('output.png', result.pngBytes);
  } finally {
    quantizer.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

The Node API accepts `Buffer`, `Uint8Array`, `ArrayBuffer`, and `Blob` PNG inputs.
For raw RGBA, pass `{ data, width, height }`, where `data` is a `Uint8Array`,
`Uint8ClampedArray`, or `Buffer`. Results contain plain RGBA data, without DOM globals.

### Server bundles

Keep the package external so its worker remains beside the installed Node entry.
For Vite SSR:

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  ssr: { external: ['libimagequant-wasm'] },
});
```

If bundling the library into your application, copy the `/node-worker` export
into your output directory during the build:

```javascript
import { copyFile } from 'node:fs/promises';

await copyFile(
  new URL(import.meta.resolve('libimagequant-wasm/node-worker')),
  'dist/quantizer-worker.mjs',
);
```

Then point the bundled application at that file:

```javascript
const quantizer = new LibImageQuant({
  workerUrl: new URL('./quantizer-worker.mjs', import.meta.url),
});
```

`workerUrl` must be an absolute `file:` URL. In CommonJS, resolve an installed worker with:

```javascript
const { pathToFileURL } = require('node:url');
const workerUrl = pathToFileURL(require.resolve('libimagequant-wasm/node-worker'));
const quantizer = new LibImageQuant({ workerUrl });
```

Workers clear CLI `execArgv` flags but inherit `NODE_OPTIONS`. If an application
preload cannot run in workers, supply a worker environment without that preload:

```javascript
const quantizer = new LibImageQuant({
  workerEnv: { ...process.env, NODE_OPTIONS: '' },
});
```

`workerEnv` replaces the full worker environment; the parent environment is unchanged.

## Animated PNG

`quantizePng` preserves APNG animation automatically. Its `pngBytes` contain an
indexed APNG with one palette shared across all frames, retaining frame delays,
loop count, and a separate static fallback image when present.

```typescript
const result = await quantizer.quantizePng(input, { maxColors: 64, includeFrameData: true });
if (result.animation) {
  console.log(result.animation.numPlays); // 0 means infinite looping
  for (const frame of result.animation.frames) {
    // Full canvas: native ImageData in browsers, plain RGBA data in Node.
    console.log(frame.imageData, frame.durationMs);
  }
}
```

APNG processing decodes twice: first to collect a shared palette, then to remap and
encode one frame at a time. By default, animation frames contain timing metadata only. Set `includeFrameData: true`
to also return every composited frame's pixels; this needs four bytes per canvas
pixel per frame. `imageData` always contains one static/default preview. With frame
pixels enabled, it shares the first frame's image data when `animation.defaultImageIsFrame`
is true; otherwise it is a separate fallback.
Frames are composited using the input's blending and disposal rules, then encoded
as indexed delta rectangles computed from the quantized frames, including cleared
pixels. Unchanged frames retain their delays through a one-pixel replacement. Each frame
exposes its original `delayNumerator` and `delayDenominator`; a denominator of zero
means 100. Static PNG results have no `animation` property.

## API

Both entry points expose the same methods:

| Method                               | Input                                                       | Returns                                                         |
| ------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------- |
| `quantizePng(input, options?)`       | PNG bytes: `Uint8Array`, `ArrayBuffer`, or `Blob`           | `Promise<QuantizationResult>`                                   |
| `quantizeImageData(input, options?)` | Browser `ImageData` or `{ data, width, height }` RGBA bytes | `Promise<QuantizationResult>`                                   |
| `dispose()`                          | —                                                           | Terminates the worker and rejects pending calls; safe to repeat |

Each call snapshots byte inputs and options; your buffers are never detached.
Blob reading is covered by the operation timeout and disposal. Each result owns its output arrays.
PNG and APNG input is normalized to RGBA8. The `metadata` option applies to PNG input:

- `'safe'` (default): retain gAMA, cHRM, sRGB, compatible RGB ICC profiles, and pHYs pixel density/aspect ratio.
- `'preserve'`: also retain supported tEXt, zTXt, iTXt, and EXIF, including text after image data. EXIF can contain location data, orientation, and an original thumbnail; choose this policy when those remain appropriate.
- `'none'`: strip ancillary metadata, while retaining APNG playback controls.

Preserved profile/text/EXIF payloads are limited to 1 MiB in total, with bounded text decompression.
PLTE/tRNS are rebuilt; palette-dependent bKGD, hIST, sBIT, unknown chunks, and unsupported HDR metadata are dropped.
Grayscale ICC profiles cannot describe indexed RGB output and are omitted. Quantization uses source gamma
without performing an ICC color-space conversion. Returned RGBA pixels remain in source sample coordinates;
use the encoded PNG for color-managed display of tagged images. Stripping color metadata can change their appearance.

Images are limited to 16,777,216 pixels (64 MiB of RGBA data). Resize larger images
before processing; actual working memory exceeds the raw image size.
APNGs are limited to 1,000 frames and 67,108,864 total canvas pixels (256 MiB of
RGBA data), counting the complete canvas per frame and any separate fallback.
This bounds processing work and opt-in pixel storage, rather than peak memory: quantization needs scratch
space, and the worker's WASM heap retains its peak size until you call `dispose()`.

### Constructor options

```typescript
const quantizer = new LibImageQuant({ operationTimeout: 60_000 });
```

| Option             | Default                                         | Use                                                       |
| ------------------ | ----------------------------------------------- | --------------------------------------------------------- |
| `initTimeout`      | `10000`                                         | Worker startup timeout, in milliseconds                   |
| `operationTimeout` | `30000`                                         | Per-operation timeout, including lazy WASM initialization |
| `workerUrl`        | Embedded browser worker / installed Node worker | Browser: URL string; Node: absolute `URL`                 |
| `wasmUrl`          | Embedded WASM                                   | Browser only: custom WASM directory or binary URL         |
| `workerEnv`        | Copy of `process.env`                           | Node only: full worker environment override               |

Timeouts must be positive integers no greater than 2,147,483,647 ms. A timeout
rejects the request without cancelling computation; `dispose()` terminates all queued work.
After a worker crash, dispose of the instance and create another.

### Quantization options

| Option             | Range                                                | Effect                                                       |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------ |
| `maxColors`        | Integer `2–256`                                      | Maximum palette size                                         |
| `speed`            | Integer `1–10`                                       | Higher values trade quality for speed                        |
| `quality`          | `{ min, target }`, integers `0–100`, `min <= target` | Minimum acceptable and target quality                        |
| `dithering`        | `0–1`                                                | Dithering strength                                           |
| `posterization`    | Integer `0–4`                                        | Number of low color bits discarded                           |
| `metadata`         | `'safe'` (default), `'preserve'`, or `'none'`        | Metadata policy for PNG/APNG input                           |
| `includeFrameData` | Boolean, default `false`                             | Return full APNG frame pixels in addition to timing metadata |

Reuse an instance for multiple images to avoid worker and WASM startup costs;
call `dispose()` when finished.

### Results

| Field             | Value                                                                  |
| ----------------- | ---------------------------------------------------------------------- |
| `pngBytes`        | Indexed PNG file as `Uint8Array`                                       |
| `imageData`       | Browser `ImageData`; Node `{ data: Uint8ClampedArray, width, height }` |
| `palette`         | RGBA colors as `number[][]`, each channel `0–255`                      |
| `paletteLength`   | Number of colors in the palette                                        |
| `quality`         | Achieved quality, `0–1`                                                |
| `width`, `height` | Image dimensions in pixels                                             |
| `animation`       | APNG only: `{ numPlays, defaultImageIsFrame, frames }`                 |

### Raw WASM

For direct wasm-bindgen access, use the `/wasm` file exports. In Node, read the
binary explicitly because `fetch` does not load `file:` URLs:

```javascript
import init, { decode_png_to_rgba } from 'libimagequant-wasm/wasm/libimagequant_wasm.js';
import { readFile } from 'node:fs/promises';

const binary = new URL(import.meta.resolve('libimagequant-wasm/wasm/libimagequant_wasm_bg.wasm'));
await init({ module_or_path: await readFile(binary) });
const [rgba, width, height] = decode_png_to_rgba(await readFile('input.png'));
```

Keep the JavaScript glue and WASM from the same build. Low-level `ImageQuantizer`
and `QuantizationResult` objects require `free()` in `finally` blocks; the high-level
API manages those allocations for you.

`decode_png_to_rgba` reads the static/default image. For all unquantized APNG
frames, use `decode_png_animation(bytes)`. For shared-palette APNG output, use
`ImageQuantizer.quantizePngAnimation(bytes, dithering?, includeFrameData?, metadata?)` after configuring the
quantizer. The quantization method omits frame pixels by default; `decode_png_animation`
explicitly returns every decoded frame. Both animation methods return `undefined` for static PNG input.
`ImageQuantizer.quantizePng(bytes, dithering?, metadata?)` handles static PNG input.

## Browser support and deployment

Build targets: **Chrome/Edge 111+, Firefox 114+, Safari 16.4+, and iOS Safari 16.4+**.
Module workers and WebAssembly must be enabled.

The default worker embeds its JavaScript and WASM, so no asset copying is needed.
Content Security Policy must allow `blob:` workers, `data:` fetches, and WebAssembly
compilation (for example, `script-src 'self' 'wasm-unsafe-eval'`).

For separately hosted assets, serve a same-origin module worker and set:

```javascript
const quantizer = new LibImageQuant({
  workerUrl: '/workers/worker.mjs',
  wasmUrl: '/assets/quantizer/',
});
```

The directory must contain the matching `libimagequant_wasm.js` and
`libimagequant_wasm_bg.wasm`; serve `.wasm` as `application/wasm`. A `wasmUrl`
ending in `.wasm` overrides only the binary. Relative WASM paths resolve against
an explicit worker URL, or the page's base URL for the default embedded worker.
Relative worker paths respect the page's `<base>` element.

The `/worker` export is the browser worker; `/node-worker` is the Node worker.
They are worker assets, not API constructors, and cannot be interchanged.

## Examples

- [Node PNG converter](https://github.com/akshetpandey/libimagequant-wasm/blob/main/examples/node.mjs)
- [Browser upload, controls, palette, and image comparison](https://github.com/akshetpandey/libimagequant-wasm/blob/main/examples/test.html)
- [Minimal browser example](https://github.com/akshetpandey/libimagequant-wasm/blob/main/examples/simple-test.html)

For building this repository, see [Development](https://github.com/akshetpandey/libimagequant-wasm/blob/main/DEVELOPMENT.md).

## License

Wrapper: [MIT](https://github.com/akshetpandey/libimagequant-wasm/blob/main/LICENSE).
Upstream [libimagequant](https://pngquant.org/lib/) is GPL-3.0-or-later or commercially licensed;
its license terms also apply.
