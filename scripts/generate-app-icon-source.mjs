import { readFileSync, writeFileSync } from 'node:fs';

// All packaged icons use the same artwork as the in-app logo.
const brand = readFileSync(new URL('../src/assets/brand-mark.svg', import.meta.url), 'utf8');
const viewBox = brand.match(/viewBox="([^"]+)"/)?.[1];
const artwork = brand.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/)?.[1];
if (!viewBox || !artwork) throw new Error('Invalid Tiker brand SVG');

export const appIconSource = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>Tiker App Icon</title>
  <rect x="64" y="64" width="896" height="896" rx="198.4" fill="#FFFFFF"/>
  <svg x="224" y="224" width="576" height="576" viewBox="${viewBox}">${artwork}</svg>
</svg>\n`);
writeFileSync(new URL('../src-tauri/icons/app-icon.svg', import.meta.url), appIconSource);
