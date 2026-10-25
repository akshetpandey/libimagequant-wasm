import { defineConfig, build as buildVite, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { cp, writeFile } from 'node:fs/promises';
import { buildWasm, copyWasm, root } from './scripts/build-wasm.mjs';

const wasmResolver = (): Plugin => ({
  name: 'wasm-module',
  resolveId(id) {
    if (id === 'virtual:libimagequant-wasm') return resolve(root, 'pkg/libimagequant_wasm.js');
  },
});

const worker = { format: 'es' as const, plugins: () => [wasmResolver()] };
// Explicit versions keep the documented browser floor stable across Vite upgrades.
const browserTargets = ['chrome111', 'edge111', 'firefox114', 'safari16.4', 'ios16.4'];

// Node and browser outputs need different platform handling for import.meta
// and built-in modules. Stage them independently before assembling dist/.
async function buildAuxiliaryBundles() {
  for (const { entry, formats, directory, platform, target } of [
    {
      entry: 'node',
      formats: ['es', 'cjs'] as const,
      directory: 'node',
      platform: 'node' as const,
      target: 'node22.12',
    },
    {
      entry: 'node-worker',
      formats: ['es'] as const,
      directory: 'node-worker',
      platform: 'node' as const,
      target: 'node22.12',
    },
    {
      entry: 'index',
      formats: ['cjs'] as const,
      directory: 'browser-cjs',
      platform: 'browser' as const,
      target: browserTargets,
    },
  ]) {
    await buildVite({
      configFile: false,
      root,
      publicDir: false,
      plugins: [wasmResolver()],
      worker,
      logLevel: 'warn',
      build: {
        lib: {
          entry: resolve(root, `src/${entry}.ts`),
          formats: [...formats],
          fileName: (format) => `${entry}.${format === 'es' ? 'mjs' : 'cjs'}`,
        },
        outDir: resolve(root, `pkg/${directory}`),
        emptyOutDir: true,
        assetsInlineLimit: Infinity,
        target,
        minify: true,
        sourcemap: true,
        rolldownOptions: { platform, external: [/^node:/] },
      },
    });
  }
}

const wasmPlugin = (): Plugin => ({
  name: 'wasm-build',
  async buildStart() {
    await buildWasm();
    await buildAuxiliaryBundles();
  },
  async writeBundle() {
    await copyWasm('dist/wasm');
    for (const directory of ['node', 'node-worker', 'browser-cjs']) {
      await cp(resolve(root, `pkg/${directory}`), resolve(root, 'dist'), { recursive: true });
    }
    // A browser worker implementation must be ESM to retain its module URL.
    await writeFile(resolve(root, 'dist/worker.cjs'), "void import('./worker.mjs');\n");
  },
});

export default defineConfig({
  plugins: [wasmPlugin(), wasmResolver()],
  worker,
  build: {
    assetsInlineLimit: Infinity,
    lib: {
      entry: { index: resolve(root, 'src/index.ts'), worker: resolve(root, 'src/worker.ts') },
      formats: ['es'],
      fileName: (_format, entry) => `${entry}.mjs`,
    },
    target: browserTargets,
    minify: true,
    sourcemap: true,
  },
  server: { port: 8080, host: true },
});
