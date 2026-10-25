import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function typecheck(source, extension = 'mts', nodeOnly = false) {
  const file = `consumer.${extension}`;
  await writeFile(join(directory, file), source);
  const config = join(directory, `tsconfig.${extension}.json`);
  await writeFile(config, JSON.stringify({
    compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2025',
      lib: nodeOnly ? ['ES2025'] : ['ES2025', 'DOM'], types: nodeOnly ? ['node'] : [],
      typeRoots: [fileURLToPath(new URL('../../node_modules/@types', import.meta.url))],
      strict: true, noEmit: true },
    files: [file],
  }));
  await exec(process.execPath, [fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url)), '-p', config], { cwd: directory });
}

let directory;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'libimagequant-consumer-'));
  await mkdir(join(directory, 'node_modules'));
  await symlink(fileURLToPath(new URL('../../', import.meta.url)), join(directory, 'node_modules/libimagequant-wasm'));
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test('production bundlers preserve the exported worker setup', async () => {
  const entry = join(directory, 'worker.mjs');
  await writeFile(entry, "import 'libimagequant-wasm/worker';");
  const built = await build({
    configFile: false, root: directory, logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry, formats: ['es'] } },
  });
  const output = Array.isArray(built) ? built[0].output : built.output;
  const code = output.find(output => output.type === 'chunk').code;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const messages = [];
  const worker = { postMessage: message => messages.push(message) };
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

test('CommonJS declarations expose the constructor and named option types', async () => {
  await typecheck(`import Quantizer = require('libimagequant-wasm');
    import type { QuantizationOptions, QuantizationResult, LibImageQuantOptions } from 'libimagequant-wasm';
    const settings: LibImageQuantOptions = { operationTimeout: 100 };
    const options: QuantizationOptions = { maxColors: 4 };
    const q = new Quantizer(settings);
    const result: Promise<QuantizationResult> = q.quantizePng(new Uint8Array(), options);
    q.dispose(); console.log(result);`, 'cts');
});

for (const format of ['mts', 'cts']) {
  test(`Node ${format} declarations work without DOM libraries`, async () => {
    const statement = format === 'mts' ? "import Quantizer from 'libimagequant-wasm/node';"
      : "import Quantizer = require('libimagequant-wasm/node');";
    await typecheck(`${statement}
      import type { QuantizationResult, RgbaImageData } from 'libimagequant-wasm/node';
      async function run() {
        const q = new Quantizer();
        try {
          const result: QuantizationResult = await q.quantizePng(Buffer.from([]));
          const rgba: RgbaImageData = result.imageData;
          const png: Blob = new Blob([result.pngBytes]);
          console.log(rgba, png);
        } finally { q.dispose(); }
      }
      void run;`, format, true);
  });
}

for (const format of ['es', 'cjs']) {
  test(`a bundled Node ${format} consumer can locate the exported worker`, async () => {
    const entry = join(directory, `node-${format}.mjs`);
    await writeFile(entry, `import Quantizer from 'libimagequant-wasm/node';
      export async function run(workerUrl) {
        const q = new Quantizer({ workerUrl });
        try { return (await q.quantizeImageData({ data:new Uint8ClampedArray([255,0,0,255]), width:1, height:1 })).width; }
        finally { q.dispose(); }
      }`);
    const outDir = join(directory, `bundled-${format}`);
    await build({ configFile: false, root: directory, logLevel: 'silent', build: {
      outDir, target: 'node24', lib: { entry, formats: [format], fileName: () => `app.${format === 'es' ? 'mjs' : 'cjs'}` },
      rolldownOptions: { platform: 'node', external: [/^node:/] },
    } });
    const { pathToFileURL } = await import('node:url');
    const { run } = await import(pathToFileURL(join(outDir, `app.${format === 'es' ? 'mjs' : 'cjs'}`)));
    assert.equal(await run(new URL(import.meta.resolve('libimagequant-wasm/node-worker'))), 1);
  });
}

test('the packed package runs from a strict npm consumer installation', async () => {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const { version } = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  await exec('pnpm', ['pack', '--pack-destination', directory], { cwd: repository });
  const consumer = join(directory, 'installed');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    private: true, type: 'module', dependencies: {
      'libimagequant-wasm': `file:${join(directory, `libimagequant-wasm-${version}.tgz`)}`,
    },
  }));
  await exec('npm', ['install', '--engine-strict', '--ignore-scripts', '--no-audit', '--no-fund',
    '--package-lock=false', '--cache', join(directory, 'npm-cache')], { cwd: consumer });
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', `
    import Quantizer from 'libimagequant-wasm/node';
    import { createRequire } from 'node:module';
    const common = createRequire(import.meta.url)('libimagequant-wasm/node');
    for (const Q of [Quantizer, common]) {
      const q = new Q();
      try {
        const result = await q.quantizeImageData({ data: new Uint8ClampedArray([255,0,0,255]), width:1, height:1 });
        console.log(result.width);
      } finally { q.dispose(); }
    }
    console.log(typeof (await import('libimagequant-wasm')).default);
  `], { cwd: consumer, timeout: 5000 });
  assert.deepEqual(stdout.trim().split(/\r?\n/), ['1', '1', 'function']);
});
