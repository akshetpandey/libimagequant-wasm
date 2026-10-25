import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compositingApng } from './apng-fixtures.mjs';

const exec = promisify(execFile);

async function typecheck(source, extension = 'mts', nodeOnly = false) {
  const file = `consumer.${extension}`;
  await writeFile(join(directory, file), source);
  const config = join(directory, `tsconfig.${extension}.json`);
  await writeFile(
    config,
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        lib: nodeOnly ? ['ES2022'] : ['ES2022', 'DOM'],
        types: nodeOnly ? ['node'] : [],
        typeRoots: [fileURLToPath(new URL('../../node_modules/@types', import.meta.url))],
        strict: true,
        noEmit: true,
      },
      files: [file],
    }),
  );
  await exec(
    process.execPath,
    [
      fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url)),
      '-p',
      config,
    ],
    { cwd: directory },
  );
}

let directory;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'libimagequant-consumer-'));
  await mkdir(join(directory, 'node_modules'));
  await symlink(
    fileURLToPath(new URL('../../', import.meta.url)),
    join(directory, 'node_modules/libimagequant-wasm'),
  );
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
});
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('production bundlers preserve the exported worker setup', async () => {
  const entry = join(directory, 'worker.mjs');
  await writeFile(entry, "import 'libimagequant-wasm/worker';");
  const built = await build({
    configFile: false,
    root: directory,
    logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry, formats: ['es'] } },
  });
  const output = Array.isArray(built) ? built[0].output : built.output;
  const code = output.find((outputItem) => outputItem.type === 'chunk').code;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const messages = [];
  const worker = { postMessage: (message) => messages.push(message) };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: worker });
  try {
    await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    assert.equal(typeof worker.onmessage, 'function');
    assert.deepEqual(messages, [{ type: 'ready' }]);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'self', previous);
    else delete globalThis.self;
  }
});

test('browser results can be saved directly as a Blob with strict TypeScript', async () => {
  await typecheck(`import Quantizer from 'libimagequant-wasm';
    const result = await new Quantizer().quantizePng(new Uint8Array());
    const blob: Blob = new Blob([result.pngBytes], { type: 'image/png' });
    const image: ImageData = result.imageData;
    console.log(blob, image);`);
});

test('raw WASM declarations retain native browser WebAssembly and owned buffer types', async () => {
  await typecheck(`import init, { initSync, ImageQuantizer, encode_palette_to_png, decode_png_to_rgba } from 'libimagequant-wasm/wasm/libimagequant_wasm.js';
    import type * as Binary from 'libimagequant-wasm/wasm/libimagequant_wasm_bg.wasm';
    const bytes = new Uint8Array();
    const module = new WebAssembly.Module(bytes);
    const sync = initSync({ module });
    const async = await init({ module_or_path: bytes });
    const memory: WebAssembly.Memory = sync.memory;
    const rawMemory: typeof Binary.memory = memory;
    const table: WebAssembly.Table = async.__wbindgen_externrefs;
    const [pixels, width, height] = decode_png_to_rgba(bytes);
    const q = new ImageQuantizer();
    try {
      const result = q.quantizeImage(pixels, width, height);
      try {
        const image = new ImageData(result.remapImage(pixels, width, height), width, height);
        const png = encode_palette_to_png(result.getPaletteIndices(pixels, width, height), result.getPalette(), width, height);
        const blob = new Blob([png], { type: 'image/png' });
        console.log(image, blob);
      } finally { result.free(); }
    } finally { q.free(); }
    console.log(rawMemory, table);`);
});

test('raw WASM declarations work in Node without DOM libraries', async () => {
  await typecheck(
    `import init, { initSync, ImageQuantizer } from 'libimagequant-wasm/wasm/libimagequant_wasm.js';
    import type * as Binary from 'libimagequant-wasm/wasm/libimagequant_wasm_bg.wasm';
    const bytes = Buffer.from([]);
    const sync = initSync({ module: bytes });
    const async = await init({ module_or_path: bytes });
    const memory: ArrayBuffer = sync.memory.buffer;
    const rawMemory: typeof Binary.memory = sync.memory;
    const item: unknown = async.__wbindgen_externrefs.get(0);
    const q = new ImageQuantizer();
    q.free(); console.log(memory, rawMemory, item);`,
    'mts',
    true,
  );
});

