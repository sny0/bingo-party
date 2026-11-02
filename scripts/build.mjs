import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const files = ['index.html', 'styles.css', 'app.js', 'src/bingo.js', 'icon.svg', 'manifest.webmanifest'];
const hash = createHash('sha256');
for (const file of files) {
  const target = resolve(output, file);
  if (!target.startsWith(output + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'))) throw new Error('Invalid build path');
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, file), target);
  hash.update(await readFile(target));
}
const revision = hash.digest('hex').slice(0, 12);
const worker = (await readFile(resolve(root, 'sw.js'), 'utf8')).replace('garagara-bingo-v1.0.0', 'garagara-bingo-' + revision);
await writeFile(resolve(output, 'sw.js'), worker);
await writeFile(resolve(output, '.nojekyll'), '');
const html = await readFile(resolve(output, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) {
  if (!files.includes(match[1])) throw new Error('Missing referenced asset: ' + match[1]);
}
console.log('Built ' + (files.length + 2) + ' files into dist/ · revision ' + revision);
