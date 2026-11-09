const zlib = require('node:zlib');

function createStoreItIconBuffer(size = 64) {
  const width = size;
  const height = size;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  const glyph = [0b11111, 0b10000, 0b10000, 0b11111, 0b00001, 0b00001, 0b11111];
  const scale = Math.max(1, Math.floor(size / 10));
  const glyphLeft = Math.floor((width - 5 * scale) / 2);
  const glyphTop = Math.floor((height - glyph.length * scale) / 2);
  const center = size / 2;
  const radius = size * 0.47;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const insideTile = (x - center) ** 2 + (y - center) ** 2 < radius ** 2;
      let color = insideTile ? [30, 58, 47, 255] : [0, 0, 0, 0];
      const glyphX = Math.floor((x - glyphLeft) / scale);
      const glyphY = Math.floor((y - glyphTop) / scale);
      if (glyphX >= 0 && glyphX < 5 && glyphY >= 0 && glyphY < glyph.length &&
          (glyph[glyphY] & (1 << (4 - glyphX)))) {
        color = [249, 246, 240, 255];
      }
      rows.set(color, pixelOffset);
    }
  }

  const crcTable = Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return crc >>> 0;
  });
  const chunk = (type, data) => {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const payload = Buffer.concat([name, data]);
    let crc = 0xffffffff;
    for (const byte of payload) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, payload, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { createStoreItIconBuffer };
