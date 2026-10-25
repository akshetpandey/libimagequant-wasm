import { defineConfig } from 'vite'
import { resolve } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { copyFile, mkdir } from 'node:fs/promises'

const execFileAsync = promisify(execFile)

const wasmResolver = () => ({
  name: 'wasm-module',
  resolveId(id: string) {
    if (id === 'virtual:libimagequant-wasm') return resolve(import.meta.dirname, 'pkg/libimagequant_wasm.js')
  }
})

// Plugin to build WASM
const wasmPlugin = () => {
  let hasBuiltWasm = false;
  let hasProcessed = false;

  return {
    name: 'wasm-build',
    renderChunk(_code, chunk, output) {
      if (chunk.name === 'worker' && output.format === 'cjs') {
        // A browser worker has a module URL only in ESM. Delegate rather than
        // emitting an implementation with erased import.meta.url expressions.
        return { code: "void import('./worker.mjs');\n", map: { mappings: '' } }
      }
    },
    buildStart: async () => {
      if (hasBuiltWasm) return;
      hasBuiltWasm = true;
      console.log('Building WASM module...')
      try {
        // Generate bindings before either bundle or the embedded worker resolves them.
        const { stderr } = await execFileAsync('wasm-pack', ['build', '--target', 'web', '--out-dir', 'pkg', '--', '--locked'])
        if (stderr) console.warn('WASM build warnings:', stderr)
        console.log('WASM build completed')
      } catch (error) {
        console.error('WASM build failed:', error)
        throw error
      }
    },
    writeBundle: async () => {
      // Only process once (this hook is called for each format)
      if (hasProcessed) return;
      hasProcessed = true;

      try {
        // Create dist/wasm directory
        await mkdir('dist/wasm', { recursive: true })

        // Copy only the WASM-specific files (not LICENSE, README.md, package.json)
        const filesToCopy = [
          'libimagequant_wasm.js',
          'libimagequant_wasm_bg.wasm',
          'libimagequant_wasm.d.ts',
          'libimagequant_wasm_bg.wasm.d.ts'
        ]

        for (const file of filesToCopy) {
          await copyFile(`pkg/${file}`, `dist/wasm/${file}`)
        }

        console.log('WASM files copied to dist/wasm')
      } catch (error) {
        console.error('WASM copy failed:', error)
        throw error
      }
    }
  }
}

export default defineConfig({
  plugins: [wasmPlugin(), wasmResolver()],
  worker: { format: 'es', plugins: () => [wasmResolver()] },
  build: {
    assetsInlineLimit: Infinity,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        worker: resolve(import.meta.dirname, 'src/worker.ts'),
      },
      name: 'LibImageQuant',
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'mjs' : 'cjs'}`
    },
    rolldownOptions: {
      external: ['fs', 'path', 'url'],
      output: {
        preserveModules: false,
        globals: {
          'fs': 'fs',
          'path': 'path',
          'url': 'url'
        }
      }
    },
    target: 'es2025',
    minify: true,
    sourcemap: true
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src')
    }
  },
  server: {
    port: 8080,
    host: true
  }
})
