import assert from 'node:assert/strict';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

export function chunk(type, data = Buffer.alloc(0)) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  result.write(type, 4, 4, 'ascii');
  data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}

const passes = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];
function raster(samples, width, height, depth, color, interlaced) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  assert.equal(samples.length, width * height * channels);
  const rows = [];
  for (const [x0, y0, dx, dy] of interlaced ? passes : [[0, 0, 1, 1]]) {
    if (x0 >= width) continue;
    for (let y = y0; y < height; y += dy) {
      const values = [];
      for (let x = x0; x < width; x += dx)
        values.push(...samples.slice((y * width + x) * channels, (y * width + x + 1) * channels));
      const row = Buffer.alloc(1 + Math.ceil((values.length * depth) / 8));
      values.forEach((value, i) => {
        if (depth === 16) row.writeUInt16BE(value, 1 + i * 2);
        else if (depth === 8) row[1 + i] = value;
        else row[1 + Math.floor((i * depth) / 8)] |= value << (8 - depth - ((i * depth) % 8));
      });
      rows.push(row);
    }
  }
  return deflateSync(Buffer.concat(rows));
}

export function makeApng({
  width = 2,
  height = 1,
  frames,
  poster,
  numPlays = 0,
  colorType = 6,
  bitDepth = 8,
  palette,
  interlaced = false,
  declaredFrames = frames.length,
}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = colorType;
  header[12] = Number(interlaced);
  const control = Buffer.alloc(8);
  control.writeUInt32BE(declaredFrames);
  control.writeUInt32BE(numPlays, 4);
  const chunks = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('acTL', control),
  ];
  if (palette) {
    chunks.push(chunk('PLTE', Buffer.from(palette.flatMap((c) => c.slice(0, 3)))));
    chunks.push(chunk('tRNS', Buffer.from(palette.map((c) => c[3]))));
  }
  if (poster)
    chunks.push(chunk('IDAT', raster(poster, width, height, bitDepth, colorType, interlaced)));
  let sequence = 0;
  for (const [index, frame] of frames.entries()) {
    const w = frame.width ?? width,
      h = frame.height ?? height;
    const fc = Buffer.alloc(26);
    fc.writeUInt32BE(sequence++);
    fc.writeUInt32BE(w, 4);
    fc.writeUInt32BE(h, 8);
    fc.writeUInt32BE(frame.x ?? 0, 12);
    fc.writeUInt32BE(frame.y ?? 0, 16);
    fc.writeUInt16BE(frame.delay?.[0] ?? 1, 20);
    fc.writeUInt16BE(frame.delay?.[1] ?? 10, 22);
    fc[24] = frame.dispose ?? 0;
    fc[25] = frame.blend ?? 0;
    chunks.push(chunk('fcTL', fc));
    const data = raster(frame.samples, w, h, bitDepth, colorType, interlaced);
    if (index === 0 && !poster) chunks.push(chunk('IDAT', data));
    else {
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32BE(sequence++);
      chunks.push(chunk('fdAT', Buffer.concat([prefix, data])));
    }
  }
  chunks.push(chunk('IEND'));
  return Buffer.concat(chunks);
}

export function chunksOf(bytes) {
  const buffer = Buffer.from(bytes);
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    assert.equal(
      crc32(buffer.subarray(offset + 4, offset + 8 + length)),
      buffer.readUInt32BE(offset + 8 + length),
      `${type} CRC`,
    );
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Independent decoder for the encoder's 8-bit indexed, non-interlaced output.
// Node zlib + the five PNG filters provide an oracle outside the Rust decoder.
export function parseIndexedApng(bytes) {
  let width,
    height,
    palette,
    alpha,
    numPlays,
    numFrames,
    current,
    sequence = 0;
  const frames = [],
    defaults = [];
  for (const { type, data } of chunksOf(bytes)) {
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.deepEqual([...data.subarray(8)], [8, 3, 0, 0, 0]);
    } else if (type === 'PLTE')
      palette = Array.from({ length: data.length / 3 }, (_, i) => [
        ...data.subarray(i * 3, i * 3 + 3),
        255,
      ]);
    else if (type === 'tRNS') alpha = data;
    else if (type === 'acTL') {
      numFrames = data.readUInt32BE(0);
      numPlays = data.readUInt32BE(4);
    } else if (type === 'fcTL') {
      assert.equal(data.readUInt32BE(0), sequence++);
      current = {
        width: data.readUInt32BE(4),
        height: data.readUInt32BE(8),
        x: data.readUInt32BE(12),
        y: data.readUInt32BE(16),
        delay: [data.readUInt16BE(20), data.readUInt16BE(22)],
        dispose: data[24],
        blend: data[25],
        parts: [],
      };
      frames.push(current);
    } else if (type === 'IDAT') {
      defaults.push(data);
      if (current) current.parts.push(data);
    } else if (type === 'fdAT') {
      assert.equal(data.readUInt32BE(0), sequence++);
      current.parts.push(data.subarray(4));
    }
  }
  assert.equal(frames.length, numFrames);
  if (alpha)
    alpha.forEach((a, i) => {
      palette[i][3] = a;
    });
  function decode(parts, w, h) {
    const data = inflateSync(Buffer.concat(parts)),
      indices = new Uint8Array(w * h);
    assert.equal(data.length, (w + 1) * h);
    for (let y = 0; y < h; y++) {
      const filter = data[y * (w + 1)];
      assert(filter <= 4);
      for (let x = 0; x < w; x++) {
        const a = x ? indices[y * w + x - 1] : 0,
          b = y ? indices[(y - 1) * w + x] : 0,
          c = x && y ? indices[(y - 1) * w + x - 1] : 0;
        const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
        indices[y * w + x] = (data[y * (w + 1) + 1 + x] + predictor) & 255;
      }
    }
    return [...indices].flatMap((i) => {
      assert(i < palette.length);
      return palette[i];
    });
  }
  const poster = decode(defaults, width, height);
  for (const frame of frames) frame.pixels = decode(frame.parts, frame.width, frame.height);
  return { width, height, palette, numPlays, frames, poster };
}

export const red = [255, 0, 0, 255],
  green = [0, 255, 0, 255],
  blue = [0, 0, 255, 255],
  clear = [0, 0, 0, 0];
export function compositingApng() {
  return makeApng({
    width: 2,
    height: 1,
    numPlays: 3,
    frames: [
      { samples: [...red, ...red], delay: [2, 0] },
      { width: 1, x: 1, samples: [0, 0, 255, 128], blend: 1, dispose: 2, delay: [1, 5] },
      { width: 1, x: 0, samples: green, dispose: 1, delay: [3, 100] },
      { width: 1, x: 1, samples: blue, delay: [0, 1000] },
    ],
  });
}

// Wrap the real worker's sender to distinguish transfers from structured clones.
// This function is serialized into both browser and Node test workers.
export function inspectTransfers(send) {
  return (message, transfer) => {
    const result = message.result;
    const buffers = result
      ? [
          ...new Set([
            result.pngBytes.buffer,
            result.imageData.data.buffer,
            ...result.animation.frames.flatMap((frame) =>
              frame.imageData ? [frame.imageData.data.buffer] : [],
            ),
          ]),
        ]
      : [];
    send(message, transfer);
    if (result)
      send({
        type: 'transfer-inspection',
        expected: buffers.length,
        supplied: transfer.length,
        detached: buffers.every((buffer) => buffer.byteLength === 0),
      });
  };
}
export const compositedPixels = [
  [...red, ...red],
  [...red, 127, 0, 128, 255],
  [...green, ...red],
  [...clear, ...blue],
];
