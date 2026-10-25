import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const root = fileURLToPath(new URL('../', import.meta.url));
export const wasmFiles = [
  'libimagequant_wasm.js', 'libimagequant_wasm_bg.wasm',
  'libimagequant_wasm.d.ts', 'libimagequant_wasm_bg.wasm.d.ts',
];

export async function buildWasm() {
  await rm(resolve(root, 'pkg'), { recursive: true, force: true });
  // wasm-pack selects the wasm-bindgen CLI matching Cargo.lock and runs the
  // single wasm-opt pass configured in Cargo.toml. Preserve Cargo's build cache.
  const { stderr } = await run('wasm-pack', [
    'build', '--release', '--target', 'web', '--out-dir', 'pkg', '--', '--locked',
  ], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  if (stderr) process.stderr.write(stderr);
  const compatibility = await readFile(resolve(root, 'src/wasm-env.d.ts'), 'utf8');
  for (const file of wasmFiles.filter(file => file.endsWith('.d.ts'))) {
    const declarations = resolve(root, 'pkg', file);
    await writeFile(declarations, `${compatibility}\n${await readFile(declarations, 'utf8')}`);
  }
}

export async function copyWasm(destination) {
  const outDir = resolve(root, destination);
  await mkdir(outDir, { recursive: true });
  for (const file of wasmFiles) await copyFile(resolve(root, 'pkg', file), resolve(outDir, file));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildWasm();
  if (process.argv[2]) await copyWasm(process.argv[2]);
}
