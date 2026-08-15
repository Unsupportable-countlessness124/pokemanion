// A PNG decoder, so sprites aren't limited to GIFs.
//
// Node ships zlib, which is the hard part of PNG. What's left is walking the
// chunks, undoing the per-scanline filters, and expanding whatever colour
// format the file happens to use into RGBA.

import { inflateSync } from 'node:zlib'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

const readUint32 = (bytes, at) =>
  (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]

// Paeth predicts a pixel from the one left, the one above, and the one above
// left, picking whichever the gradient points at.
const paeth = (left, up, upLeft) => {
  const estimate = left + up - upLeft
  const dLeft = Math.abs(estimate - left)
  const dUp = Math.abs(estimate - up)
  const dUpLeft = Math.abs(estimate - upLeft)

  if (dLeft <= dUp && dLeft <= dUpLeft) return left
  if (dUp <= dUpLeft) return up

  return upLeft
}

// Each scanline carries a filter byte saying how it was encoded relative to its
// neighbours. Undo it in place, top to bottom, since later rows depend on
// earlier ones already being restored.
const unfilter = (data, height, stride, bytesPerPixel) => {
  const out = new Uint8Array(stride * height)

  let at = 0

  for (let y = 0; y < height; y++) {
    const filter = data[at++]
    const row = y * stride
    const previous = row - stride

    for (let x = 0; x < stride; x++) {
      const raw = data[at + x]
      const left = x >= bytesPerPixel ? out[row + x - bytesPerPixel] : 0
      const up = y > 0 ? out[previous + x] : 0
      const upLeft = y > 0 && x >= bytesPerPixel ? out[previous + x - bytesPerPixel] : 0

      let value = raw

      if (filter === 1) value = raw + left
      else if (filter === 2) value = raw + up
      else if (filter === 3) value = raw + ((left + up) >> 1)
      else if (filter === 4) value = raw + paeth(left, up, upLeft)

      out[row + x] = value & 255
    }

    at += stride
  }

  return { pixels: out }
}

// Palette images can pack two, four or eight pixels into a byte.
const readIndex = (row, x, depth) => {
  if (depth === 8) return row[x]

  const perByte = 8 / depth
  const byte = row[Math.floor(x / perByte)]
  const shift = 8 - depth * ((x % perByte) + 1)

  return (byte >> shift) & ((1 << depth) - 1)
}

export const decodePng = (buffer) => {
  const bytes = new Uint8Array(buffer)

  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG')
  }

  let at = 8
  let width = 0
  let height = 0
  let depth = 8
  let colourType = 6
  let interlace = 0

  let palette = null
  let alphas = null
  const chunks = []

  while (at < bytes.length) {
    const length = readUint32(bytes, at)
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
    const body = at + 8

    if (type === 'IHDR') {
      width = readUint32(bytes, body)
      height = readUint32(bytes, body + 4)
      depth = bytes[body + 8]
      colourType = bytes[body + 9]
      interlace = bytes[body + 12]
    } else if (type === 'PLTE') {
      palette = bytes.subarray(body, body + length)
    } else if (type === 'tRNS') {
      alphas = bytes.subarray(body, body + length)
    } else if (type === 'IDAT') {
      chunks.push(bytes.subarray(body, body + length))
    } else if (type === 'IEND') {
      break
    }

    at = body + length + 4
  }

  if (interlace !== 0) throw new Error('interlaced PNGs are not supported')

  const compressed = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  const raw = new Uint8Array(inflateSync(compressed))

  // At depths below 8 a pixel is a fraction of a byte, so the row length and
  // the filter's step have to be worked out separately: the stride rounds up
  // over the whole row, while the filter always steps at least one whole byte.
  const channels = CHANNELS[colourType]
  const bitsPerPixel = channels * depth
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8))

  const { pixels: rows } = unfilter(raw, height, stride, bytesPerPixel)

  const out = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride)

    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4

      if (colourType === 3) {
        const index = readIndex(row, x, depth)

        out[to] = palette[index * 3]
        out[to + 1] = palette[index * 3 + 1]
        out[to + 2] = palette[index * 3 + 2]
        out[to + 3] = alphas && index < alphas.length ? alphas[index] : 255
        continue
      }

      const from = x * channels

      if (colourType === 0 || colourType === 4) {
        out[to] = row[from]
        out[to + 1] = row[from]
        out[to + 2] = row[from]
        out[to + 3] = colourType === 4 ? row[from + 1] : 255
        continue
      }

      out[to] = row[from]
      out[to + 1] = row[from + 1]
      out[to + 2] = row[from + 2]
      out[to + 3] = colourType === 6 ? row[from + 3] : 255
    }
  }

  return { width, height, frames: [{ pixels: out, delay: 100 }] }
}

// One entry point for either format, chosen by the file's own magic bytes.
export const decodeSprite = (buffer) => {
  const bytes = new Uint8Array(buffer)
  const isPng = SIGNATURE.every((value, index) => bytes[index] === value)

  return isPng ? decodePng(buffer) : null
}
