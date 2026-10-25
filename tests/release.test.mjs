import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { release, run, parseArguments, compareVersions } from '../scripts/release.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'libimagequant-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'repo'),
    remote = join(directory, 'origin.git');
  await mkdir(root);
  const git = (args) => run('git', args, { cwd: root, capture: true });
  await git(['init', '--initial-branch=main']);
  await git(['config', 'user.name', 'Release Test']);
  await git(['config', 'user.email', 'release@example.invalid']);
  await git(['init', '--bare', remote]);
  await git(['remote', 'add', 'origin', remote]);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/lib.rs'), 'pub fn placeholder() {}\n');
  await writeFile(join(root, '.gitignore'), 'dist/\ntarget/\nreleases/\n');
  await writeFile(join(root, 'README.md'), '# Fixture\n');
  await writeFile(join(root, 'LICENSE'), 'MIT\n');
  const setVersion = async (version) => {
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'libimagequant-wasm',
        version,
        type: 'module',
        files: ['dist/', 'README.md', 'LICENSE'],
        scripts: { prepack: 'node -e "throw new Error(\'hooks must not run\')"' },
      }),
    );
    await writeFile(
      join(root, 'Cargo.toml'),
      `[package]\nname = "libimagequant-wasm"\nversion = "${version}"\nedition = "2021"\n`,
    );
    await writeFile(
      join(root, 'Cargo.lock'),
      `version = 4\n\n[[package]]\nname = "libimagequant-wasm"\nversion = "${version}"\n`,
    );
  };
  await setVersion('0.3.0');
  await git(['add', '.']);
  await git(['commit', '-m', 'previous release']);
  await git(['tag', '-a', 'v0.3.0', '-m', 'previous']);
  await git(['push', 'origin', 'main', 'v0.3.0']);
  await setVersion('0.4.0');
  await git(['add', '.']);
  await git(['commit', '-m', 'version 0.4.0']);
  const head = await git(['rev-parse', 'HEAD']);
  const calls = [],
    state = { versions: { '0.3.0': {} } };
  let packed;
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'pnpm') {
      if (args[1] === 'build') {
        await mkdir(join(root, 'dist'), { recursive: true });
        await writeFile(join(root, 'dist/index.mjs'), 'export default 42;\n');
      }
      return '';
    }
    if (command === 'npm') {
      assert.notEqual(options.cwd, root, 'npm must run outside the pnpm-only project');
      if (args[0] === 'whoami') return 'fixture-user';
      if (args[0] === 'publish') {
        assert(args.includes('--ignore-scripts'));
        if (!args.includes('--dry-run'))
          state.versions['0.4.0'] = { gitHead: head, dist: { integrity: packed.integrity } };
        return '';
      }
      const manifest = JSON.parse(await readFile(join(args[1], 'package.json'), 'utf8'));
      assert.equal(manifest.gitHead, head, 'the tarball must record its source commit');
      const output = await run(command, args, {
        ...options,
        env: { ...process.env, npm_config_cache: join(directory, 'npm-cache') },
      });
      [packed] = JSON.parse(output);
      return output;
    }
    return run(command, args, { ...options, capture: true });
  };
  const dependencies = {
    root,
    execute,
    getRegistry: () => Promise.resolve(structuredClone(state)),
    log() {},
  };
  return { root, git, head, calls, state, dependencies };
}

const publications = (calls) =>
  calls.filter(
    ({ command, args }) =>
      command === 'npm' && args[0] === 'publish' && !args.includes('--dry-run'),
  );

test('requires an explicit stable version and rejects ambiguous CLI arguments', () => {
  assert.deepEqual(parseArguments(['0.4.0', '--dry-run']), { version: '0.4.0', dryRun: true });
  for (const args of [
    [],
    ['v0.4.0'],
    ['0.04.0'],
    ['0.4.0-beta.1'],
    ['0.4.0', '--force'],
    ['9007199254740992.0.0'],
    ['0.4.0', '--dry-run', '--dry-run'],
  ]) {
    assert.throws(() => parseArguments(args));
  }
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareVersions('0.4.0', '0.4.0'), 0);
});

test('dry run packs and tests the artifact without changing remote refs or publishing', async (t) => {
  const f = await fixture(t);
  const before = await f.git(['ls-remote', 'origin']);
  await release({ version: '0.4.0', dryRun: true }, f.dependencies);
  assert.equal(await f.git(['ls-remote', 'origin']), before);
  assert.equal(await f.git(['tag', '--list', 'v0.4.0']), '');
  assert.equal(publications(f.calls).length, 0);
  const integration = f.calls.find((call) => call.args[1] === 'test:integration');
  await access(integration.options.env.RELEASE_TARBALL);
  assert.equal(await f.git(['status', '--porcelain']), '');
});

test('publishes the tested archive after atomically pushing its annotated tag and commit', async (t) => {
  const f = await fixture(t);
  await release({ version: '0.4.0' }, f.dependencies);
  assert.equal(await f.git(['cat-file', '-t', 'v0.4.0']), 'tag');
  assert.equal(await f.git(['rev-parse', 'v0.4.0^{commit}']), f.head);
  assert.match(await f.git(['ls-remote', 'origin', 'refs/heads/main']), new RegExp(f.head));
  assert.match(await f.git(['ls-remote', 'origin', 'refs/tags/v0.4.0^{}']), new RegExp(f.head));
  const [publish] = publications(f.calls);
  const integration = f.calls.find((call) => call.args[1] === 'test:integration');
  assert.equal(publish.args[1], integration.options.env.RELEASE_TARBALL);
  const push = f.calls.findIndex((call) => call.command === 'git' && call.args[0] === 'push');
  assert(f.calls[push].args.includes('--atomic'));
  assert(push < f.calls.indexOf(publish));
  const before = f.calls.length;
  await release({ version: '0.4.0' }, f.dependencies);
  assert.equal(
    publications(f.calls.slice(before)).length,
    0,
    'retry after success must not republish',
  );
});

