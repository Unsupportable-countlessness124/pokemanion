// Writing a GIF, which three things here now need to do.
//
// `crop` has one of its own and keeps it: cropping invents no colours, so it
// maps every pixel back into the palette it came from and loses nothing. This
// one builds a palette from the frames, because slicing and keying can leave a
// set of colours the original table never had.
//
// Frames arrive as RGBA. Anything below half alpha becomes the transparent
// index, everything else is matched to a palette built from the frames
// themselves, which is exact when there are 255 colours or fewer and near
// enough when there are more: this is pixel art, and the alternative is
// inventing colours that were never drawn.

// GIF's LZW: codes start one bit wider than the palette and grow as the
// dictionary fills, with a clear code resetting it at 4096.
const compress = (indices, bits) => {
  const clear = 1 << bits
  const end = clear + 1
  const out = []
  let current = 0
  let used = 0
  let codeWidth = bits + 1
  let next = end + 1
  let dict = new Map()

  const emit = (code) => {
    current |= code << used
    used += codeWidth

    while (used >= 8) {
      out.push(current & 0xff)
      current >>= 8
      used -= 8
    }
  }

  emit(clear)

  let prefix = indices[0]

  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]
    const key = prefix * 4096 + k

    if (dict.has(key)) {
      prefix = dict.get(key)
      continue
    }

    emit(prefix)
    dict.set(key, next++)

    if (next > 4095) {
      emit(clear)
      dict = new Map()
      next = end + 1
      codeWidth = bits + 1
    } else if (next > 1 << codeWidth) {
      codeWidth++
    }

    prefix = k
  }

  emit(prefix)
  emit(end)

  if (used > 0) out.push(current & 0xff)

  return out
}

export const encodeGif = (frames, width, height, delayMs = 100) => {
  const counts = new Map()

  for (const pixels of frames) {
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue

      const key = `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`

      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  const palette = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 255)
    .map(([key]) => key.split(',').map(Number))

  const exact = new Map(palette.map((colour, i) => [colour.join(','), i]))
  const guessed = new Map()

  const indexOf = (r, g, b) => {
    const key = `${r},${g},${b}`

    if (exact.has(key)) return exact.get(key)

    if (!guessed.has(key)) {
      let best = 0
      let bestDistance = Infinity

      for (let i = 0; i < palette.length; i++) {
        const distance = (palette[i][0] - r) ** 2 + (palette[i][1] - g) ** 2 + (palette[i][2] - b) ** 2

        if (distance < bestDistance) {
          bestDistance = distance
          best = i
        }
      }

      guessed.set(key, best)
    }

    return guessed.get(key)
  }

  const transparent = palette.length
  const table = [...palette, [0, 0, 0]]
  const bits = Math.max(2, Math.ceil(Math.log2(table.length)))

  while (table.length < 2 ** bits) table.push([0, 0, 0])

  const bytes = []
  const push = (...values) => bytes.push(...values)
  const short = (value) => push(value & 0xff, (value >> 8) & 0xff)

  push(...[...'GIF89a'].map((c) => c.charCodeAt(0)))
  short(width)
  short(height)
  push(0x80 | ((bits - 1) & 7), 0, 0)

  for (const [r, g, b] of table) push(r, g, b)

  // Loop forever.
  push(0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 0x03, 0x01, 0x00, 0x00, 0x00)

  const delay = Math.max(2, Math.round(delayMs / 10))

  for (const pixels of frames) {
    const indices = new Uint8Array(width * height)

    for (let i = 0, at = 0; i < pixels.length; i += 4, at++) {
      indices[at] = pixels[i + 3] < 128 ? transparent : indexOf(pixels[i], pixels[i + 1], pixels[i + 2])
    }

    // Restore to background between frames, so one never shows through the next.
    push(0x21, 0xf9, 0x04, 0x08 | 0x01)
    short(delay)
    push(transparent, 0x00)

    push(0x2c)
    short(0)
    short(0)
    short(width)
    short(height)
    push(0x00)
    push(bits)

    const data = compress(indices, bits)

    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255)

      push(chunk.length, ...chunk)
    }

    push(0x00)
  }

  push(0x3b)

  return Buffer.from(bytes)
}
