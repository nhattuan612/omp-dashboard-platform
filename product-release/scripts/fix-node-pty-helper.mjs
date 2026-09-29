import { chmod } from 'node:fs/promises';
import { join } from 'node:path';

if (process.platform !== 'win32') {
  const packageRoot = new URL('../node_modules/node-pty/', import.meta.url);
  let fixed = false;
  for (const relative of ['build/Release/spawn-helper', 'build/Debug/spawn-helper', `prebuilds/${process.platform}-${process.arch}/spawn-helper`]) {
    try { await chmod(new URL(relative, packageRoot), 0o700); fixed = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!fixed) throw new Error('node-pty spawn-helper is missing');
}
