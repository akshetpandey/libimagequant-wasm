// Test script to validate package structure
import { access, constants } from 'node:fs';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const checkAccess = promisify(access);

const filesToCheck = [
  'dist/index.mjs',
  'dist/index.cjs',
  'dist/worker.mjs',
  'dist/worker.cjs',
  'dist/index.d.ts',
  'dist/index.d.cts',
  'dist/node.mjs',
  'dist/node.cjs',
  'dist/node.d.ts',
  'dist/node.d.cts',
  'dist/node-worker.mjs',
  'dist/worker.d.ts',
  'dist/wasm/libimagequant_wasm.js',
  'dist/wasm/libimagequant_wasm_bg.wasm',
  'dist/wasm/libimagequant_wasm.d.ts',
  'package.json',
  'README.md',
  'LICENSE',
];

async function validatePackage() {
  console.log('🔍 Validating NPM package structure...\n');

  let allFilesExist = true;

  for (const file of filesToCheck) {
    try {
      await checkAccess(resolve(import.meta.dirname, '..', file), constants.F_OK);
      console.log(`✅ ${file}`);
    } catch {
      console.log(`❌ ${file} - NOT FOUND`);
      allFilesExist = false;
    }
  }

  console.log('\n📦 Package validation:', allFilesExist ? '✅ PASSED' : '❌ FAILED');

  if (allFilesExist) {
    console.log('\n🎉 Built package structure is valid.');
    console.log('\nValidate the complete release: pnpm release <version> --dry-run');
    console.log('Publish after validation: pnpm release <version>');
  } else {
    process.exitCode = 1;
  }
}

validatePackage().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
