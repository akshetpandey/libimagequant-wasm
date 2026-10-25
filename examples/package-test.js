// Test script to validate package structure
import { access, constants } from 'fs';
import { promisify } from 'util';
import { resolve } from 'path';

const checkAccess = promisify(access);

const filesToCheck = [
    'dist/index.mjs',
    'dist/index.cjs', 
    'dist/worker.mjs',
    'dist/worker.cjs',
    'dist/index.d.ts',
    'dist/index.d.cts',
    'dist/worker.d.ts',
    'dist/wasm/libimagequant_wasm.js',
    'dist/wasm/libimagequant_wasm_bg.wasm',
    'dist/wasm/libimagequant_wasm.d.ts',
    'package.json',
    'README.md',
    'LICENSE'
];

async function validatePackage() {
    console.log('🔍 Validating NPM package structure...\n');
    
    let allFilesExist = true;
    
    for (const file of filesToCheck) {
        try {
            await checkAccess(resolve(import.meta.dirname, '..', file), constants.F_OK);
            console.log(`✅ ${file}`);
        } catch (error) {
            console.log(`❌ ${file} - NOT FOUND`);
            allFilesExist = false;
        }
    }
    
    console.log('\n📦 Package validation:', allFilesExist ? '✅ PASSED' : '❌ FAILED');
    
    if (allFilesExist) {
        console.log('\n🎉 Package is ready for NPM publishing!');
        console.log('\nNext steps:');
        console.log('1. pnpm build (final build)');
        console.log('2. pnpm publish (publish to NPM)');
    } else {
        process.exitCode = 1;
    }
}

validatePackage().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