test('CommonJS declarations expose the constructor and named option types', async () => {
  await typecheck(
    `import Quantizer = require('libimagequant-wasm');
    import type { QuantizationOptions, QuantizationResult, LibImageQuantOptions } from 'libimagequant-wasm';
    const settings: LibImageQuantOptions = { operationTimeout: 100 };
    const options: QuantizationOptions = { maxColors: 4 };
    const q = new Quantizer(settings);
    const result: Promise<QuantizationResult> = q.quantizePng(new Uint8Array(), options);
    q.dispose(); console.log(result);`,
    'cts',
  );
});

for (const format of ['mts', 'cts']) {
  test(`Node ${format} declarations work without DOM libraries`, async () => {
    const statement =
      format === 'mts'
        ? "import Quantizer from 'libimagequant-wasm/node';"
        : "import Quantizer = require('libimagequant-wasm/node');";
    await typecheck(
      `${statement}
      import type { QuantizationResult, RgbaImageData } from 'libimagequant-wasm/node';
      async function run() {
        const q = new Quantizer({ workerEnv: { ...process.env } });
        try {
          const result: QuantizationResult = await q.quantizePng(Buffer.from([]));
          await q.quantizeImageData({ data: Buffer.from([255,0,0,255]), width: 1, height: 1 });
          const rgba: RgbaImageData = result.imageData;
          const png: Blob = new Blob([result.pngBytes]);
          console.log(rgba, png);
        } finally { q.dispose(); }
      }
      void run;`,
      format,
      true,
    );
  });
}

test('an externalized Vite SSR consumer runs without relocating the worker', async () => {
  const entry = join(directory, 'server.mjs');
  await writeFile(
    entry,
    `import Quantizer from 'libimagequant-wasm/node';
    export async function run() {
      const q = new Quantizer();
      try {
        return (await q.quantizeImageData({ data: new Uint8ClampedArray([255,0,0,255]), width:1, height:1 })).width;
      } finally { q.dispose(); }
    }`,
  );
  const outDir = join(directory, 'server');
  await build({
    configFile: false,
    root: directory,
    logLevel: 'silent',
    ssr: { external: ['libimagequant-wasm'] },
    build: {
      ssr: entry,
      target: 'node22.12',
      outDir,
      rolldownOptions: { output: { entryFileNames: 'server.mjs' } },
    },
  });
  const { pathToFileURL } = await import('node:url');
  const { run } = await import(pathToFileURL(join(outDir, 'server.mjs')));
  assert.equal(await run(), 1);
});

for (const nodeOnly of [false, true]) {
  for (const extension of ['mts', 'cts']) {
    test(`${nodeOnly ? 'Node' : 'browser'} ${extension} exposes typed APNG frames`, async () => {
      const entry = nodeOnly ? 'libimagequant-wasm/node' : 'libimagequant-wasm';
      await typecheck(
        `import type { QuantizationResult, QuantizedAnimation, AnimationFrame } from '${entry}';
        import type { RgbaImageData } from '${entry}';
        function inspect(result: QuantizationResult) {
          const animation: QuantizedAnimation | undefined = result.animation;
          const frame: AnimationFrame | undefined = animation?.frames[0];
          if (frame) {
            const image: ${nodeOnly ? 'RgbaImageData' : 'ImageData'} = frame.imageData;
            const bytes: Uint8ClampedArray<ArrayBuffer> = image.data;
            const duration: number = frame.durationMs;
            console.log(bytes, duration);
          }
        }
        void inspect;`,
        extension,
        nodeOnly,
      );
    });
  }
}

