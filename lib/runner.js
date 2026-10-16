/**
 * Sandboxed code/command execution.
 *
 * Everything here exists for one reason: a command or script can produce
 * megabytes of output, while the answer a conversation needs is usually a few
 * hundred bytes. The raw bytes are captured in this process and never returned;
 * only the measured head/tail plus the byte count crosses back.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, extname, isAbsolute, resolve, dirname } from 'node:path'

/**
 * Locate the interpreters we can actually launch.
 *
 * process.execPath is NOT usable here: inside the harness it points at the host
 * application binary, not at a scripting runtime. Each candidate is therefore
 * probed on disk, and PATH names are kept as-is so the OS resolves them.
 */
let RUNTIME_CACHE = null

function firstExisting(paths) {
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || !candidate) continue
    if (!/[\\/]/.test(candidate)) return candidate      // a bare name: let PATH resolve it
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function probeRuntimes() {
  if (RUNTIME_CACHE !== null) return RUNTIME_CACHE
  const steps = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)
  const nodeNames = process.platform === 'win32' ? ['node.exe'] : ['node']
  const fromPath = steps.flatMap((dir) => nodeNames.map((n) => join(dir, n)))
  const node = firstExisting([
    process.env.CTK_NODE,
    process.env.NODE_BINARY,
    'C:\\Program Files\\nodejs\\node.exe',
    join(homedir(), 'AppData', 'Local', 'Programs', 'nodejs', 'node.exe'),
    ...fromPath,
    'node',
  ])
  const bun = firstExisting([
    process.env.CTK_BUN,
    join(homedir(), '.bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun'),
    'bun',
  ])
  const shell = process.platform === 'win32'
    ? firstExisting([
        join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        'powershell',
      ])
    : firstExisting(['/bin/bash', 'bash', '/bin/sh', 'sh'])
  const found = {}
  if (node) { found.javascript = node; found.typescript = node }
  if (bun) found.bun = bun
  if (shell) found.shell = shell
  RUNTIME_CACHE = found
  return found
}

export function availableRuntimes() {
  return Object.keys(probeRuntimes())
}

/** The shell plan a command runner should use on this platform. */
export function shellPlan() {
  if (process.platform === 'win32') {
    const ps = probeRuntimes().shell || 'powershell'
    return { command: ps, args: (code) => ['-NoProfile', '-NonInteractive', '-Command', code] }
  }
  return { command: probeRuntimes().shell || 'bash', args: (code) => ['-c', code] }
}

/**
 * Run one child process, capturing stdout/stderr with a hard byte cap.
 *
 * The cap is applied on the fly: once a stream exceeds it, further chunks are
 * counted but not retained. That keeps memory bounded even for a runaway
 * command, while still reporting the true total size.
 */
export function runProcess(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    env = {},
    timeoutMs = 120000,
    maxCaptureBytes = 262144,
    shell = false,
    input = null,
  } = options

  return new Promise((settle) => {
    let child
    try {
      child = spawn(command, args, {
        cwd,
        shell,
        env: childEnv(env),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      settle({ ok: false, error: String((error && error.message) || error), stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0, exitCode: null, timedOut: false })
      return
    }

    const state = { outBytes: 0, errBytes: 0, outKept: 0, errKept: 0, outCap: false, errCap: false }
    const outChunks = []
    const errChunks = []
    let timedOut = false
    let settled = false

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          try { child.kill('SIGKILL') } catch { /* already gone */ }
        }, timeoutMs)
      : null

    const collect = (chunk, isOut) => {
      const size = chunk.length
      if (isOut) {
        state.outBytes += size
        if (state.outKept < maxCaptureBytes) {
          const room = maxCaptureBytes - state.outKept
          outChunks.push(room >= size ? chunk : chunk.subarray(0, room))
          state.outKept += Math.min(size, room)
        } else state.outCap = true
      } else {
        state.errBytes += size
        if (state.errKept < maxCaptureBytes) {
          const room = maxCaptureBytes - state.errKept
          errChunks.push(room >= size ? chunk : chunk.subarray(0, room))
          state.errKept += Math.min(size, room)
        } else state.errCap = true
      }
    }

    child.stdout.on('data', (c) => collect(c, true))
    child.stderr.on('data', (c) => collect(c, false))

    const finish = (exitCode, signal, error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      settle({
        ok: !timedOut && error === undefined && exitCode === 0,
        error,
        exitCode,
        signal: signal || null,
        timedOut,
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
        stdoutBytes: state.outBytes,
        stderrBytes: state.errBytes,
        stdoutTruncated: state.outCap || state.outKept < state.outBytes,
        stderrTruncated: state.errCap || state.errKept < state.errBytes,
        stdoutKeptBytes: state.outKept,
      })
    }

    child.on('error', (error) => finish(null, null, String((error && error.message) || error)))
    child.on('close', (code, signal) => finish(code, signal, undefined))

    if (input !== null) {
      try { child.stdin.end(String(input)) } catch { /* close races are fine */ }
    } else {
      try { child.stdin.end() } catch { /* ignore */ }
    }
  })
}

