import spawn from 'cross-spawn';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repository = fileURLToPath(new URL('../', import.meta.url));
const registry = 'https://registry.npmjs.org/';

export function parseArguments(args) {
  const dryRun = args.includes('--dry-run');
  const positional = args.filter((arg) => arg !== '--dry-run');
  if (positional.length !== 1 || args.length !== positional.length + Number(dryRun)) {
    throw new Error('Usage: pnpm release <major.minor.patch> [--dry-run]');
  }
  stableVersion(positional[0]);
  return { version: positional[0], dryRun };
}

function stableVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Releases require a stable major.minor.patch version without leading zeros');
  }
  const components = version.split('.').map(BigInt);
  if (version.length > 256 || components.some((value) => value > BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new Error('Version exceeds npm semver limits');
  }
  return components;
}

export function compareVersions(left, right) {
  const a = stableVersion(left),
    b = stableVersion(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function run(command, args, { cwd = repository, capture = false, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '',
      stderr = '';
    if (capture) {
      child.stdout.setEncoding('utf8').on('data', (data) => {
        stdout += data;
      });
      child.stderr.setEncoding('utf8').on('data', (data) => {
        stderr += data;
      });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(
            `${command} ${args.join(' ')} failed (${code})${stderr ? `\n${stderr.trim()}` : ''}`,
          ),
        );
    });
  });
}