test('a failed lint check prevents packing, tagging, pushing, and publishing', async (t) => {
  const f = await fixture(t);
  const execute = async (command, args, options) => {
    if (command === 'pnpm' && args[1] === 'lint') throw new Error('fixture lint failure');
    return f.dependencies.execute(command, args, options);
  };
  await assert.rejects(
    release({ version: '0.4.0' }, { ...f.dependencies, execute }),
    /lint failure/,
  );
  assert.equal(await f.git(['tag', '--list', 'v0.4.0']), '');
  assert.equal(publications(f.calls).length, 0);
});

test('publication failure preserves the archive and matching remote tag for a retry', async (t) => {
  const f = await fixture(t);
  const execute = async (command, args, options) => {
    if (command === 'npm' && args[0] === 'publish' && !args.includes('--dry-run'))
      throw new Error('fixture auth failure');
    return f.dependencies.execute(command, args, options);
  };
  await assert.rejects(
    release({ version: '0.4.0' }, { ...f.dependencies, execute }),
    /auth failure/,
  );
  await access(join(f.root, 'releases/libimagequant-wasm-0.4.0.tgz'));
  assert.equal(await f.git(['rev-parse', 'v0.4.0^{commit}']), f.head);
  const originalTag = await f.git(['rev-parse', 'v0.4.0']);
  await f.git(['tag', '-d', 'v0.4.0']);
  await release({ version: '0.4.0' }, f.dependencies);
  assert.equal(await f.git(['rev-parse', 'v0.4.0']), originalTag, 'reuse the remote annotation');
  assert.equal(publications(f.calls).length, 1);
});

test('an already published release must match its recorded artifact integrity', async (t) => {
  const f = await fixture(t);
  await release({ version: '0.4.0' }, f.dependencies);
  f.state.versions['0.4.0'].dist.integrity = 'sha512-wrong';
  await assert.rejects(release({ version: '0.4.0' }, f.dependencies), /Published integrity/);
  assert.equal(publications(f.calls).length, 1);
});

test('rejects an existing version or a tag at another commit', async (t) => {
  const f = await fixture(t);
  f.state.versions['0.4.0'] = { gitHead: 'wrong-commit' };
  await assert.rejects(release({ version: '0.4.0' }, f.dependencies), /already published/);
  delete f.state.versions['0.4.0'];
  await f.git(['tag', 'v0.4.0', 'HEAD~1']);
  await assert.rejects(release({ version: '0.4.0' }, f.dependencies), /different commit/);
  assert.equal(publications(f.calls).length, 0);
});

test('rejects dirty trees, version mismatches, and older release versions', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'untracked.txt'), 'dirty');
  await assert.rejects(release({ version: '0.4.0' }, f.dependencies), /working tree/);
  await rm(join(f.root, 'untracked.txt'));
  await assert.rejects(release({ version: '0.4.1' }, f.dependencies), /package.json declares/);
  f.state.versions['0.5.0'] = {};
  await assert.rejects(release({ version: '0.4.0' }, f.dependencies), /newer than/);
  delete f.state.versions['0.5.0'];
  await writeFile(join(f.root, 'Cargo.lock'), 'version = 4\n');
  await f.git(['add', 'Cargo.lock']);
  await f.git(['commit', '-m', 'mismatched lock version']);
  await assert.rejects(release({ version: '0.4.0' }, f.dependencies), /versions must agree/);
});

test('detects HEAD changing during checks before creating public refs', async (t) => {
  const f = await fixture(t);
  const execute = async (command, args, options) => {
    const output = await f.dependencies.execute(command, args, options);
    if (command === 'pnpm' && args[1] === 'test:integration')
      await f.git(['commit', '--allow-empty', '-m', 'concurrent change']);
    return output;
  };
  await assert.rejects(
    release({ version: '0.4.0' }, { ...f.dependencies, execute }),
    /HEAD changed/,
  );
  assert.equal(await f.git(['tag', '--list', 'v0.4.0']), '');
  assert.equal(publications(f.calls).length, 0);
});

test('a rejected atomic push prevents npm publication', async (t) => {
  const f = await fixture(t);
  const execute = async (command, args, options) => {
    if (command === 'git' && args[0] === 'push') throw new Error('fixture push rejected');
    return f.dependencies.execute(command, args, options);
  };
  await assert.rejects(
    release({ version: '0.4.0' }, { ...f.dependencies, execute }),
    /push rejected/,
  );
  assert.equal(await f.git(['ls-remote', 'origin', 'refs/tags/v0.4.0']), '');
  assert.equal(publications(f.calls).length, 0);
});

test('a conflicting remote tag is refused even when it is missing locally', async (t) => {
  const f = await fixture(t);
  await f.git(['tag', 'v0.4.0', 'HEAD~1']);
  await f.git(['push', 'origin', 'v0.4.0']);
  await f.git(['tag', '-d', 'v0.4.0']);
  await assert.rejects(release({ version: '0.4.0' }, f.dependencies), /different commit on origin/);
  assert.equal(publications(f.calls).length, 0);
});
