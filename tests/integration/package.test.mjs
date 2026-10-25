import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

let directory;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'libimagequant-consumer-'));
  await mkdir(join(directory, 'node_modules'));
  await symlink(fileURLToPath(new URL('../../', import.meta.url)), join(directory, 'node_modules/libimagequant-wasm'));
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test('production bundlers preserve the exported worker setup', async () => {
  const entry = join(directory, 'worker.mjs');
  await writeFile(entry, "import 'libimagequant-wasm/worker';");
  const built = await build({
    configFile: false, root: directory, logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry, formats: ['es'] } },
  });
  const output = Array.isArray(built) ? built[0].output : built.output;
  const code = output.find(output => output.type === 'chunk').code;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const messages = [];
  const worker = { postMessage: message => messages.push(message) };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: worker });
  try {
    await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    assert.equal(typeof worker.onmessage, 'function');
    assert.deepEqual(messages, [{ type: 'ready' }]);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'self', previous);
    else delete globalThis.self;
  }
});
