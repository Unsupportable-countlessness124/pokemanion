// A GIF87a/89a decoder, just enough of the spec to turn a sprite animation into
// RGBA frames. No dependencies: the machines this runs on have no ImageMagick,
// no ffmpeg and no Pillow, so we do the LZW ourselves.

const TRAILER = 0x3b
const EXTENSION = 0x21
const IMAGE_DESCRIPTOR = 0x2c
const GRAPHIC_CONTROL = 0xf9

// Interlaced GIFs store rows in four passes: every 8th row from 0, every 8th
// from 4, every 4th from 2, then every 2nd from 1.
const INTERLACE_PASSES = [
  { start: 0, step: 8 },
  { start: 4, step: 8 },
  { start: 2, step: 4 },
  { start: 1, step: 2 },
]

const readColorTable = (bytes, offset, count) => {
  const table = new Uint8Array(count * 3)

  table.set(bytes.subarray(offset, offset + count * 3))

  return table
}

// Sub-blocks are length-prefixed runs terminated by a zero length. Returns the
// joined payload and the offset of the byte after the terminator.
const readSubBlocks = (bytes, offset) => {
  const chunks = []
  let at = offset
  let total = 0

  while (bytes[at] !== 0) {
    const size = bytes[at]

    chunks.push(bytes.subarray(at + 1, at + 1 + size))
    total += size
    at += size + 1
  }

  const joined = new Uint8Array(total)
  let written = 0

  for (const chunk of chunks) {
    joined.set(chunk, written)
    written += chunk.length
  }

  return { data: joined, next: at + 1 }
}

// Standard GIF LZW. Codes are packed least-significant-bit first and the code
// width grows as the dictionary fills, resetting on every clear code.
//
// Strings live in the classic prefix/suffix pair of arrays rather than real
// arrays: entry N is suffix[N] appended to whatever entry prefix[N] spells, so
// walking a code emits its bytes backwards onto a stack.
const lzwDecode = (data, minCodeSize, pixelCount) => {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1

  const prefix = new Int32Array(4096)
  const suffix = new Uint8Array(4096)
  const stack = new Uint8Array(4096)

  const output = new Uint8Array(pixelCount)
  let written = 0

  let codeSize = minCodeSize + 1
  let nextCode = endCode + 1
  let previous = -1
  let firstByte = 0

  let bitBuffer = 0
  let bitCount = 0
  let at = 0

  for (let i = 0; i < clearCode; i++) suffix[i] = i

  while (written < pixelCount) {
    while (bitCount < codeSize) {
      if (at >= data.length) return output

      bitBuffer |= data[at++] << bitCount
      bitCount += 8
    }

    const code = bitBuffer & ((1 << codeSize) - 1)

    bitBuffer >>= codeSize
    bitCount -= codeSize

    if (code === endCode) break

    if (code === clearCode) {
      codeSize = minCodeSize + 1
      nextCode = endCode + 1
      previous = -1
      continue
    }

    // The first code after a reset is always a literal, and there is no
    // previous entry to extend yet.
    if (previous === -1) {
      output[written++] = suffix[code]
      firstByte = code
      previous = code
      continue
    }

    let current = code
    let depth = 0

    // code === nextCode is the legal self-referencing case: the entry being
    // defined by this very step, which spells previous + previous's first byte.
    if (code >= nextCode) {
      stack[depth++] = firstByte
      current = previous
    }

    while (current >= clearCode) {
      stack[depth++] = suffix[current]
      current = prefix[current]
    }

    firstByte = suffix[current]
    stack[depth++] = firstByte

    for (let i = depth - 1; i >= 0 && written < pixelCount; i--) {
      output[written++] = stack[i]
    }

    if (nextCode < 4096) {
      prefix[nextCode] = previous
      suffix[nextCode] = firstByte
      nextCode++

      if ((nextCode & (nextCode - 1)) === 0 && codeSize < 12) codeSize++
    }

    previous = code
  }

  return output
}

