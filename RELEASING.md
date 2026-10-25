# Releasing

Use the contributor toolchains and test browser described in [DEVELOPMENT.md](DEVELOPMENT.md). Update the version in `package.json` and `Cargo.toml`, refresh the root
package entry in `Cargo.lock` with Cargo, and commit all changes on `main`.
Releases require an explicit stable `major.minor.patch` version newer than the
published npm versions.

The commands below use `0.4.1` as an example; substitute the version being released.

```bash
# Authenticate outside the repo's pnpm-only contributor checks
(cd /tmp && npm login --registry=https://registry.npmjs.org/)

# Run the complete pipeline without tagging, pushing, or publishing
pnpm release 0.4.1 --dry-run

# Validate, tag, push main and its tag atomically, and publish to npm
pnpm release 0.4.1
```

The command checks the version in all three manifests, the clean working tree,
local/remote tag conflicts, npm versions, and whether `origin/main` can advance
without a force push. It installs with the frozen lockfile, runs oxfmt, oxlint,
rustfmt, native/WASM Clippy, TypeScript checks, release-workflow tests, a production
build, browser tests, native Rust tests, and package validation.

It then packs a staged copy with the source `gitHead`, runs the integration suite
against that exact tarball (including an installed npm consumer), and checks an
npm publication dry run. Only after validation does it create the annotated
`v<version>` tag, atomically push the commit to `origin/main` and its tag, and
publish the tested archive as `latest`. Publication skips lifecycle scripts so
nothing rebuilds after validation; the registry's commit and SHA-512 integrity
must match the artifact.

Artifacts and release metadata are retained under the ignored `releases/`
directory. If publication fails after the tag push, fix authentication or the
reported failure and retry the same command at the same commit. Matching tags
are reused; conflicting tags are never moved. A confirmed, already published
release is reported without publishing it again. npm credentials come from your
user configuration or environment; npm runs outside the repo so `devEngines`
does not block authentication or tarball publishing. npm may request publishing
2FA in your terminal.

npm may accept an upload before the version becomes available. The command records
that acceptance and waits up to ten minutes for registry confirmation. If processing
takes longer, rerun at the same commit to verify the recorded submission without
building or publishing it again. Preserve `releases/v<version>.json` when retrying.
