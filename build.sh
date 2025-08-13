#!/bin/bash

# Build script for libimagequant-wasm
set -e

echo "Building libimagequant WASM module..."

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo "Error: wasm-pack is not installed. Please install it with:"
    echo "curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh"
    exit 1
fi

# Check if wasm-opt is installed (part of binaryen)
if ! command -v wasm-opt &> /dev/null; then
    echo "Warning: wasm-opt is not installed. Install binaryen for optimization:"
    echo "  macOS: brew install binaryen"
    echo "  Ubuntu: apt install binaryen"
    echo "  Or download from: https://github.com/WebAssembly/binaryen/releases"
fi

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf pkg/ target/

# Build with wasm-pack for web target
echo "Building WASM module..."
wasm-pack build --target web --out-dir pkg

# Optimize WASM if wasm-opt is available
if command -v wasm-opt &> /dev/null; then
    echo "Optimizing WASM module..."
    wasm-opt -Oz --enable-threads pkg/libimagequant_wasm_bg.wasm -o pkg/libimagequant_wasm_bg.wasm.optimized
    mv pkg/libimagequant_wasm_bg.wasm.optimized pkg/libimagequant_wasm_bg.wasm
    echo "WASM optimization complete."
else
    echo "Skipping WASM optimization (wasm-opt not found)."
fi

echo "Build complete! Files generated in pkg/ directory."
echo ""
echo "To test the module:"
echo "1. npm run serve"
echo "2. Open http://localhost:8080/test.html"