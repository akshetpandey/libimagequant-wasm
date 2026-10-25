# Repository guidance

These instructions apply to all coding agents working in this repository.

## Toolchain and package management

- Use Node.js 24 LTS (the exact development version is in `.node-version`).
- Use the pnpm version pinned in `package.json`; commit `pnpm-lock.yaml` when dependencies change. Do not introduce other JavaScript lockfiles.
- Node.js and pnpm requirements belong in `devEngines`: they apply to contributors building and testing the repository. The published browser library does not require consumers to use those tools.
- Rust, the `wasm32-unknown-unknown` target, and wasm-pack 0.15.0 or newer are required. Keep `Cargo.lock` committed and build against it with `--locked`.
- Install JavaScript dependencies with `pnpm install --frozen-lockfile`.
- Install the browser for tests with `pnpm exec playwright install chromium`.

## Commands

- `pnpm build` — clean and build WASM, ESM, CommonJS, source maps, and TypeScript declarations into `dist/`.
- `pnpm build:wasm` — build only the WASM module into `dist/wasm/`.
- `pnpm build:types` — generate TypeScript declarations.
- `pnpm typecheck` — check TypeScript without emitting files.
- `pnpm test` — run the Vitest suite in headless Chromium against the built output. Run `pnpm build` first.
- `pnpm test:watch` — run browser tests in watch mode.
- `pnpm test:package` — validate the built package's required files.
- `pnpm test:integration` — run built-artifact and package-consumer regression tests after building.
- `cargo check --locked --target wasm32-unknown-unknown` — check the Rust WASM implementation.
- `cargo test --locked` — run native Rust tests (browser tests exercise the WASM API).
- `pnpm dev` / `pnpm serve` — start the Vite server on port 8080.
- `pnpm test:manual` — build and serve the examples; open `/examples/test.html`.
- `pnpm clean` — remove `dist/` and `target/`.
- `./build.sh` — standalone WASM build into `pkg/`.

## Architecture

- `src/lib.rs` wraps imagequant and PNG encoding/decoding with wasm-bindgen. It exports `ImageQuantizer`, `QuantizationResult`, and PNG helpers.
- `src/index.ts` provides the promise-based `LibImageQuant` API, worker lifecycle, timeouts, and PNG/ImageData input handling.
- `src/worker.ts` loads the WASM module and processes quantization messages outside the main thread.
- `vite.config.ts` builds WASM with wasm-pack, bundles both JavaScript formats with Vite/Rolldown, and copies WASM assets to `dist/wasm/`.
- `tests/` covers the high-level API, low-level WASM exports, output integrity, color accuracy, and transparency using real WASM in a browser.
- `examples/` contains manual browser examples and the package structure validator.

## Validation and changes

- After dependency or build changes, run the full build, typecheck, package validation, browser tests, and Rust checks above.
- Preserve the package's ESM, CommonJS, worker, type declaration, and WASM exports in `package.json`.
- Keep build tooling portable: use executables from `PATH` and repository-relative paths.
- Update the README and this file when changing development commands or requirements. Generated `dist/`, `pkg/`, and `target/` output should not be committed.
