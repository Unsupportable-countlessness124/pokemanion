// Writing a PNG, so prepared frames can be handed to an external renderer.
//
// We decode sprites ourselves, recover their real resolution and knock out
// painted-in backgrounds — none of which chafa does. But chafa is far better at
// choosing glyphs than anything hand-rolled, and it reads files, not pipes of
// raw pixels. So the corrected frames go back out as PNGs.
//
// Only what is needed: 8-bit RGBA, no interlacing, filter type 0 on every row.

import { deflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

// The CRC32 the PNG spec requires on every chunk.
const CRC_TABLE = (() => {
  const table = new Int32Array(256)

  for (let n = 0; n < 256; n++) {
    let c = n

    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1

    table[n] = c
  }

  return table
})()

const crc32 = (buffer) => {
  let c = 0xffffffff

  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)

  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, body) => {
  const length = Buffer.alloc(4)

  length.writeUInt32BE(body.length)

  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const crc = Buffer.alloc(4)

  crc.writeUInt32BE(crc32(typed))

  return Buffer.concat([length, typed, crc])
}

export const encodePng = (pixels, width, height) => {
  const header = Buffer.alloc(13)

  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace

  // Every scanline is prefixed with its filter type. Zero means "stored as is",
  // which costs a little size and saves predicting anything.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)

  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
