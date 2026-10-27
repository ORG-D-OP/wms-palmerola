import { readFileSync } from 'node:fs'

function parseLine(line) {
  const out = []
  let cur = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

export function readCsv(path) {
  const lines = readFileSync(path, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/)
  const cols = parseLine(lines[0])
  return lines.slice(1).map((line) => {
    const values = parseLine(line)
    return Object.fromEntries(cols.map((c, i) => [c, (values[i] ?? '').trim()]))
  })
}
