const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICON_SIZES = [16, 48, 128];
const SUPERSAMPLE = 4;

const COLORS = {
  transparent: [0, 0, 0, 0],
  youtubeRed: [255, 0, 0, 255],
  white: [255, 255, 255, 255],
  paper: [250, 250, 248, 255],
  paperShadow: [210, 214, 220, 255],
  fold: [226, 228, 232, 255],
  text: [48, 59, 74, 255],
  blue: [19, 113, 255, 255],
};

function generateIcon(size) {
  const canvasSize = size * SUPERSAMPLE;
  const image = createImage(canvasSize, canvasSize);
  const scale = canvasSize / 128;

  const s = value => value * scale;

  fillRoundedRect(image, s(14), s(26), s(78), s(58), s(14), COLORS.youtubeRed);
  fillPolygon(image, [
    [s(49), s(42)],
    [s(49), s(70)],
    [s(75), s(56)],
  ], COLORS.white);

  fillRoundedRect(image, s(64), s(42), s(44), s(58), s(6), COLORS.paperShadow);
  fillRoundedRect(image, s(61), s(39), s(44), s(58), s(6), COLORS.paper);
  fillPolygon(image, [
    [s(91), s(39)],
    [s(105), s(53)],
    [s(91), s(53)],
  ], COLORS.fold);

  fillCapsule(image, s(68), s(55), s(91), s(55), s(2.2), COLORS.text);
  fillCapsule(image, s(68), s(63), s(99), s(63), s(2.2), COLORS.text);
  fillCapsule(image, s(68), s(71), s(99), s(71), s(2.2), COLORS.text);
  fillCapsule(image, s(68), s(79), s(82), s(79), s(2.2), COLORS.text);

  fillCircle(image, s(94), s(86), s(19), COLORS.white);
  fillCircle(image, s(94), s(86), s(16.5), COLORS.blue);
  fillCapsule(image, s(86), s(82), s(98), s(82), s(1.6), COLORS.white);
  fillCapsule(image, s(86), s(87), s(98), s(87), s(1.6), COLORS.white);
  fillCapsule(image, s(86), s(92), s(99), s(92), s(1.6), COLORS.white);
  fillSparkle(image, s(102), s(76), s(8), COLORS.white);
  fillSparkle(image, s(109), s(86), s(5), COLORS.white);

  return downsample(image, size, size, SUPERSAMPLE);
}

function createImage(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = COLORS.transparent[0];
    data[index + 1] = COLORS.transparent[1];
    data[index + 2] = COLORS.transparent[2];
    data[index + 3] = COLORS.transparent[3];
  }
  return { width, height, data };
}

function blendPixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return;
  }

  const index = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  const alpha = color[3] / 255;
  const inverse = 1 - alpha;
  const existingAlpha = image.data[index + 3] / 255;
  const outputAlpha = alpha + existingAlpha * inverse;

  if (outputAlpha === 0) {
    return;
  }

  image.data[index] = Math.round((color[0] * alpha + image.data[index] * existingAlpha * inverse) / outputAlpha);
  image.data[index + 1] = Math.round((color[1] * alpha + image.data[index + 1] * existingAlpha * inverse) / outputAlpha);
  image.data[index + 2] = Math.round((color[2] * alpha + image.data[index + 2] * existingAlpha * inverse) / outputAlpha);
  image.data[index + 3] = Math.round(outputAlpha * 255);
}

function fillRoundedRect(image, x, y, width, height, radius, color) {
  const x2 = x + width;
  const y2 = y + height;

  for (let py = Math.floor(y); py <= Math.ceil(y2); py += 1) {
    for (let px = Math.floor(x); px <= Math.ceil(x2); px += 1) {
      const nearestX = Math.max(x + radius, Math.min(px, x2 - radius));
      const nearestY = Math.max(y + radius, Math.min(py, y2 - radius));
      const dx = px - nearestX;
      const dy = py - nearestY;

      if (px >= x + radius && px <= x2 - radius && py >= y && py <= y2) {
        blendPixel(image, px, py, color);
      } else if (py >= y + radius && py <= y2 - radius && px >= x && px <= x2) {
        blendPixel(image, px, py, color);
      } else if (dx * dx + dy * dy <= radius * radius) {
        blendPixel(image, px, py, color);
      }
    }
  }
}

function fillCircle(image, cx, cy, radius, color) {
  const radiusSquared = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radiusSquared) {
        blendPixel(image, x, y, color);
      }
    }
  }
}

function fillCapsule(image, x1, y1, x2, y2, radius, color) {
  const minX = Math.floor(Math.min(x1, x2) - radius);
  const maxX = Math.ceil(Math.max(x1, x2) + radius);
  const minY = Math.floor(Math.min(y1, y2) - radius);
  const maxY = Math.ceil(Math.max(y1, y2) + radius);
  const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / lengthSquared));
      const projectionX = x1 + t * (x2 - x1);
      const projectionY = y1 + t * (y2 - y1);
      const dx = x - projectionX;
      const dy = y - projectionY;

      if (dx * dx + dy * dy <= radius * radius) {
        blendPixel(image, x, y, color);
      }
    }
  }
}

function fillPolygon(image, points, color) {
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const minX = Math.floor(Math.min(...xs));
  const maxX = Math.ceil(Math.max(...xs));
  const minY = Math.floor(Math.min(...ys));
  const maxY = Math.ceil(Math.max(...ys));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (isInsidePolygon(x, y, points)) {
        blendPixel(image, x, y, color);
      }
    }
  }
}

function fillSparkle(image, cx, cy, radius, color) {
  fillPolygon(image, [
    [cx, cy - radius],
    [cx + radius * 0.25, cy - radius * 0.25],
    [cx + radius, cy],
    [cx + radius * 0.25, cy + radius * 0.25],
    [cx, cy + radius],
    [cx - radius * 0.25, cy + radius * 0.25],
    [cx - radius, cy],
    [cx - radius * 0.25, cy - radius * 0.25],
  ], color);
}

function isInsidePolygon(x, y, points) {
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function downsample(image, width, height, factor) {
  const data = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sums = [0, 0, 0, 0];

      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const sourceIndex = ((y * factor + sy) * image.width + (x * factor + sx)) * 4;
          sums[0] += image.data[sourceIndex];
          sums[1] += image.data[sourceIndex + 1];
          sums[2] += image.data[sourceIndex + 2];
          sums[3] += image.data[sourceIndex + 3];
        }
      }

      const targetIndex = (y * width + x) * 4;
      const area = factor * factor;
      data[targetIndex] = Math.round(sums[0] / area);
      data[targetIndex + 1] = Math.round(sums[1] / area);
      data[targetIndex + 2] = Math.round(sums[2] / area);
      data[targetIndex + 3] = Math.round(sums[3] / area);
    }
  }

  return { width, height, data };
}

function writePng(image, filename) {
  const chunks = [];
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  chunks.push(createChunk('IHDR', header));

  const rows = [];
  for (let y = 0; y < image.height; y += 1) {
    rows.push(Buffer.from([0]));
    rows.push(image.data.slice(y * image.width * 4, (y + 1) * image.width * 4));
  }

  chunks.push(createChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))));
  chunks.push(createChunk('IEND', Buffer.alloc(0)));

  fs.writeFileSync(filename, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...chunks,
  ]));
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

const iconsDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

for (const size of ICON_SIZES) {
  const filename = path.join(iconsDir, `icon-${size}.png`);
  writePng(generateIcon(size), filename);
  console.log(`Created ${filename}`);
}
