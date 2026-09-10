import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(projectRoot, 'dist');
const assetsDir = join(distDir, 'assets');
let html = await readFile(join(distDir, 'index.html'), 'utf8');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const fileName of await readdir(assetsDir)) {
  const assetPath = `./assets/${fileName}`;
  if (fileName.endsWith('.css')) {
    const css = await readFile(join(assetsDir, fileName), 'utf8');
    html = html.replace(new RegExp(`<link[^>]+href=["']${escapeRegExp(assetPath)}["'][^>]*>`), `<style>${css}</style>`);
  }
  if (fileName.endsWith('.js')) {
    const script = await readFile(join(assetsDir, fileName), 'utf8');
    html = html.replace(new RegExp(`<script[^>]+src=["']${escapeRegExp(assetPath)}["'][^>]*><\\/script>`), `<script type="module">${script}</script>`);
  }
}

const outputDir = join(projectRoot, 'release');
await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, '街巷轨迹.html'), html, 'utf8');
await copyFile(join(outputDir, '街巷轨迹.html'), join(distDir, '街巷轨迹.html'));
console.log(`单文件已生成：${join(outputDir, '街巷轨迹.html')}`);