test('raw APNG declarations retain owned buffers and match the Node result contract', async () => {
  await typecheck(
    `import { ImageQuantizer, decode_png_animation, type DecodedPngAnimation, type PngAnimationQuantizationResult } from 'libimagequant-wasm/wasm/libimagequant_wasm.js';
    import type { QuantizationResult } from 'libimagequant-wasm/node';
    const decoded: DecodedPngAnimation | undefined = decode_png_animation(Buffer.from([]));
    const pixels: Uint8ClampedArray<ArrayBuffer> | undefined = decoded?.animation.frames[0].imageData.data;
    console.log(pixels);
    const q = new ImageQuantizer();
    try {
      const raw: PngAnimationQuantizationResult | undefined = q.quantizePngAnimation(Buffer.from([]), 0);
      const result: QuantizationResult | undefined = raw;
      if (result?.animation) {
        const blob: Blob = new Blob([result.animation.frames[0].imageData.data]);
        console.log(blob);
      }
    } finally { q.free(); }`,
    'mts',
    true,
  );
});

for (const format of ['es', 'cjs']) {
  test(`a bundled Node ${format} consumer can locate the exported worker`, async () => {
    const entry = join(directory, `node-${format}.mjs`);
    await writeFile(
      entry,
      `import Quantizer from 'libimagequant-wasm/node';
      export async function run(workerUrl) {
        const q = new Quantizer({ workerUrl });
        try { return (await q.quantizeImageData({ data:new Uint8ClampedArray([255,0,0,255]), width:1, height:1 })).width; }
        finally { q.dispose(); }
      }`,
    );
    const outDir = join(directory, `bundled-${format}`);
    await build({
      configFile: false,
      root: directory,
      logLevel: 'silent',
      build: {
        outDir,
        target: 'node22.12',
        lib: { entry, formats: [format], fileName: () => `app.${format === 'es' ? 'mjs' : 'cjs'}` },
        rolldownOptions: { platform: 'node', external: [/^node:/] },
      },
    });
    const { pathToFileURL } = await import('node:url');
    const { run } = await import(
      pathToFileURL(join(outDir, `app.${format === 'es' ? 'mjs' : 'cjs'}`))
    );
    const worker = join(outDir, 'relocated-worker.mjs');
    await copyFile(new URL(import.meta.resolve('libimagequant-wasm/node-worker')), worker);
    assert.equal(await run(pathToFileURL(worker)), 1);
  });
}

test('the packed package runs from a strict npm consumer installation', async () => {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const { version } = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  let archive = process.env.RELEASE_TARBALL;
  if (!archive) {
    await exec('pnpm', ['pack', '--pack-destination', directory], { cwd: repository });
    archive = join(directory, `libimagequant-wasm-${version}.tgz`);
  }
  const consumer = join(directory, 'installed');
  await mkdir(consumer);
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        'libimagequant-wasm': `file:${archive}`,
      },
    }),
  );
  await exec(
    'npm',
    [
      'install',
      '--engine-strict',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--cache',
      join(directory, 'npm-cache'),
    ],
    { cwd: consumer },
  );
  await writeFile(join(consumer, 'input.apng'), compositingApng());
  const { stdout } = await exec(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import Quantizer from 'libimagequant-wasm/node';
    import { createRequire } from 'node:module';
    import { readFile } from 'node:fs/promises';
    const common = createRequire(import.meta.url)('libimagequant-wasm/node');
    for (const Q of [Quantizer, common]) {
      const q = new Q();
      try {
        const result = await q.quantizeImageData({ data: new Uint8ClampedArray([255,0,0,255]), width:1, height:1 });
        console.log(result.width);
        const animated = await q.quantizePng(await readFile('input.apng'));
        console.log(animated.animation.frames.length, animated.animation.numPlays);
      } finally { q.dispose(); }
    }
    console.log(typeof (await import('libimagequant-wasm')).default);
  `,
    ],
    { cwd: consumer, timeout: 5000 },
  );
  assert.deepEqual(stdout.trim().split(/\r?\n/), ['1', '4 3', '1', '4 3', 'function']);
});