async function readRegistry(name) {
  const response = await fetch(`${registry}${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(15000),
    headers: { 'cache-control': 'no-cache' },
  });
  if (response.status === 404) return { versions: {} };
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  return response.json();
}

export async function release(
  { version, dryRun = false },
  { root = repository, execute = run, getRegistry = readRegistry, log = console.log } = {},
) {
  stableVersion(version);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'libimagequant-wasm' || pkg.private || pkg.version !== version) {
    throw new Error(
      `Expected public libimagequant-wasm@${version}; package.json declares ${pkg.name}@${pkg.version}`,
    );
  }
  const command = (name, args, options = {}) => execute(name, args, { cwd: root, ...options });
  const git = (args) => command('git', args, { capture: true });
  const assertClean = async () => {
    const changes = await git(['status', '--porcelain', '--untracked-files=normal']);
    if (changes)
      throw new Error(`Commit or remove all working tree changes before releasing:\n${changes}`);
  };
  await assertClean();
  if ((await git(['branch', '--show-current'])) !== 'main')
    throw new Error('Releases must run on main');
  const head = await git(['rev-parse', 'HEAD']);
  const tag = `v${version}`,
    tagRef = `refs/tags/${tag}`;
  const hasLocalTag = (await git(['tag', '--list', tag])).split('\n').includes(tag);
  if (hasLocalTag && (await git(['rev-parse', `${tagRef}^{commit}`])) !== head)
    throw new Error(`${tag} already tags a different commit locally`);
  const refs = await git(['ls-remote', '--tags', 'origin', tagRef, `${tagRef}^{}`]);
  const remoteRefs = new Map(
    refs
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(/\s+/).toReversed()),
  );
  const remoteTag = remoteRefs.get(`${tagRef}^{}`) ?? remoteRefs.get(tagRef);
  if (remoteTag && remoteTag !== head)
    throw new Error(`${tag} already tags a different commit on origin`);

  const metadata = JSON.parse(
    await command('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], {
      capture: true,
    }),
  );
  const crate = metadata.packages.find((entry) => entry.name === pkg.name);
  const lock = (await readFile(join(root, 'Cargo.lock'), 'utf8'))
    .split('[[package]]')
    .find((block) => block.match(/^name\s*=\s*"([^"]+)"/m)?.[1] === pkg.name);
  if (crate?.version !== version || lock?.match(/^version\s*=\s*"([^"]+)"/m)?.[1] !== version) {
    throw new Error('package.json, Cargo.toml, and Cargo.lock versions must agree');
  }
  const published = await getRegistry(pkg.name);
  const existing = published.versions?.[version];
  if (existing) {
    if (existing.gitHead === head && remoteTag === head) {
      let recorded;
      try {
        recorded = JSON.parse(await readFile(join(root, 'releases', `${tag}.json`), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (recorded?.gitHead === head && existing.dist?.integrity !== recorded.integrity) {
        throw new Error('Published integrity does not match the recorded release artifact');
      }
      log(`${pkg.name}@${version} is already published and tagged at ${head}`);
      return;
    }
    throw new Error(
      `${pkg.name}@${version} is already published; bump the version or inspect its gitHead and tag`,
    );
  }
  for (const previous of Object.keys(published.versions ?? {})) {
    if (/^\d+\.\d+\.\d+$/.test(previous) && compareVersions(version, previous) <= 0) {
      throw new Error(`${version} must be newer than published version ${previous}`);
    }
  }
  await git(['fetch', '--no-tags', 'origin', 'main']);
  const remoteMain = (await git(['ls-remote', '--heads', 'origin', 'refs/heads/main'])).split(
    /\s+/,
  )[0];
  if (!remoteMain) throw new Error('origin/main does not exist');
  await git(['merge-base', '--is-ancestor', remoteMain, head]);

  const artifacts = join(root, 'releases');
  const work = await mkdtemp(join(tmpdir(), 'libimagequant-release-'));
  let archive;
  try {
    // npm runs outside the pnpm-only repository, using the user's npm auth.
    if (!dryRun) await command('npm', ['whoami', `--registry=${registry}`], { cwd: work });
    await command('pnpm', ['install', '--frozen-lockfile']);
    for (const script of ['lint', 'test:release', 'build', 'test', 'test:package']) {
      log(`Release check: ${script}`);
      await command('pnpm', ['run', script]);
    }
    await command('cargo', ['test', '--locked']);
    const stage = join(work, 'package');
    await mkdir(stage);
    for (const entry of ['dist', 'README.md', 'LICENSE'])
      await cp(join(root, entry), join(stage, entry), { recursive: true });
    await writeFile(
      join(stage, 'package.json'),
      `${JSON.stringify({ ...pkg, gitHead: head }, null, 2)}\n`,
    );
    await mkdir(artifacts, { recursive: true });
    const [packed] = JSON.parse(
      await command(
        'npm',
        ['pack', stage, '--ignore-scripts', '--json', '--pack-destination', artifacts],
        { cwd: work, capture: true },
      ),
    );
    if (packed.name !== pkg.name || packed.version !== version)
      throw new Error('Packed artifact identity does not match the release');
    archive = join(artifacts, packed.filename);
    const paths = new Set(packed.files.map((file) => file.path));
    const targets = (value) =>
      typeof value === 'string' ? [value] : Object.values(value ?? {}).flatMap(targets);
    for (const target of [...targets(pkg.exports), pkg.main, pkg.module, pkg.types].filter(
      Boolean,
    )) {
      if (!paths.has(target.replace(/^\.\//, '')))
        throw new Error(`Published entry is missing from archive: ${target}`);
    }
    const bytes = await readFile(archive);
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    if (integrity !== packed.integrity) throw new Error('Packed artifact integrity mismatch');
    await command('pnpm', ['run', 'test:integration'], {
      env: { ...process.env, RELEASE_TARBALL: archive },
    });
    await command(
      'npm',
      [
        'publish',
        archive,
        '--dry-run',
        '--ignore-scripts',
        '--access=public',
        '--tag=latest',
        `--registry=${registry}`,
      ],
      { cwd: work },
    );
    await assertClean();
    if ((await git(['rev-parse', 'HEAD'])) !== head)
      throw new Error('HEAD changed during release validation');
    await writeFile(
      join(artifacts, `${tag}.json`),
      `${JSON.stringify({ name: pkg.name, version, gitHead: head, tag, integrity, archive }, null, 2)}\n`,
    );
    if (dryRun) {
      log(
        `Dry run passed. Artifact: ${archive}\nNo tags, branch updates, or npm publication were made.`,
      );
      return;
    }
    if (!hasLocalTag) {
      if (remoteTag) await git(['fetch', '--no-tags', 'origin', `${tagRef}:${tagRef}`]);
      else await git(['tag', '-a', tag, head, '-m', `Release ${version}`]);
    }
    if ((await git(['rev-parse', `${tagRef}^{commit}`])) !== head)
      throw new Error('Release tag changed during validation');
    // Atomic push prevents publishing a tag while its branch push is rejected.
    await command('git', [
      'push',
      '--atomic',
      'origin',
      `${head}:refs/heads/main`,
      `${tagRef}:${tagRef}`,
    ]);
    if (
      `sha512-${createHash('sha512')
        .update(await readFile(archive))
        .digest('base64')}` !== integrity
    )
      throw new Error('Release archive changed after validation');
    await command(
      'npm',
      [
        'publish',
        archive,
        '--ignore-scripts',
        '--access=public',
        '--tag=latest',
        `--registry=${registry}`,
      ],
      { cwd: work },
    );
    let confirmed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const publishedRelease = (await getRegistry(pkg.name)).versions?.[version];
      if (publishedRelease?.gitHead === head && publishedRelease?.dist?.integrity === integrity) {
        confirmed = true;
        break;
      }
      if (attempt < 4) await delay(1000);
    }
    if (!confirmed) {
      throw new Error(
        'npm publication returned, but registry gitHead/integrity are not yet confirmed. Re-run the release command to check.',
      );
    }
    log(`Published ${pkg.name}@${version}; ${tag} points to ${head}.\nArtifact: ${archive}`);
  } catch (error) {
    if (archive)
      log(
        `Preserved artifact: ${archive}. Retry with pnpm release ${version} after correcting the failure; existing matching tags are reused.`,
      );
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await release(parseArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
