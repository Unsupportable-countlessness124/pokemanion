// Adding a character from inside a session, one question at a time.
//
// A hook cannot hold a conversation: it is handed one message, answers it, and
// exits. What it can do is remember where it got to, so a sequence of prompts
// becomes a sequence of questions — `--pokemanion add brock`, then a path, then
// another path, then the frame ranges.
//
// The danger in that is obvious and is the reason this is careful: a flow that
// intercepts whatever you type next is a flow that eats the message you meant
// for the model. So it only ever answers a prompt that plausibly answers the
// question it asked — a file path where it asked for a file, a range where it
// asked for a range — and passes everything else straight through untouched. Ask
// your agent something mid-flow and it reaches the agent; the question is still
// waiting when you come back.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ROOT, STATE_DIR } from './config.mjs'
import { decodeGif } from './gif.mjs'
import { decodePng } from './png.mjs'
import { isResident } from './roster.mjs'

const fileFor = (session) => join(STATE_DIR, `adding-${String(session).replace(/[^\w.-]/g, '')}.json`)

export const stop = (session) => {
  try {
    rmSync(fileFor(session), { force: true })
  } catch {}
}

// Half an hour, after which the flow has been abandoned rather than paused.
//
// Without this it waits forever. Start an add, get distracted, and a week later
// the next thing you paste that ends in .gif is read as an answer to a question
// you have long forgotten asking.
const FORGET_AFTER = 30 * 60 * 1000

export const inProgress = (session, now = Date.now()) => {
  try {
    const state = JSON.parse(readFileSync(fileFor(session), 'utf8'))

    if (now - (state.at ?? 0) > FORGET_AFTER) {
      stop(session)

      return null
    }

    return state
  } catch {
    return null
  }
}

const save = (session, state) => {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(fileFor(session), JSON.stringify({ ...state, at: Date.now() }))
}

const expand = (text) => (text.startsWith('~') ? join(homedir(), text.slice(1)) : text)

// What a file looks like when someone types one, rather than what a path is.
// Anything else is a message for the agent.
const looksLikeFile = (text) => /\.(gif|png)$/i.test(text.trim()) && !text.includes('\n')

const looksLikeRange = (text) => /^(all|\d+-\d+)$/i.test(text.trim())

const measure = (path) => {
  const bytes = readFileSync(path)
  const image = /\.png$/i.test(path) ? decodePng(bytes) : decodeGif(bytes)

  return { frames: image.frames.length, width: image.width, height: image.height }
}

export const begin = (session, name) => {
  if (!name) return 'name it: --pokemanion add <name>\n'
  if (!/^[a-z][a-z0-9-]*$/i.test(name)) return `"${name}" cannot be a name here — letters, digits and hyphens\n`
  if (isResident(name.toLowerCase())) return `${name} is already a resident\n`

  save(session, { name: name.toLowerCase(), step: 'resting' })

  return (
    `adding ${name.toLowerCase()}\n\n` +
    'send the path to its resting animation — what it does while waiting\n' +
    '(a .gif or .png, drag the file in). --pokemanion cancel to stop.\n'
  )
}

// Answers only. Anything that is not one is somebody else's prompt.
export const answer = (session, prompt) => {
  const state = inProgress(session)

  if (!state) return null

  const text = String(prompt ?? '').trim()

  if (/^--pokemanion\s+cancel$/i.test(text)) {
    stop(session)

    return `stopped adding ${state.name}\n`
  }

  if (state.step === 'resting' || state.step === 'working') {
    if (!looksLikeFile(text)) return null

    const path = expand(text.replace(/^['"]|['"]$/g, ''))

    if (!existsSync(path)) return `no such file: ${path}\n\nsend the path again, or --pokemanion cancel\n`

    let seen

    try {
      seen = measure(path)
    } catch (error) {
      return `cannot read ${path}: ${error.message}\n\nsend another, or --pokemanion cancel\n`
    }

    if (state.step === 'resting') {
      save(session, { ...state, resting: path, restingFrames: seen.frames, step: 'working' })

      return (
        `resting: ${seen.width}x${seen.height}, ${seen.frames} frames\n\n` +
        'now the working animation — what it does while the agent is busy.\n' +
        'the same file again is fine if both live in one sheet.\n'
      )
    }

    save(session, { ...state, working: path, workingFrames: seen.frames, step: 'ranges' })

    const sheet = state.restingFrames > 12 || seen.frames > 12

    return (
      `working: ${seen.width}x${seen.height}, ${seen.frames} frames\n\n` +
      (sheet
        ? 'that is a lot of frames, so it may be a sheet of several cycles.\n' +
          `which frames are the resting one? e.g. 0-8, or "all" for every frame\n`
        : 'send "all" to use every frame, or a range like 0-8 for the resting half\n')
    )
  }

  if (state.step === 'ranges' || state.step === 'workingRange') {
    if (!looksLikeRange(text)) return null

    const value = text.toLowerCase() === 'all' ? null : text

    if (state.step === 'ranges') {
      save(session, { ...state, restRange: value, step: 'workingRange' })

      return 'and which frames are the working one? e.g. 12-17, or "all"\n'
    }

    return { run: { ...state, workRange: value } }
  }

  return null
}

// The command the flow has been assembling, so what it does is inspectable
// rather than magic — and so anyone can run it again by hand.
export const command = (state) => {
  const parts = ['npm', 'run', 'add', '--', state.name, state.resting, state.working]

  if (state.restRange) parts.push(`--resting=${state.restRange}`)
  if (state.workRange) parts.push(`--working=${state.workRange}`)

  return parts
}

// The same command, written so it can be pasted. The paths come from whatever
// someone dragged into the prompt, and half the interesting sprite files have
// spaces in their names.
export const asTyped = (parts) =>
  parts.map((part) => (/[\s"']/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part)).join(' ')

export const ROOT_DIR = ROOT
