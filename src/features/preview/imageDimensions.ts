// Header-only dimensions: reject unknown layouts rather than decode unbounded pixel buffers.
export function imageDimensions(b: Uint8Array): { width: number; height: number } | null {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength); const ascii = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
  if (b.length >= 24 && d.getUint32(0) === 0x89504e47 && ascii(12, 4) === 'IHDR') return { width: d.getUint32(16), height: d.getUint32(20) };
  if (b.length >= 10 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return { width: d.getUint16(6, true), height: d.getUint16(8, true) };
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    if (kind === 'VP8X') return { width: 1 + b[24] + (b[25] << 8) + (b[26] << 16), height: 1 + b[27] + (b[28] << 8) + (b[29] << 16) };
    if (kind === 'VP8 ' && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) return { width: d.getUint16(26, true) & 0x3fff, height: d.getUint16(28, true) & 0x3fff };
    if (kind === 'VP8L' && b[20] === 0x2f) { const bits = d.getUint32(21, true); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }; }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 8 < b.length) {
      if (b[at] !== 0xff) break; const marker = b[at + 1]; if (marker === 0xff) { at++; continue; }
      const length = d.getUint16(at + 2); if (length < 2) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: d.getUint16(at + 7), height: d.getUint16(at + 5) };
      at += 2 + length;
    }
  }
  return null;
}
