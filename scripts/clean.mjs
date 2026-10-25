import { rm } from 'node:fs/promises';

for (const directory of ['dist', 'pkg']) {
  await rm(new URL(`../${directory}/`, import.meta.url), { recursive: true, force: true });
}
