# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build Commands
- `npm run build` - Full build: cleans, builds WASM with wasm-pack, builds TypeScript (ESM + CJS), generates type definitions
- `npm run build:wasm` - Build only WASM module using wasm-pack (output to dist/wasm/)
- `npm run build:types` - Generate TypeScript declarations only
- `npm run clean` - Remove dist/ and target/ directories

### Development Server
- `npm run dev` - Start Vite development server
- `npm run serve` - Start development server on port 8080 
- `npm run preview` - Preview production build
- `npm test` - Build and serve (used for testing examples)

### Type Checking
- `npm run typecheck` - Run TypeScript type checking without emission

### Alternative Build (Bash)
- `./build.sh` - Standalone build script with optimization and validation

## Architecture Overview

This is a WebAssembly wrapper for the libimagequant image quantization library, providing browser-compatible image color reduction with Web Worker support.

### Key Components

**Rust WASM Layer** (`src/lib.rs`):
- `ImageQuantizer` - Main quantization functionality using imagequant crate
- `QuantizationResult` - Result wrapper with palette and remapping methods  
- `ImageHistogram` - For batch processing multiple images
- Exposes WASM functions to JavaScript via wasm-bindgen

**TypeScript API Layer** (`src/index.ts`):
- `LibImageQuant` class - High-level promise-based API
- Web Worker management for non-blocking processing
- Convenience functions: `quantizeCanvas()`, `quantizeImage()`, `quantizeImageData()`
- Support for both single images and batch processing

**Web Worker** (`src/worker.ts`):
- Handles WASM module loading and initialization
- Message-based communication with main thread
- Supports dynamic WASM URL configuration
- Error handling and operation timeouts

### Build Process

The build uses a custom Vite configuration that:
1. Runs `wasm-pack build --target web` to generate WASM bindings
2. Builds TypeScript to both ESM (.mjs) and CommonJS (.cjs) formats
3. Generates TypeScript declarations
4. Copies WASM files to `dist/wasm/` directory
5. Minifies output with Terser

### Development Requirements

- **Rust**: Required for WASM compilation, with `wasm32-unknown-unknown` target
- **wasm-pack**: Used for building WASM modules for web
- **Node.js 16+**: For TypeScript compilation and package management
- **wasm-opt** (optional): For WASM size optimization via binaryen

### Project Structure

- `src/lib.rs` - Rust WASM implementation
- `src/index.ts` - Main TypeScript API
- `src/worker.ts` - Web Worker implementation  
- `examples/` - Test HTML files and usage examples
- `dist/` - Built output (ESM, CJS, types, WASM files)
- `Cargo.toml` - Rust dependencies and WASM build config
- `vite.config.ts` - Custom build pipeline with WASM plugin

### Testing

Use `examples/test.html` for manual testing - provides file upload, parameter adjustment, and visual comparison of quantization results.