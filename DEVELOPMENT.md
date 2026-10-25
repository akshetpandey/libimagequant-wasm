# Development

## Prerequisites

- [Rust](https://rustup.rs/) 1.99.1 with the `wasm32-unknown-unknown` target (pinned in `rust-toolchain.toml`)
- [wasm-pack](https://wasm-bindgen.github.io/wasm-pack/) 0.15.0
- Node.js 22.23.4+ or 24.22.1+ within those LTS majors (`.node-version` defaults to Node 24; `devEngines` lists accepted contributor versions)
- [pnpm](https://pnpm.io/installation) 12.15.0 (pinned in `package.json`)
- wasm-pack manages [wasm-opt](https://github.com/WebAssembly/binaryen), using an installed Binaryen binary or its downloaded cache

## Setup

```bash
# Install Rust and wasm-pack
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install wasm-pack --locked --version 0.15.0
# rustup reads rust-toolchain.toml and installs its compiler and target
rustup show

# Install dependencies
pnpm install --frozen-lockfile

# Install the test browser
pnpm exec playwright install chromium

# Build
pnpm build
```

## Scripts

| Script                  | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `pnpm build`            | Full build (WASM + TypeScript + types)                       |
| `pnpm build:wasm`       | Build WASM module only                                       |
| `pnpm build:types`      | Generate TypeScript declarations only                        |
| `pnpm format`           | Format source, examples, documentation, and Rust             |
| `pnpm format:check`     | Check oxfmt and Rust formatting without writing              |
| `pnpm lint`             | Check formatting, oxlint, native/WASM Clippy, and TypeScript |
| `pnpm typecheck`        | Run TypeScript type checking                                 |
| `pnpm test`             | Run tests (Vitest + headless Chromium; build first)          |
| `pnpm test:package`     | Validate built package files                                 |
| `pnpm test:integration` | Run built-artifact and package-consumer regressions          |
| `pnpm test:watch`       | Run tests in watch mode                                      |
| `pnpm dev`              | Start Vite dev server                                        |
| `pnpm clean`            | Remove build output                                          |

All WASM builds use `scripts/build-wasm.mjs`, `--release`, `--target web`, and
`--locked`. wasm-pack selects the wasm-bindgen CLI matching `Cargo.lock` and
applies the single `-Oz` optimization pass from `Cargo.toml`. The web target's
explicit initialization works in both workers; Node does not require a separate
WASI or native addon build. Browser and Node JavaScript are bundled separately
with explicit Chrome/Edge 111, Firefox 114, Safari/iOS 16.4, and Node 22.12 targets. The Rust compiler is pinned because its default
WebAssembly feature set can change between releases.

`pnpm build:wasm` refreshes the raw assets in `dist/wasm/`; run `pnpm build` to
refresh the embedded workers too. `./build.sh` builds the same WASM into `pkg/`.
`pnpm clean` removes `dist/` and `pkg/` while preserving Rust's incremental cache;
use `cargo clean` to clear that cache.

## Testing

Browser tests run in a real browser via [Vitest](https://vitest.dev/) with `@vitest/browser` and Playwright. The actual WASM module is loaded and executed. Node integration tests exercise worker threads, ESM/CommonJS packages, strict TypeScript without DOM types, and installed tarball consumers.

```bash
# Build first (tests run against built output)
pnpm build

# Run tests (headless Chromium)
pnpm test

# Test Node, browser bundles, and installed package consumers
pnpm test:integration

# Validate package files and check Rust
pnpm test:package
cargo check --locked --target wasm32-unknown-unknown
cargo test --locked
```

The test suite covers:

- **High-level API** - `LibImageQuant` class, all input formats, options, disposal, concurrency, error handling
- **Node and packaging** - Worker startup/exit, malformed messages, byte ownership, server bundling, and published declarations
- **Low-level WASM** - `ImageQuantizer`, `QuantizationResult`, PNG encode/decode, memory management
- **Result validation** - Color accuracy, PNG integrity, transparency roundtrips
- **APNG** - Shared palettes, timing and loop counts, fallback images, blend/disposal modes, interlaced subframes, resource limits, and independent decoding of encoded frames

### Compatibility checks

The published Node entries support Node 22.12+ and are checked with Node 22
and 24. Keep `@types/node` on major 22 to catch accidental use of newer APIs.
Contributor tooling accepts the maintained patch versions listed in `devEngines`.
The default development runtime remains the latest Node 24 LTS in `.node-version`.

For Rust/WASM or browser build changes, install and test all three browser engines:

```bash
pnpm exec playwright install chromium firefox webkit
pnpm build
pnpm test:integration
TEST_BROWSER=firefox node --test tests/integration/browser.test.mjs
TEST_BROWSER=webkit node --test tests/integration/browser.test.mjs
```

The explicit browser targets in `vite.config.ts` match Vite 8's
[Baseline browser targets](https://vite.dev/guide/build#browser-compatibility).
Module workers and the generated WASM feature set must also work in that range.
These are build/feature minimums; automated tests use Playwright's pinned current
Chromium, Firefox, and WebKit engines, rather than historical browser binaries.
Do not claim that a JavaScript target alone guarantees WebAssembly compatibility.

See [RELEASING.md](RELEASING.md) for publishing.