export const decodeGif = (buffer) => {
  const bytes = new Uint8Array(buffer)
  const signature = String.fromCharCode(...bytes.subarray(0, 3))

  if (signature !== 'GIF') throw new Error('not a GIF')

  const width = bytes[6] | (bytes[7] << 8)
  const height = bytes[8] | (bytes[9] << 8)
  const packed = bytes[10]

  let at = 13
  let globalTable = null

  if (packed & 0x80) {
    const size = 1 << ((packed & 0x07) + 1)

    globalTable = readColorTable(bytes, at, size)
    at += size * 3
  }

  const frames = []

  // The canvas persists across frames; each frame paints onto it and the
  // disposal method decides what the next frame starts from.
  const canvas = new Uint8Array(width * height * 4)
  let pending = { transparentIndex: -1, delay: 10, disposal: 0 }

  while (at < bytes.length && bytes[at] !== TRAILER) {
    if (bytes[at] === EXTENSION) {
      const label = bytes[at + 1]

      if (label === GRAPHIC_CONTROL) {
        const flags = bytes[at + 3]

        pending = {
          disposal: (flags >> 2) & 0x07,
          transparentIndex: flags & 0x01 ? bytes[at + 6] : -1,
          delay: (bytes[at + 4] | (bytes[at + 5] << 8)) || 10,
        }
      }

      at = readSubBlocks(bytes, at + 2).next
      continue
    }

    if (bytes[at] !== IMAGE_DESCRIPTOR) {
      at++
      continue
    }

    const left = bytes[at + 1] | (bytes[at + 2] << 8)
    const top = bytes[at + 3] | (bytes[at + 4] << 8)
    const frameWidth = bytes[at + 5] | (bytes[at + 6] << 8)
    const frameHeight = bytes[at + 7] | (bytes[at + 8] << 8)
    const framePacked = bytes[at + 9]

    at += 10

    let table = globalTable

    if (framePacked & 0x80) {
      const size = 1 << ((framePacked & 0x07) + 1)

      table = readColorTable(bytes, at, size)
      at += size * 3
    }

    const interlaced = Boolean(framePacked & 0x40)
    const minCodeSize = bytes[at]
    const { data, next } = readSubBlocks(bytes, at + 1)

    at = next

    const indices = lzwDecode(data, minCodeSize, frameWidth * frameHeight)
    const previous = pending.disposal === 3 ? canvas.slice() : null

    for (let row = 0; row < frameHeight; row++) {
      const target = interlaced ? interlacedRow(row, frameHeight) : row

      for (let column = 0; column < frameWidth; column++) {
        const index = indices[row * frameWidth + column]

        if (index === pending.transparentIndex) continue

        const canvasX = left + column
        const canvasY = top + target

        if (canvasX >= width || canvasY >= height) continue

        const to = (canvasY * width + canvasX) * 4

        canvas[to] = table[index * 3]
        canvas[to + 1] = table[index * 3 + 1]
        canvas[to + 2] = table[index * 3 + 2]
        canvas[to + 3] = 255
      }
    }

    frames.push({ pixels: canvas.slice(), delay: pending.delay * 10 })

    if (pending.disposal === 2) {
      for (let row = 0; row < frameHeight; row++) {
        for (let column = 0; column < frameWidth; column++) {
          const canvasX = left + column
          const canvasY = top + row

          if (canvasX >= width || canvasY >= height) continue

          canvas.fill(0, (canvasY * width + canvasX) * 4, (canvasY * width + canvasX) * 4 + 4)
        }
      }
    }

    if (pending.disposal === 3 && previous) canvas.set(previous)
  }

  return { width, height, frames }
}

const interlacedRow = (row, height) => {
  let seen = 0

  for (const { start, step } of INTERLACE_PASSES) {
    const rows = Math.ceil(Math.max(0, height - start) / step)

    if (row < seen + rows) return start + (row - seen) * step

    seen += rows
  }

  return row
}