/**
 * Build the environment a child process sees.
 *
 * The harness sandbox exports neither PATH entries for the interpreters we found
 * nor TEMP/TMPDIR, so a plain {...process.env} spawn cannot run "node" by name
 * even when we located the binary. This adds the directories we resolved, plus a
 * working scratch dir, without discarding whatever the parent did export.
 */
function childEnv(extra) {
  const env = { ...process.env, ...extra }
  const dirs = []
  const runtimes = probeRuntimes()
  for (const key of ['javascript', 'bun', 'shell']) {
    const bin = runtimes[key]
    if (typeof bin === 'string' && /[\\/]/.test(bin)) dirs.push(dirname(bin))
  }
  const scratch = scratchDir()
  dirs.push(scratch)
  const sep = process.platform === 'win32' ? ';' : ':'
  const existing = String(env.PATH || env.Path || '').split(sep).filter(Boolean)
  env.PATH = [...new Set([...dirs, ...existing])].join(sep)
  if (!env.TEMP) env.TEMP = scratch
  if (!env.TMP) env.TMP = scratch
  if (!env.TMPDIR) env.TMPDIR = scratch

  if (process.platform === 'win32') {
    // Measured: this sandbox exports PATHEXT as ".CPL" only and leaves COMSPEC
    // empty. PowerShell then resolves no .exe at all — not even "cmd" — even
    // though the file is on disk and PATH. Restoring both turns command lookup
    // back on. Done only when the inherited value is unusable, so a normal
    // environment is never overridden.
    const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows'
    const wantedExt = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL'
    const currentExt = String(env.PATHEXT || '')
    const hasExe = /\\.EXE/i.test(currentExt)
    if (!hasExe) env.PATHEXT = wantedExt
    if (!env.COMSPEC) env.COMSPEC = join(systemRoot, 'System32', 'cmd.exe')
    if (!env.SystemRoot) env.SystemRoot = systemRoot
    if (!env.windir) env.windir = systemRoot
  }
  return env
}

/**
 * Resolve a writable scratch directory.
 *
 * os.tmpdir() returns a bogus value ("undefined\temp") when TEMP/TMPDIR are not
 * exported, which is exactly what happens inside the harness sandbox. So the
 * candidates are probed in order and the first writable one wins.
 */
let SCRATCH_DIR = null
export function scratchDir() {
  if (SCRATCH_DIR !== null) return SCRATCH_DIR
  const candidates = [
    process.env.CTK_TMP,
    process.env.TEMP,
    process.env.TMP,
    process.env.TMPDIR,
    join(homedir(), 'AppData', 'Local', 'Temp'),
    join(homedir(), '.cache', 'dsh-context-toolkit'),
    '/tmp',
    dirname(tmpdir()),
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    if (/undefined/i.test(candidate)) continue
    try {
      mkdirSync(candidate, { recursive: true })
      const probe = mkdtempSync(join(candidate, 'ctk-check-'))
      rmSync(probe, { recursive: true, force: true })
      SCRATCH_DIR = candidate
      return SCRATCH_DIR
    } catch { /* try the next candidate */ }
  }
  const fallback = process.cwd()
  SCRATCH_DIR = fallback
  return fallback
}

/** Write a script to a temp file so its real name shows up in stack traces. */
export function withTempScript(extension, body, fn) {
  const dir = mkdtempSync(join(scratchDir(), 'ctk-run-'))
  const file = join(dir, 'script' + extension)
  writeFileSync(file, body, 'utf8')
  return Promise.resolve()
    .then(() => fn(file))
    .finally(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ } })
}

export const SANDBOX_TMP = () => mkdtempSync(join(scratchDir(), 'ctk-'))
export { extname, isAbsolute, resolve, readFileSync, statSync, existsSync }
