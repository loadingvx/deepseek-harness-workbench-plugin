/** Unique child names for copy / new file inside a workspace folder. */

export function splitFileName(name: string, isDirectory: boolean): { stem: string; ext: string } {
  if (isDirectory) return { stem: name, ext: '' }
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { stem: name, ext: '' }
  return { stem: name.slice(0, dot), ext: name.slice(dot) }
}

export function composeFileName(stem: string, ext: string): string {
  return `${stem}${ext}`
}

export function takenNameSet(names: Iterable<string>): Set<string> {
  return new Set([...names].filter(name => name !== ''))
}

/** `README.txt` → `README 副本.txt` / `README copy.txt`, then `… 2`, `… 3`. */
export function copyFileName(
  name: string,
  isDirectory: boolean,
  suffix: string,
  taken: Iterable<string>,
): string {
  const used = takenNameSet(taken)
  const { stem, ext } = splitFileName(name, isDirectory)
  const label = suffix.trim() === '' ? 'copy' : suffix.trim()
  const base = `${stem} ${label}`
  let candidate = composeFileName(base, ext)
  if (!used.has(candidate)) return candidate
  for (let n = 2; n < 1000; n += 1) {
    candidate = composeFileName(`${base} ${n}`, ext)
    if (!used.has(candidate)) return candidate
  }
  return composeFileName(`${base} ${Date.now()}`, ext)
}

/** Keep `未命名.txt` if free; otherwise `未命名 2.txt`. */
export function uniqueFileName(name: string, isDirectory: boolean, taken: Iterable<string>): string {
  const used = takenNameSet(taken)
  if (!used.has(name)) return name
  const { stem, ext } = splitFileName(name, isDirectory)
  for (let n = 2; n < 1000; n += 1) {
    const candidate = composeFileName(`${stem} ${n}`, ext)
    if (!used.has(candidate)) return candidate
  }
  return composeFileName(`${stem} ${Date.now()}`, ext)
}
