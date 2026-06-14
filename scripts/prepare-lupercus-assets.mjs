import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const logoSvgPath = join(root, 'tools', 'lupercus-library-sync', 'public', 'lupercus-logo.svg');
const svg = readFileSync(logoSvgPath, 'utf8');
const marker = 'base64,';
const start = svg.indexOf(marker);

if (start < 0) {
  throw new Error(`Could not find embedded PNG data in ${logoSvgPath}`);
}

const remainder = svg.slice(start + marker.length);
const endQuote = remainder.search(/["']/);
const encoded = endQuote >= 0 ? remainder.slice(0, endQuote) : remainder.trim();
const iconBytes = Buffer.from(encoded, 'base64');
const assetRoot = join(root, 'electron-assets-lupercus');
const iconDir = join(assetRoot, 'icons');

mkdirSync(iconDir, { recursive: true });
writeFileSync(join(assetRoot, 'icon.png'), iconBytes);

for (const size of [16, 24, 32, 48, 64, 96, 128, 256, 512]) {
  writeFileSync(join(iconDir, `${size}x${size}.png`), iconBytes);
}

console.log('Prepared Lupercus Linux app icons in electron-assets-lupercus.');
