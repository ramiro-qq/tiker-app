import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';

// Share the in-app logo directly so extension builds cannot retain old artwork.
const image = await loadImage(readFileSync(new URL('../src/assets/brand-mark.svg', import.meta.url)));
const directory = new URL('../browser-extension/icons/', import.meta.url);
mkdirSync(directory, { recursive: true });
for (const size of [16, 24, 32, 48, 128]) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  context.fillStyle = '#FFFFFF';
  context.beginPath();
  context.roundRect(size / 16, size / 16, size * 7 / 8, size * 7 / 8, size * 0.19375);
  context.fill();
  const scale = size * 0.5625 / Math.max(image.width, image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  writeFileSync(new URL(`${size}.png`, directory), canvas.toBuffer('image/png'));
}
