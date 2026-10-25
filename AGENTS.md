# Repository guidance

These instructions apply to all coding agents working in this repository.

## Toolchain and package management

- Use Node.js 24 LTS (the exact development version is in `.node-version`).
- Use the pnpm version pinned in `package.json`; commit `pnpm-lock.yaml` when dependencies change. Do not introduce other JavaScript lockfiles.
- Node.js and pnpm requirements belong in `devEngines`: they apply to contributors building and testing the repository. The published browser library does not require consumers to use those tools.
- Use the Rust version and `wasm32-unknown-unknown` target pinned in `rust-toolchain.toml`, with wasm-pack 0.15.0. Keep `Cargo.lock` committed and build against it with `--locked`.
- Install JavaScript dependencies with `pnpm install --frozen-lockfile`.
- Install the browser for tests with `pnpm exec playwright install chromium`.

## Commands

- `pnpm build` — clean and build WASM, ESM, CommonJS, source maps, and TypeScript declarations into `dist/`.
- `pnpm build:wasm` — build WASM into `pkg/` and copy the four public raw assets into `dist/wasm/`. Run the full build to refresh embedded worker bundles.
- `pnpm build:types` — generate TypeScript declarations.
- `pnpm format` — format with oxfmt and rustfmt. Generated output and lockfiles are excluded from oxfmt.
- `pnpm format:check` — check formatting without writing.
- `pnpm lint` — run formatting checks, oxlint, Clippy for native and WASM targets, and TypeScript checks.
- `pnpm typecheck` — check TypeScript without emitting files.
- `pnpm test` — run the Vitest suite in headless Chromium against the built output. Run `pnpm build` first.
- `pnpm test:watch` — run browser tests in watch mode.
- `pnpm test:package` — validate the built package's required files.
- `pnpm test:release` — test release safety against temporary real Git remotes, with npm publication simulated.
- `pnpm release <version> --dry-run` — validate and pack a release without public mutations.
- `pnpm release <version>` — run the validated release pipeline, atomically push main/tag, and publish the exact tarball to npm. Requires explicit publishing authorization.
- `pnpm test:integration` — run built-artifact and package-consumer regression tests after building.
- `cargo check --locked --target wasm32-unknown-unknown` — check the Rust WASM implementation.
- `cargo test --locked` — run native Rust tests (browser tests exercise the WASM API).
- `pnpm dev` / `pnpm serve` — start the Vite server on port 8080.
- `pnpm test:manual` — build and serve the examples; open `/examples/test.html`.
- `pnpm clean` — remove `dist/` and `pkg/`, preserving Rust's build cache. Use `cargo clean` to clear that cache explicitly.
- `./build.sh` — standalone WASM build into `pkg/`.

## Architecture

- `src/lib.rs` wraps imagequant and PNG encoding/decoding with wasm-bindgen. It exports `ImageQuantizer`, `QuantizationResult`, and PNG helpers.
- `src/index.ts` provides the browser `LibImageQuant` API and its embedded worker transport.
- `src/client.ts` shares worker lifecycle, timeouts, and input handling across browser and Node clients. `src/types.ts` contains DOM-free shared contracts.
- `src/node.ts` exposes the explicit `/node` entry point using `worker_threads`; `src/node-worker.ts` returns raw RGBA data without DOM globals. Node bundles may override the worker with an absolute URL to the `/node-worker` export.
- Node workers clear `execArgv` but inherit `NODE_OPTIONS` through the environment. Applications can supply `workerEnv` when preloads need a different environment.
- `src/quantize.ts` shares quantization and PNG conversion. `src/wasm.ts` shares the in-flight WASM loader.
- `src/worker.ts` loads the WASM module and processes quantization messages outside the main thread.
- `scripts/build-wasm.mjs` is the shared locked release build for Vite, `build:wasm`, and `build.sh`. wasm-pack runs the sole wasm-opt pass configured in Cargo.toml. Do not add a second optimizer or enable unused WASM proposals.
- `src/wasm-env.d.ts` provides module-local compatibility types prepended to generated WASM declarations. Keep browser-native WebAssembly types and Node consumers without DOM libraries working; do not introduce global DOM declarations.
- `vite.config.ts` embeds a self-contained browser worker and builds browser and Node entries separately with their appropriate platform targets. It assembles ESM, CommonJS, source maps, and raw WASM assets in `dist/`.
- `tests/` covers the high-level API, low-level WASM exports, output integrity, color accuracy, and transparency using real WASM in a browser, plus Node worker lifecycle, production bundles, strict declaration consumers, and installed package artifacts.
- `examples/` contains manual browser examples, the runnable Node PNG converter (`node examples/node.mjs input.png output.png`), and the package structure validator.

## Formatting and linting

- Use oxfmt and oxlint through the pinned pnpm toolchain. Do not add a second JavaScript formatter or linter.
- Oxlint enables TypeScript, Unicorn, Oxc, import, and promise rules; Node and Vitest plugins are scoped to their source/test files. Correctness and suspicious findings fail validation.
- Keep the worker-specific exceptions: worker `postMessage` has no Window `targetOrigin`, owned transports use single callback properties, ambient declaration files need empty module exports, and Vite provides the virtual worker's default export.
- Rust uses the pinned rustfmt/Clippy components. Keep lint checks read-only; use `pnpm format` explicitly to rewrite formatting.

## Releases

- Use `scripts/release.mjs` through `pnpm release`; versions in package.json, Cargo.toml, and Cargo.lock must match and be committed on main. The command supports stable versions and never bumps or force-tags automatically.
- `releases/` contains ignored artifacts and integrity metadata. Integration tests use `RELEASE_TARBALL` when validating a release so they install the archive that will actually be published.
- Run npm auth/publish commands outside the repository's pnpm-only devEngines. Use the documented subshell for login.
- After a failed publication, retry at the same commit; preserve matching tags and inspect conflicts. Never move a published release tag.
- npm can process accepted uploads asynchronously. Preserve release metadata: accepted submissions are retried by verification only, with up to ten minutes for registry visibility.

## Validation and changes

- After dependency or build changes, run the full build, typecheck, package validation, browser tests, and Rust checks above.
- Preserve the package's ESM, CommonJS, worker, type declaration, and WASM exports in `package.json`.
- Keep build tooling portable: use executables from `PATH` and repository-relative paths.
- Update the README and this file when changing development commands or requirements. Generated `dist/`, `pkg/`, and `target/` output should not be committed.
