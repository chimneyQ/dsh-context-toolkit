/**
 * dsh-context-toolkit — a DSH bundle that keeps bulk output out of the
 * conversation.
 *
 * What it does
 * ------------
 * Three things, all in-process:
 *
 *   1. ctk_* tools run commands and scripts in a child process and return only
 *      the conclusion, not the bytes they produced;
 *   2. a routing gate refuses the fetches and whole-file reads that would dump
 *      raw output into the transcript, and points at the cheap alternative;
 *   3. a local FTS5 knowledge base files large material so it can be retrieved
 *      by section later instead of being read whole.
 *
 * Contract notes: apply() is synchronous (the host requires it), every knob is
 * a flat volatile field so the settings page can write it, and the plugin keeps
 * no third-party runtime dependencies.
 */
import { homedir } from 'node:os'
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join, isAbsolute, resolve, basename } from 'node:path'
import { runProcess, availableRuntimes, probeRuntimes, shellPlan, scratchDir } from './lib/runner.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { openStore } from './lib/store.js'

export const name = 'dsh-context-toolkit'
export const inject = ['tools', 'systemPrompt']

const z = await loadSchemastery()

/**
 * Load a schemastery that actually supports the chain this plugin's schema uses.
 *
 * Resolution order matters more than it looks: this machine has three copies of
 * the package (a stale one in the user home, plus one per profile), and the
 * stale copy silently lacks `.volatile()` on its chain. Taking "the first anchor
 * that resolves" therefore produced a constructor with no volatile support, and
 * the schema died at module load. So every candidate is capability-tested — the
 * exact chain the schema performs — and only a copy that passes is returned.
 */
async function loadSchemastery() {
  const { createRequire } = await import('node:module')
  const candidates = []
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')

  // The active profile first: its copy is the one the host itself resolves.
  const active = process.env.DSH_PROFILE
  if (active) candidates.push(join(dshHome, 'profiles', active, 'package.json'))
  candidates.push(join(dshHome, 'profiles', 'desktop', 'package.json'))

  // Then any other profile, so a renamed profile still works.
  try {
    for (const profile of readdirSync(join(dshHome, 'profiles'))) {
      candidates.push(join(dshHome, 'profiles', profile, 'package.json'))
    }
  } catch { /* no profiles directory: the anchors below still apply */ }

  candidates.push(import.meta.url)

  const acceptsChain = (z) => {
    if (typeof z !== 'function' && typeof z !== 'object') return false
    try {
      // The exact call the schema makes; a stale copy throws here.
      z.string().default('').volatile().description('probe')
      const node = z.object({ probe: z.boolean().default(true).volatile() })
      return typeof node.toJSON === 'function'
    } catch { return false }
  }

  for (const anchor of candidates) {
    try {
      const z = createRequire(anchor)('@deepseek-ai/schemastery')
      if (acceptsChain(z)) return z
    } catch { /* next candidate */ }
  }
  return shimSchemastery()
}

/**
 * A tiny stand-in for schemastery, used only when the host package cannot be
 * resolved (bare `node smoke.mjs` outside DSH). It supports exactly the surface
 * this plugin's schema uses, so the offline suite can exercise real code paths.
 */
function shimSchemastery() {
  const make = (meta) => {
    const node = {
      meta: meta || {},
      type: undefined,
      dict: undefined,
      inner: undefined,
      default(value) { this.meta.default = value; return this },
      description(text) { this.meta.description = text; return this },
      min(value) { this.meta.min = value; return this },
      volatile() { this.meta.volatile = true; return this },
      required() { this.meta.required = true; return this },
      toJSON() { return { type: this.type, meta: this.meta, dict: this.dict } },
    }
    return node
  }
  const api = {
    boolean: () => { const n = make(); n.type = 'boolean'; return n },
    number: () => { const n = make(); n.type = 'number'; return n },
    string: () => { const n = make(); n.type = 'string'; return n },
    array: (inner) => { const n = make(); n.type = 'array'; n.inner = inner; return n },
    object: (dict) => { const n = make(); n.type = 'object'; n.dict = dict; return n },
  }
  api.object.prototype = undefined
  return api
}

export const Config = z.object({
  storageDir: z.string().default('').volatile().description('知识库根目录；留空 = <DSH_HOME>/context-toolkit'),
  routing: z.boolean().default(true).volatile().description('是否启用 tools/pre-execute 路由门禁'),
  denyCurlWget: z.boolean().default(true).volatile().description('硬拦 curl/wget 这类洪水工具'),
  bashNudgeMinCommandBytes: z.number().min(0).default(4096).volatile().description('长命令软引导阈值（字节）'),
  maxReadBytesBeforeAsk: z.number().min(0).default(51200).volatile().description('大文件整读软引导阈值（字节）'),
  trustedReadBasenames: z.array(z.string())
    .default(['package.json', 'tsconfig.json', 'cordis.patch.yml', 'cordis.yml'])
    .volatile()
    .description('这些文件名不受大文件整读门禁限制（逗号分隔）'),
  // Tool switches are FLAT top-level keys: the settings form addresses fields by
  // a single path segment, and the host validates that segment against this
  // schema's own keys. A nested object would make every save fail.
  'tools.execute': z.boolean().default(true).volatile().description('注册 ctk_execute'),
  'tools.executeFile': z.boolean().default(true).volatile().description('注册 ctk_execute_file'),
  'tools.batchExecute': z.boolean().default(true).volatile().description('注册 ctk_batch_execute'),
  'tools.index': z.boolean().default(true).volatile().description('注册 ctk_index'),
  'tools.search': z.boolean().default(true).volatile().description('注册 ctk_search'),
  'tools.fetchAndIndex': z.boolean().default(true).volatile().description('注册 ctk_fetch_and_index'),
  'tools.purge': z.boolean().default(true).volatile().description('注册 ctk_purge'),
  'tools.stats': z.boolean().default(true).volatile().description('注册 ctk_stats'),
  'tools.doctor': z.boolean().default(true).volatile().description('注册 ctk_doctor'),
  'tools.contextReport': z.boolean().default(true).volatile().description('注册 ctk_context_report 并挂载占用路由'),
  compressNudgeTokens: z.number().min(0).default(120000).volatile().description('上下文占用提示阈值（tokens）'),
  searchLimit: z.number().min(1).default(5).volatile().description('ctk_search 每次查询返回的片段数上限'),
  snippetChars: z.number().min(100).default(900).volatile().description('ctk_search 每个片段的最大字符数'),
  fetchMaxBytes: z.number().min(1024).default(2000000).volatile().description('ctk_fetch_and_index 单页最大抓取字节'),
})

const VOLATILE_READ = Symbol.for('cosmokit.volatile.read')

/** Read a live setting through the host's handle, falling back to the plain value. */
export function readVolatile(handle, fallback) {
  if (handle === null || handle === undefined) return fallback
  if (typeof handle === 'object') {
    const reader = handle[VOLATILE_READ]
    if (typeof reader === 'function') {
      try { return reader.call(handle) } catch { /* fall through to get() */ }
    }
    if (typeof handle.get === 'function') {
      try { return handle.get() } catch { /* fall back */ }
    }
  }
  return handle
}

function makeLogger(ctx) {
  const sink = ctx && ctx.logger ? ctx.logger : console
  const tag = '[' + name + '] '
  return {
    info: (m) => { try { sink.info(tag + m) } catch { /* ignore */ } },
    warn: (m) => { try { sink.warn(tag + m) } catch { /* ignore */ } },
  }
}

export function apply(ctx, rawConfig) {
  const log = makeLogger(ctx)
  const defaults = {
    storageDir: '',
    routing: true,
    denyCurlWget: true,
    bashNudgeMinCommandBytes: 4096,
    maxReadBytesBeforeAsk: 51200,
    trustedReadBasenames: ['package.json', 'tsconfig.json', 'cordis.patch.yml', 'cordis.yml'],
    'tools.execute': true,
    'tools.executeFile': true,
    'tools.batchExecute': true,
    'tools.index': true,
    'tools.search': true,
    'tools.fetchAndIndex': true,
    'tools.purge': true,
    'tools.stats': true,
    'tools.doctor': true,
    'tools.contextReport': true,
    compressNudgeTokens: 120000,
    searchLimit: 5,
    snippetChars: 900,
    fetchMaxBytes: 2000000,
  }
  const incoming = rawConfig || {}
  const config = {
    storageDir: readVolatile(incoming.storageDir, defaults.storageDir),
    routing: readVolatile(incoming.routing, defaults.routing),
    denyCurlWget: readVolatile(incoming.denyCurlWget, defaults.denyCurlWget),
    bashNudgeMinCommandBytes: readVolatile(incoming.bashNudgeMinCommandBytes, defaults.bashNudgeMinCommandBytes),
    maxReadBytesBeforeAsk: readVolatile(incoming.maxReadBytesBeforeAsk, defaults.maxReadBytesBeforeAsk),
    trustedReadBasenames: readVolatile(incoming.trustedReadBasenames, defaults.trustedReadBasenames),
    'tools.execute': readVolatile(incoming['tools.execute'], defaults['tools.execute']),
    'tools.executeFile': readVolatile(incoming['tools.executeFile'], defaults['tools.executeFile']),
    'tools.batchExecute': readVolatile(incoming['tools.batchExecute'], defaults['tools.batchExecute']),
    'tools.index': readVolatile(incoming['tools.index'], defaults['tools.index']),
    'tools.search': readVolatile(incoming['tools.search'], defaults['tools.search']),
    'tools.fetchAndIndex': readVolatile(incoming['tools.fetchAndIndex'], defaults['tools.fetchAndIndex']),
    'tools.purge': readVolatile(incoming['tools.purge'], defaults['tools.purge']),
    'tools.stats': readVolatile(incoming['tools.stats'], defaults['tools.stats']),
    'tools.doctor': readVolatile(incoming['tools.doctor'], defaults['tools.doctor']),
    'tools.contextReport': readVolatile(incoming['tools.contextReport'], defaults['tools.contextReport']),
    compressNudgeTokens: readVolatile(incoming.compressNudgeTokens, defaults.compressNudgeTokens),
    searchLimit: readVolatile(incoming.searchLimit, defaults.searchLimit),
    snippetChars: readVolatile(incoming.snippetChars, defaults.snippetChars),
    fetchMaxBytes: readVolatile(incoming.fetchMaxBytes, defaults.fetchMaxBytes),
  }

  const storageDir = (typeof config.storageDir === 'string' && config.storageDir.trim())
    ? config.storageDir
    : join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'context-toolkit')
  // Savings ledger. Kept deliberately wider than the upstream convention: a call
  // the gate refused is a saving too, and leaving it out made the ledger read as
  // permanently zero even while the gate was doing its job.
  const stats = {
    denied: 0,
    deniedBytes: 0,
    registered: 0,
    bytesIndexed: 0,
    bytesSandboxed: 0,
    calls: {},
    startedAt: Date.now(),
  }

  let store = null
  try {
    store = openStore(storageDir)
  } catch (error) {
    log.warn('knowledge base unavailable: ' + String((error && error.message) || error))
  }

  registerRoutingGate(ctx, config, stats)
  registerTools(ctx, config, stats, storageDir, log)
  if (store) registerKnowledgeTools(ctx, config, stats, store, log)
  else log.info('knowledge tools skipped (no store)')
  registerObservabilityTools(ctx, config, stats, store, storageDir, log)

  try { registerStatusRoute(ctx, config, stats, store, storageDir) }
  catch (error) { log.warn('status route not mounted: ' + String((error && error.message) || error)) }

  // The SQLite handle must be released when the plugin unwinds: an open WAL
  // keeps the store directory locked and leaks a file descriptor per reload.
  if (store && typeof ctx.effect === 'function') {
    try {
      ctx.effect(() => () => { try { store.close() } catch { /* already closed */ } })
    } catch (error) {
      log.warn('could not register store disposal: ' + String((error && error.message) || error))
    }
  }

  log.info('ready: storage=' + storageDir + ' routing=' + config.routing + ' tools=' + stats.registered)
}

// ── routing gate ────────────────────────────────────────────────────────────

/** Names whose whole purpose is to pour raw bytes into the conversation. */
const FLOOD_TOOLS = new Set(['curl', 'wget', 'httpie', 'http', 'aria2c'])

function floodReason(toolName, args) {
  const command = typeof args.command === 'string' ? args.command : ''
  if (toolName !== 'bash' && toolName !== 'pwsh' && toolName !== 'shell') return null
  for (const word of FLOOD_TOOLS) {
    if (new RegExp('(^|[ \\t;&|(])' + word + '([ \\t;&|)]|$)', 'i').test(command)) {
      return 'dsh-context-toolkit: "' + word + '" pours whole responses into the transcript. '
        + 'Use ctk_fetch_and_index(url, source) and then ctk_search(queries), or run it inside '
        + 'ctk_execute(language:"javascript", code) and print only the conclusion.'
    }
  }
  return null
}

/** The flood tool a command line invoked, for the ledger's per-tool counters. */
export function floodToolName(command) {
  const text = String(command || '')
  for (const word of FLOOD_TOOLS) {
    if (new RegExp('(^|[ \\t;&|(])' + word + '([ \\t;&|)]|$)', 'i').test(text)) return word
  }
  return 'other'
}

function hasService(ctx, serviceName) {
  try { return ctx.get(serviceName) !== undefined } catch { return false }
}

function baseNameOf(p) {
  const s = String(p).replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i >= 0 ? s.slice(i + 1) : s
}

function registerRoutingGate(ctx, config, stats) {
  if (!config.routing) return

  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const toolName = exec && exec.name
      const args = (exec && exec.arguments) || {}

      if (config.denyCurlWget !== false) {
        const reason = floodReason(toolName, args)
        if (reason) {
          stats.denied += 1
          stats.deniedBytes += typeof args.command === 'string' ? args.command.length : 0
          stats.calls[floodToolName(args.command || '')] = (stats.calls[floodToolName(args.command || '')] || 0) + 1
          return { kind: 'deny', reason }
        }
      }

      if ((toolName === 'bash' || toolName === 'pwsh') && config.bashNudgeMinCommandBytes > 0) {
        const command = typeof args.command === 'string' ? args.command : ''
        if (command.length > config.bashNudgeMinCommandBytes) {
          const reason = 'dsh-context-toolkit: this command is about ' + command.length
            + ' bytes (threshold ' + config.bashNudgeMinCommandBytes + '). If you only need a count, a filter '
            + 'or a summary, run it through ctk_execute or ctk_batch_execute so only the conclusion '
            + 'comes back; read the raw text with the read tool (offset/limit) if you truly need it.'
          if (hasService(ctx, 'approval')) return { kind: 'ask', reason }
          return next()
        }
      }

      if (toolName === 'read' && config.maxReadBytesBeforeAsk > 0) {
        const p = typeof args.file_path === 'string' ? args.file_path
          : (typeof args.path === 'string' ? args.path : '')
        const bounded = args.offset !== undefined || args.limit !== undefined
        if (p && !bounded && !(config.trustedReadBasenames || []).includes(baseNameOf(p))) {
          try {
            const st = statSync(p)
            if (st.isFile() && st.size > config.maxReadBytesBeforeAsk) {
              stats.denied += 1
              stats.deniedBytes += st.size
              const reason = 'dsh-context-toolkit: ' + p + ' is about ' + st.size
                + ' bytes (threshold ' + config.maxReadBytesBeforeAsk + '). To analyse or summarise it, use '
                + 'ctk_execute_file(path, language, code); to file it for later, use ctk_index(path). '
                + 'Read it whole only when you must edit exact bytes.'
              if (hasService(ctx, 'approval')) return { kind: 'ask', reason }
              return next()
            }
          } catch { /* a missing file is the read tool's error to report */ }
        }
      }
    } catch { /* the gate must never block a tool call by failing itself */ }
    return next()
  })

  if (config.denyCurlWget !== false && ctx.tools && typeof ctx.tools.guard === 'function') {
    ctx.tools.guard((exec) => floodReason(exec && exec.name, (exec && exec.arguments) || {}))
  }
}

// ── tools ───────────────────────────────────────────────────────────────────

function toolSwitch(config, key) {
  return config['tools.' + key] !== false
}

/** Render the bounded account a sandboxed run returns. */
/** Hard ceiling on how many characters any single captured stream contributes. */
const MAX_STREAM_CHARS = 4000

/**
 * Bound one captured stream so a huge or single-line output cannot reach the
 * conversation whole. Line-based slicing alone is not enough: a 1 MB blob with
 * no newline is ONE line, so a per-line split would keep all of it. The char cap
 * is applied first, then the line slicing refines the already-bounded text.
 */
function clampStream(text, maxChars = MAX_STREAM_CHARS) {
  const value = String(text || '')
  if (value.length <= maxChars) return { text: value, clamped: false, omittedChars: 0 }
  const head = Math.floor(maxChars * 0.6)
  const tail = maxChars - head
  return {
    text: value.slice(0, head) + '\n… (' + (value.length - maxChars) + ' more characters)…\n' + value.slice(-tail),
    clamped: true,
    omittedChars: value.length - maxChars,
  }
}

function summarizeRun(label, result, options = {}) {
  const { headLines = 40, tailLines = 20 } = options
  const lines = []
  lines.push('## ' + label)
  if (result.error) lines.push('- launch error: ' + result.error)
  lines.push('- exit: ' + (result.exitCode === null ? 'n/a' : result.exitCode)
    + (result.signal ? ' (signal ' + result.signal + ')' : '')
    + (result.timedOut ? '  [timed out]' : ''))
  lines.push('- stdout: ' + result.stdoutBytes + ' B captured'
    + (result.stdoutTruncated ? ' (showing head)' : '')
    + '  |  stderr: ' + result.stderrBytes + ' B')
  const outRaw = clampStream((result.stdout || '').replace(/\r\n/g, '\n'))
  const out = outRaw.text
  if (out.trim()) {
    const split = out.split('\n')
    const shown = split.length > headLines + tailLines
      ? split.slice(0, headLines).concat(['… (' + (split.length - headLines - tailLines) + ' more lines)…'], split.slice(-tailLines))
      : split
    lines.push('')
    lines.push('~~~stdout')
    lines.push(shown.join('\n'))
    lines.push('~~~')
  }
  const err = clampStream((result.stderr || '').replace(/\r\n/g, '\n')).text
  if (err.trim()) {
    lines.push('')
    lines.push('~~~stderr')
    lines.push(err.split('\n').slice(0, 30).join('\n'))
    lines.push('~~~')
  }
  return lines.join('\n')
}

/**
 * Map a language name to a temp-script extension and launch plan.
 *
 * javascript uses .cjs so a script can reach require() and __dirname the way most
 * Node code in the wild does; esm is the explicit opt-in for import syntax.
 */
const LANGUAGE_PLAN = {
  javascript: { ext: '.cjs', run: (file, bin) => ({ command: bin, args: [file] }) },
  esm: { ext: '.mjs', run: (file, bin) => ({ command: bin, args: [file] }) },
  typescript: { ext: '.mts', run: (file, bin) => ({ command: bin, args: ['--experimental-strip-types', file] }) },
}

function registerTools(ctx, config, stats, storageDir, log) {
  const runtimes = probeRuntimes()
  const runtimeNames = Object.keys(runtimes)
  log.info('runtimes: ' + (runtimeNames.length ? runtimeNames.join(', ') : '(none found)'))

  ctx.tools.register({
    name: 'ctk_execute',
    description: 'Run code in a sandboxed child process and return only its conclusion. Raw stdout/stderr bytes never enter the conversation: this reports the exit status, the byte volumes and a bounded head/tail. Use it for counts, filters, aggregations and any analysis whose raw output would flood the transcript.',
    parameters: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['javascript', 'esm', 'typescript', 'shell'], description: 'Interpreter to run the code with (javascript = CommonJS, esm = import syntax).' },
        code: { type: 'string', description: 'Program text. Print only what the caller needs to read.' },
        cwd: { type: 'string', description: 'Working directory; defaults to the session working directory.' },
        timeoutMs: { type: 'number', description: 'Kill the child after this many milliseconds (default 120000).' },
      },
      required: ['language', 'code'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { text: { type: 'string' }, isError: { type: 'boolean' } },
        required: ['text', 'isError'],
        additionalProperties: false,
      },
      render: (_a, v) => [{ type: 'text', text: v && typeof v.text === 'string' ? v.text : 'ctk_execute finished' }],
    },
    timeoutMs: 300000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const language = String(args.language || 'javascript')
      const code = String(args.code || '')
      const cwd = resolveCwd(args.cwd, exec)
      const timeoutMs = Number(args.timeoutMs) > 0 ? Number(args.timeoutMs) : 120000

      if (language === 'shell') {
        const plan = shellPlan()
        const result = await runProcess(plan.command, plan.args(code), { cwd, timeoutMs, shell: false })
        const report = summarizeRun('ctk_execute · shell', result)
        recordSandbox(stats, 'ctk_execute', result, report.length)
        return { text: report, isError: !result.ok }
      }

      const plan = LANGUAGE_PLAN[language]
      if (!plan) return { text: 'unsupported language "' + language + '"; use javascript, typescript or shell', isError: true }
      const bin = language === 'typescript' ? (runtimes.typescript || runtimes.javascript) : runtimes.javascript
      if (!bin) return { text: 'no ' + language + ' runtime available in this process', isError: true }

      const { withTempScript } = await import('./lib/runner.js')
      const result = await withTempScript(plan.ext, code, (file) => {
        const spec = plan.run(file, bin)
        return runProcess(spec.command, spec.args, { cwd, timeoutMs })
      })
      const report = summarizeRun('ctk_execute · ' + language, result)
      recordSandbox(stats, 'ctk_execute', result, report.length)
      return { text: report, isError: !result.ok }
    },
  })
  stats.registered += 1

  if (toolSwitch(config, 'executeFile')) {
    ctx.tools.register({
      name: 'ctk_execute_file',
      description: 'Run code against a file on disk and return only the conclusion. The file text lives in the sandbox; the conversation receives the exit status and a bounded head/tail. Use it to read a large file for statistics, extraction or validation without pulling its bytes into the transcript.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File to read inside the sandbox.' },
          language: { type: 'string', enum: Object.keys(LANGUAGE_PLAN), description: 'Interpreter to run the code with.' },
          code: { type: 'string', description: 'Program text. Read the file from process.argv[2] and print only the conclusion.' },
          cwd: { type: 'string', description: 'Working directory; defaults to the session working directory.' },
          timeoutMs: { type: 'number', description: 'Kill the child after this many milliseconds (default 120000).' },
        },
        required: ['path', 'code'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { text: { type: 'string' }, isError: { type: 'boolean' } },
          required: ['text', 'isError'],
          additionalProperties: false,
        },
        render: (_a, v) => [{ type: 'text', text: v && typeof v.text === 'string' ? v.text : 'ctk_execute_file finished' }],
      },
      timeoutMs: 300000,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const language = String(args.language || 'javascript')
        const code = String(args.code || '')
        const target = String(args.path || '')
        if (!target) return { text: 'path is required', isError: true }
        const abs = isAbsolute(target) ? target : resolve(resolveCwd(args.cwd, exec), target)
        if (!existsSync(abs)) return { text: 'no such file: ' + abs, isError: true }
        let size = 0
        try { const st = statSync(abs); if (!st.isFile()) return { text: 'not a regular file: ' + abs, isError: true }; size = st.size }
        catch (error) { return { text: 'cannot stat ' + abs + ': ' + String(error && error.message), isError: true } }

        const cwd = resolveCwd(args.cwd, exec)
        const timeoutMs = Number(args.timeoutMs) > 0 ? Number(args.timeoutMs) : 120000
        const plan = LANGUAGE_PLAN[language]
        if (!plan) return { text: 'unsupported language "' + language + '"', isError: true }
        const bin = language === 'typescript' ? (runtimes.typescript || runtimes.javascript) : runtimes.javascript
        if (!bin) return { text: 'no ' + language + ' runtime available', isError: true }

        const { withTempScript } = await import('./lib/runner.js')
        const result = await withTempScript(plan.ext, code, (file) => {
          const spec = plan.run(file, bin)
          return runProcess(spec.command, spec.args.concat([abs, String(size)]), { cwd, timeoutMs })
        })
        const header = '## ctk_execute_file · ' + basename(abs) + ' (' + size + ' B)'
        const report = header + '\n' + summarizeRun('result', result).replace(/^## result\n/, '')
        // The file itself also stayed out of the conversation: count its bytes too.
        recordSandbox(stats, 'ctk_execute_file', result, report.length + size)
        return { text: report, isError: !result.ok }
      },
    })
    stats.registered += 1
  } else {
    log.info('ctk_execute_file 未启用')
  }

  if (toolSwitch(config, 'batchExecute')) {
    ctx.tools.register({
      name: 'ctk_batch_execute',
      description: 'Run several commands in one call and return one bounded report. Each command keeps its own exit status and byte counts, so a single call can answer many questions without expanding into many tool round trips. Use it for multi-command reconnaissance where only the conclusions matter.',
      parameters: {
        type: 'object',
        properties: {
          commands: {
            type: 'array',
            description: 'Commands to run, in order. Each is executed with the platform shell.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Short name shown in the report.' },
                command: { type: 'string', description: 'Command line to run.' },
                cwd: { type: 'string', description: 'Optional working directory for this command.' },
              },
              required: ['command'],
              additionalProperties: false,
            },
          },
          cwd: { type: 'string', description: 'Default working directory for every command.' },
          timeoutMs: { type: 'number', description: 'Per-command timeout in milliseconds (default 120000).' },
          concurrency: { type: 'number', description: 'How many commands to run at once (default 3, max 8).' },
        },
        required: ['commands'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { text: { type: 'string' }, isError: { type: 'boolean' } },
          required: ['text', 'isError'],
          additionalProperties: false,
        },
        render: (_a, v) => [{ type: 'text', text: v && typeof v.text === 'string' ? v.text : 'ctk_batch_execute finished' }],
      },
      timeoutMs: 600000,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const list = Array.isArray(args.commands) ? args.commands : []
        if (!list.length) return { text: 'commands is required and must not be empty', isError: true }
        const defaultCwd = resolveCwd(args.cwd, exec)
        const timeoutMs = Number(args.timeoutMs) > 0 ? Number(args.timeoutMs) : 120000
        const concurrency = Math.min(Math.max(Number(args.concurrency) || 3, 1), 8)
        const plan = shellPlan()
        const shellBin = plan.command
        const results = new Array(list.length)

        // A small worker pool: commands are independent, so overlapping them cuts
        // wall-clock time without changing what any single one reports.
        let cursor = 0
        const worker = async () => {
          for (;;) {
            const index = cursor++
            if (index >= list.length) return
            const item = list[index] || {}
            const command = String(item.command || '')
            const label = String(item.label || ('command ' + (index + 1)))
            const cwd = item.cwd ? resolve(defaultCwd, String(item.cwd)) : defaultCwd
            const started = Date.now()
            const result = await runProcess(shellBin, plan.args(command), { cwd, timeoutMs })
            results[index] = { label, command, result, elapsedMs: Date.now() - started }
          }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker))

        const blocks = results.map((entry) => {
          const r = entry.result
          const status = r.timedOut ? 'TIMEOUT' : (r.exitCode === 0 ? 'ok' : 'exit ' + r.exitCode)
          return summarizeRun(entry.label + ' — ' + status + ' (' + entry.elapsedMs + ' ms)',
            r, { headLines: 20, tailLines: 10 })
        })
        const failed = results.filter((e) => !e.result.ok).length
        const report = '## ctk_batch_execute · ' + results.length + ' commands, ' + failed + ' failed\n\n' + blocks.join('\n\n')
        let producedTotal = 0
        for (const entry of results) producedTotal += (Number(entry.result.stdoutBytes) || 0) + (Number(entry.result.stderrBytes) || 0)
        stats.bytesSandboxed += Math.max(0, producedTotal - report.length)
        stats.calls['ctk_batch_execute'] = (stats.calls['ctk_batch_execute'] || 0) + 1
        return { text: report, isError: failed === results.length }
      },
    })
    stats.registered += 1
  } else {
    log.info('ctk_batch_execute 未启用')
  }
}

// ── knowledge tools ─────────────────────────────────────────────────────────

const OUT_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' }, isError: { type: 'boolean' } },
  required: ['text', 'isError'],
  additionalProperties: false,
}

/** Shared response envelope for a tool that answers with text. */
function textTool(def, renderName) {
  return Object.assign({
    output: {
      schema: OUT_SCHEMA,
      render: (_a, v) => [{ type: 'text', text: v && typeof v.text === 'string' ? v.text : renderName + ' finished' }],
    },
    timeoutMs: 120000,
    isConcurrencySafe: () => true,
  }, def)
}

/** Strip tags, scripts and styles so a fetched page reads as text, not markup. */
export function htmlToText(html) {
  let text = String(html || '')
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  text = text.replace(/<!--[\s\S]*?-->/g, ' ')
  text = text.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
  text = text.replace(/<[^>]+>/g, '')
  text = text.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

/**
 * Explain a fetch failure in words that point at a fix.
 *
 * A bare "fetch failed" hides the cause: a host that resolves to 127.0.0.1 is a
 * local DNS interception, a refused connection is a blocked port, and those need
 * different remedies. The chain is walked so the report names the real problem.
 */
export function describeFetchFailure(error, url) {
  const message = String((error && error.message) || error)
  const cause = error && error.cause ? error.cause : null
  const code = cause && cause.code ? String(cause.code) : ''
  const address = cause && cause.address ? String(cause.address) : ''
  const port = cause && cause.port ? String(cause.port) : ''
  const target = address ? address + (port ? ':' + port : '') : ''
  if (/ECONNREFUSED/i.test(code) && (address === '127.0.0.1' || address === '::1')) {
    return message + ' — ' + (target || 'the local address') + ' refused the connection. '
      + 'This deployment resolves host names to the loopback address, so outbound HTTPS cannot '
      + 'leave the process. File the material with ctk_index instead, or fetch it outside the plugin.'
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(code)) {
    return message + ' — the name did not resolve' + (target ? ' (' + target + ')' : '') + '.'
  }
  if (/ETIMEDOUT|Connect Timeout/i.test(message) || /ETIMEDOUT/i.test(code)) {
    return message + ' — the connection timed out' + (target ? ' (' + target + ')' : '') + '.'
  }
  if (/CERT|TLS|SSL|self.signed/i.test(message)) {
    return message + ' — the TLS handshake failed. A local interception certificate is the usual cause.'
  }
  return message + (code ? ' (' + code + (target ? ' at ' + target : '') + ')' : '')
}

function registerKnowledgeTools(ctx, config, stats, store, log) {
  if (toolSwitch(config, 'index')) {
    ctx.tools.register(textTool({
      name: 'ctk_index',
      description: 'File large material into the local full-text knowledge base and keep its bytes out of the conversation. Accepts literal text or a path on disk; retrieve it later with ctk_search, which returns only the matching sections. Re-indexing the same path replaces the earlier copy.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Literal text to file. Use either text or path, not both.' },
          path: { type: 'string', description: 'File to read and file.' },
          title: { type: 'string', description: 'Display title; defaults to the file name.' },
        },
        additionalProperties: false,
      },
      async execute(args) {
        const hasText = typeof args.text === 'string' && args.text.length > 0
        const hasPath = typeof args.path === 'string' && args.path.trim().length > 0
        if (!hasText && !hasPath) return { text: 'provide either text or path', isError: true }
        try {
          const label = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : ''
          const result = hasText
            ? store.indexDocument({ path: 'text:' + (label || 'inline') + ':' + Date.now(), title: label, text: args.text })
            : store.indexFile(args.path, { title: args.title })
          stats.bytesIndexed = (stats.bytesIndexed || 0) + result.bytes
          const totals = store.stats()
          return {
            text: [
              '## ctk_index',
              '- filed: ' + result.path,
              '- chunks: ' + result.chunks + '  (' + result.bytes + ' B)' + (result.replaced ? '  [replaced the previous copy]' : ''),
              '- knowledge base: ' + totals.documents + ' documents / ' + totals.chunks + ' chunks',
            ].join('\n'),
            isError: false,
          }
        } catch (error) {
          return { text: 'ctk_index failed: ' + String((error && error.message) || error), isError: true }
        }
      },
    }, 'ctk_index'))
    stats.registered += 1
  }

  if (toolSwitch(config, 'search')) {
    ctx.tools.register(textTool({
      name: 'ctk_search',
      description: 'Retrieve matching sections from the local knowledge base. Results carry the heading and a bounded excerpt centred on the match, so material filed earlier can be consulted without reading it whole again. Accepts several queries in one call.',
      parameters: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            description: 'One or more queries; each keeps its own result list.',
            items: { type: 'string' },
          },
        },
        required: ['queries'],
        additionalProperties: false,
      },
      async execute(args) {
        const queries = Array.isArray(args.queries) ? args.queries : (args.queries ? [args.queries] : [])
        if (!queries.length) return { text: 'queries is required', isError: true }
        const limit = Math.max(1, Number(config.searchLimit) || 5)
        const maxChars = Math.max(100, Number(config.snippetChars) || 900)
        let results = []
        try {
          results = store.search(queries, { limit, maxChars })
        } catch (error) {
          return { text: 'ctk_search failed: ' + String((error && error.message) || error), isError: true }
        }
        const lines = ['## ctk_search']
        let total = 0
        for (const group of results) {
          lines.push('')
          if (group.error) { lines.push('### ' + group.query + ' — error: ' + group.error); continue }
          lines.push('### ' + group.query + ' — ' + group.hits.length + ' hit(s)')
          total += group.hits.length
          for (const hit of group.hits) {
            lines.push('- **' + (hit.title || hit.path) + '**' + (hit.heading ? ' › ' + hit.heading : ''))
            lines.push('  - ' + hit.path)
            lines.push('  - ~~~')
            for (const l of hit.snippet.split('\n').slice(0, 20)) lines.push('    ' + l)
            lines.push('  - ~~~')
          }
        }
        if (total === 0) lines.push('', 'no matches. File material first with ctk_index or ctk_fetch_and_index.')
        return { text: lines.join('\n'), isError: false }
      },
    }, 'ctk_search'))
    stats.registered += 1
  }

  if (toolSwitch(config, 'fetchAndIndex')) {
    ctx.tools.register(textTool({
      name: 'ctk_fetch_and_index',
      description: 'Fetch one or more pages and file them straight into the knowledge base, returning only a short preview per page. This is the cheap alternative to pasting a whole page into the conversation; follow up with ctk_search to pull the sections you need.',
      parameters: {
        type: 'object',
        properties: {
          requests: {
            type: 'array',
            description: 'Pages to fetch and file.',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'Absolute http(s) URL.' },
                source: { type: 'string', description: 'Optional label used as the display title.' },
              },
              required: ['url'],
              additionalProperties: false,
            },
          },
          url: { type: 'string', description: 'Single URL form, when only one page is needed.' },
          source: { type: 'string', description: 'Label for the single-URL form.' },
        },
        additionalProperties: false,
      },
      timeoutMs: 180000,
      async execute(args) {
        const list = Array.isArray(args.requests) && args.requests.length
          ? args.requests
          : (args.url ? [{ url: args.url, source: args.source }] : [])
        if (!list.length) return { text: 'provide requests[] or url', isError: true }
        const maxBytes = Math.max(1024, Number(config.fetchMaxBytes) || 2000000)
        const lines = ['## ctk_fetch_and_index']
        let ok = 0
        for (const item of list) {
          const url = String(item.url || '')
          if (!/^https?:\/\//i.test(url)) { lines.push('- ' + url + ' — skipped: not an http(s) URL'); continue }
          try {
            const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'dsh-context-toolkit' } })
            const raw = await response.text()
            const body = raw.length > maxBytes ? raw.slice(0, maxBytes) : raw
            const text = htmlToText(body)
            const result = store.indexDocument({ path: url, title: item.source || url, text })
            stats.bytesIndexed = (stats.bytesIndexed || 0) + result.bytes
            ok += 1
            lines.push('- ' + url + ' — HTTP ' + response.status + '  ' + result.chunks + ' chunks  (' + result.bytes + ' B filed)')
          } catch (error) {
            lines.push('- ' + url + ' — failed: ' + describeFetchFailure(error, url))
          }
        }
        const totals = store.stats()
        lines.push('', ok + '/' + list.length + ' filed · knowledge base: ' + totals.documents + ' documents / ' + totals.chunks + ' chunks')
        lines.push('use ctk_search(queries) to pull the sections you need.')
        return { text: lines.join('\n'), isError: ok === 0 }
      },
    }, 'ctk_fetch_and_index'))
    stats.registered += 1
  }

  if (toolSwitch(config, 'purge')) {
    ctx.tools.register(textTool({
      name: 'ctk_purge',
      description: 'Delete filed material from the local knowledge base. Destructive and not recoverable, so it requires confirm: true. Pass path for one document, or all: true to clear everything.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Document path to remove.' },
          all: { type: 'boolean', description: 'Remove every document.' },
          confirm: { type: 'boolean', description: 'Must be true, or nothing is deleted.' },
        },
        required: ['confirm'],
        additionalProperties: false,
      },
      async execute(args) {
        if (args.confirm !== true) {
          const totals = store.stats()
          const would = args.all ? totals.documents : (args.path ? 1 : 0)
          return { text: 'refused: confirm:true is required. This would remove ' + would + ' document(s) (the store currently holds ' + totals.documents + ').', isError: true }
        }
        const result = store.purge({ path: args.path, all: args.all === true })
        const totals = store.stats()
        return {
          text: '## ctk_purge\n- removed: ' + result.removed + ' (' + result.scope + ')\n- remaining: ' + totals.documents + ' documents / ' + totals.chunks + ' chunks',
          isError: false,
        }
      },
    }, 'ctk_purge'))
    stats.registered += 1
  }

  log.info('knowledge base ready: ' + JSON.stringify(store.stats()))
}

/**
 * Count what the sandbox kept out of the conversation.
 *
 * The saving is everything the child produced minus the bounded head/tail that
 * actually crossed back — so a 1 MB command that returns 4 KB is credited with
 * the remaining bytes, which is the number the ledger should report.
 */
function recordSandbox(stats, tool, result, reportChars) {
  const produced = (Number(result.stdoutBytes) || 0) + (Number(result.stderrBytes) || 0)
  // The saving is what the conversation did NOT have to carry: everything the
  // child produced, minus the characters actually handed back in the report.
  // Counting only the discarded tail understated the ledger badly — a 200 KB
  // output that came back as an 800-character summary saved ~199 KB, yet the
  // old formula credited zero because nothing was truncated.
  const returned = Math.max(0, Number(reportChars) || 0)
  const kept = Math.max(0, produced - returned)
  stats.bytesSandboxed += kept
  stats.calls[tool] = (stats.calls[tool] || 0) + 1
  return kept
}

// ── context occupancy ──────────────────────────────────────────────────────

export const STATUS_PATH = '/_dsh/context-toolkit/status'

/**
 * Measure one session's occupancy through the host's own meter.
 *
 * The meter is the authority for surface tokens; the breakdown projection is the
 * authority for the category split. Either can be absent, and the caller is told
 * which one is missing rather than shown a zero.
 */
function measureContext(ctx, session, config, stats) {
  const out = { ok: false, why: '', totalTokens: null, surfaceTokens: null, breakdown: null, nodes: null, budget: null, overBudget: null }
  if (!session) { out.why = 'no session is addressable from a page request; call ctk_context_report in the conversation for a live reading'; return out }
  let measured = null
  try {
    const meter = ctx.get('tokenMeter')
    if (!meter || typeof meter.measure !== 'function') { out.why = 'the host provides no tokenMeter service'; return out }
    measured = meter.measure(session)
  } catch (error) { out.why = 'tokenMeter threw: ' + String((error && error.message) || error); return out }
  if (!measured || typeof measured !== 'object') { out.why = 'tokenMeter returned no measurement'; return out }

  out.ok = true
  out.at = Date.now()
  out.totalTokens = Number(measured.totalTokens) || 0
  out.surfaceTokens = Number(measured.surfaceTokens) || 0
  out.budget = Number(readVolatile(config.compressNudgeTokens, 120000)) || 0
  out.overBudget = out.surfaceTokens >= out.budget

  let bd = null
  try {
    const projections = ctx.get('sessionProjections')
    if (projections && typeof projections.stateOf === 'function') bd = projections.stateOf(session, 'contextBreakdown')
    if ((bd === undefined || bd === null) && projections && typeof projections.read === 'function') bd = projections.read(session, 'contextBreakdown')
  } catch { /* the estimate below still stands */ }
  if (bd && typeof bd === 'object' && bd.view && typeof bd.view === 'object') bd = bd.view
  if (bd && typeof bd === 'object' && bd.systemTokens !== undefined) {
    const system = Number(bd.systemTokens) || 0
    const tools = Number(bd.toolsTokens) || 0
    const messages = Number(bd.messageTokens) || 0
    out.breakdown = { system, tools, messages, total: system + tools + messages, estimated: false }
  } else if (Array.isArray(measured.nodes) && measured.nodes.length > 0) {
    const systemNode = measured.nodes.filter((n) => n && n.system).pop() || null
    const system = systemNode ? (Number(systemNode.heuristicTokens) || 0) : 0
    const total = measured.nodes.reduce((sum, n) => sum + ((n && Number(n.heuristicTokens)) || 0), 0)
    out.breakdown = { system, tools: 0, messages: Math.max(0, total - system), total, estimated: true }
  }
  if (Array.isArray(measured.nodes) && measured.nodes.length > 0) {
    out.nodes = measured.nodes
      .map((n) => ({ seq: n && n.seq, system: Boolean(n && n.system), tokens: (n && Number(n.heuristicTokens)) || 0 }))
      .sort((a, b) => b.tokens - a.tokens).slice(0, 15)
  }
  stats.lastMeasure = out
  return out
}

function sendJson(res, status, body) {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  } catch { /* the response may already be closed */ }
}

/**
 * Mount the panel's data route.
 *
 * A page request has no initiator boundary, so the live session is resolved in
 * three steps: a request-scoped session, the current initiator, then the most
 * recently created live root conversation. The last step is what makes the panel
 * work at all on a cold start, where no measurement has happened yet.
 */
function registerStatusRoute(ctx, config, stats, store, storageDir) {
  if (!config['tools.contextReport']) return
  if (typeof ctx.inject !== 'function') return
  try {
    ctx.inject(['webServer'], (scoped) => {
      const server = scoped && scoped.webServer
      if (!server || typeof server.register !== 'function') return
      const handler = async (req, res) => {
        const method = String((req && req.method) || 'GET').toUpperCase()
        if (method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return }
        try {
          let session
          let sessionSource = 'none'
          try {
            if (req && req.session !== undefined && req.session !== null) { session = req.session; sessionSource = 'request' }
            else {
              const agents = ctx.get('agents')
              if (agents && typeof agents.currentInitiator === 'function') {
                const live = agents.currentInitiator()
                if (live !== undefined && live !== null) { session = live; sessionSource = 'initiator' }
              }
              if (session === undefined && agents && typeof agents.roots === 'function') {
                try {
                  const roots = agents.roots()
                  const last = Array.isArray(roots) && roots.length > 0 ? roots[roots.length - 1] : undefined
                  if (last && last.session) { session = last.session; sessionSource = 'root-agent' }
                } catch { /* fall through to the snapshot */ }
              }
            }
          } catch { session = undefined }

          sendJson(res, 200, {
            config: {
              routing: readVolatile(config.routing, true),
              denyCurlWget: readVolatile(config.denyCurlWget, true),
              bashNudgeMinCommandBytes: readVolatile(config.bashNudgeMinCommandBytes, 4096),
              maxReadBytesBeforeAsk: readVolatile(config.maxReadBytesBeforeAsk, 51200),
              compressNudgeTokens: readVolatile(config.compressNudgeTokens, 120000),
              searchLimit: readVolatile(config.searchLimit, 5),
              snippetChars: readVolatile(config.snippetChars, 900),
            },
            ledger: {
              registered: stats.registered,
              denied: stats.denied,
              deniedBytes: stats.deniedBytes,
              bytesSandboxed: stats.bytesSandboxed,
              bytesIndexed: stats.bytesIndexed,
            },
            knowledge: store
              ? (() => { try { return store.stats() } catch { return null } })()
              : null,
            context: (() => {
              const live = measureContext(ctx, session, config, stats)
              if (live.ok === true) return live
              if (stats.lastMeasure && stats.lastMeasure.ok === true) {
                return Object.assign({}, stats.lastMeasure, { stale: true, snapshotOf: 'last-tool-measurement' })
              }
              return live
            })(),
            sessionLookup: { source: sessionSource },
            storage: storageDir,
          })
        } catch (error) {
          sendJson(res, 500, { error: String((error && error.message) || error) })
        }
      }
      scoped.effect(() => server.register({ kind: 'exact', path: STATUS_PATH, handler }), 'context-toolkit: status route')
    })
  } catch { /* a missing web server must not stop the plugin from loading */ }
}

// ── observability tools ────────────────────────────────────────────────────

function registerObservabilityTools(ctx, config, stats, store, storageDir, log) {
  if (toolSwitch(config, 'stats')) {
    ctx.tools.register(textTool({
      name: 'ctk_stats',
      description: 'Report this plugin\'s savings ledger and knowledge-base usage. Shows how many calls the routing gate refused, how many bytes the sandbox kept out of the conversation, how many bytes were filed, and the per-tool call counts.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute() {
        const kb = store ? store.stats() : { documents: 0, chunks: 0, bytes: 0 }
        const produced = stats.bytesSandboxed + stats.bytesIndexed + stats.deniedBytes
        const keptOut = produced
        const uptimeMs = Date.now() - stats.startedAt
        const lines = [
          '## ctk_stats',
          '',
          '### 节约台账 / savings ledger',
          '- 门禁拦截 denied: ' + stats.denied + ' 次（约 ' + stats.deniedBytes + ' 字节未进入上下文）',
          '- 沙箱保留 bytesSandboxed: ' + stats.bytesSandboxed + ' 字节（子进程产出但只回结论的部分）',
          '- 已归档 bytesIndexed: ' + stats.bytesIndexed + ' 字节（存入知识库、未留在对话里）',
          '- 合计 kept out of context: ' + keptOut + ' 字节 ≈ ' + Math.round(keptOut / 4) + ' tokens（按 4 字节/token 估算）',
          '',
          '### 知识库 / knowledge base',
          '- 文档 documents: ' + kb.documents,
          '- 片段 chunks: ' + kb.chunks,
          '- 原文字节 bytes: ' + kb.bytes,
          '- 位置: ' + storageDir,
          '',
          '### 本插件注册的工具',
          '- 已注册 registered: ' + stats.registered,
          '',
          '### 调用计数 / call counts',
        ]
        const entries = Object.entries(stats.calls || {}).sort((a, b) => b[1] - a[1])
        if (entries.length) for (const [k, v] of entries) lines.push('- ' + k + ': ' + v)
        else lines.push('- （本次会话还没有调用过）')
        lines.push('')
        lines.push('- 运行时长 uptime: ' + Math.round(uptimeMs / 1000) + ' s')
        return { text: lines.join('\n'), isError: false }
      },
    }, 'ctk_stats'))
    stats.registered += 1
  }

  if (config['tools.contextReport']) {
    ctx.tools.register(textTool({
      name: 'ctk_context_report',
      description: 'Report this conversation\'s context occupancy: total pressure, surface occupancy, the split between system prompt / tool schemas / messages, the largest contributors, and the plugin\'s own savings ledger. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          detail: { type: 'string', enum: ['brief', 'full'], description: 'brief (default) reports totals and suggestions; full adds the per-node list.' },
        },
        additionalProperties: false,
      },
      async execute(args, exec) {
        const session = exec && exec.agent ? exec.agent.session : undefined
        const lines = ['## ctk_context_report']
        const measured = measureContext(ctx, session, config, stats)
        if (measured.ok !== true) {
          lines.push('', 'unavailable: ' + (measured.why || 'no measurement'))
          lines.push('', '### 本插件节约台账 / savings ledger')
          lines.push('- 门禁拦截 denied: ' + stats.denied + ' 次（' + stats.deniedBytes + ' 字节未进入上下文）')
          lines.push('- 沙箱保留 bytesSandboxed: ' + stats.bytesSandboxed + ' 字节')
          lines.push('- 已归档 bytesIndexed: ' + stats.bytesIndexed + ' 字节')
          lines.push('- 已注册 registered: ' + stats.registered)
          return { text: lines.join('\n'), isError: true }
        }
        lines.push('')
        lines.push('- 总压力 totalTokens: ' + measured.totalTokens)
        lines.push('- 表面占用 surfaceTokens: ' + measured.surfaceTokens)
        lines.push('- 提示阈值 budget: ' + measured.budget + (measured.overBudget ? '  ← 已超' : ''))
        const bd = measured.breakdown
        if (bd) {
          lines.push('')
          lines.push('### 分类构成' + (bd.estimated ? '（降级估算）' : ''))
          const pct = (v) => (bd.total > 0 ? Math.round((v / bd.total) * 100) : 0)
          lines.push('- 系统提示 system: ' + bd.system + ' (' + pct(bd.system) + '%)')
          lines.push('- 工具 schema tools: ' + bd.tools + ' (' + pct(bd.tools) + '%)')
          lines.push('- 会话消息 messages: ' + bd.messages + ' (' + pct(bd.messages) + '%)')
        }
        if (measured.overBudget) {
          lines.push('')
          lines.push('### 压缩建议')
          lines.push('- 表面占用已超阈值：把只用于分析的大块输出改走 ctk_execute / ctk_batch_execute，让原始字节不进上下文。')
          lines.push('- 已进上下文的材料可用 ctk_index 归档，之后用 ctk_search 按需取片段。')
        }
        if (args && args.detail === 'full' && Array.isArray(measured.nodes)) {
          lines.push('')
          lines.push('### 占用大头（前 ' + measured.nodes.length + ' 项）')
          for (const n of measured.nodes) lines.push('- seq ' + n.seq + (n.system ? ' [system]' : '') + ': ' + n.tokens + ' tokens')
        }
        lines.push('')
        lines.push('### 本插件节约台账 / savings ledger')
        lines.push('- 门禁拦截 denied: ' + stats.denied + ' 次（' + stats.deniedBytes + ' 字节未进入上下文）')
        lines.push('- 沙箱保留 bytesSandboxed: ' + stats.bytesSandboxed + ' 字节')
        lines.push('- 已归档 bytesIndexed: ' + stats.bytesIndexed + ' 字节')
        lines.push('- 已注册 registered: ' + stats.registered)
        return { text: lines.join('\n'), isError: false }
      },
    }, 'ctk_context_report'))
    stats.registered += 1
  }

  if (toolSwitch(config, 'doctor')) {
    ctx.tools.register(textTool({
      name: 'ctk_doctor',
      description: 'Self-check the plugin\'s own runtime: whether the interpreters it needs can actually be launched, whether the scratch directory is writable, whether the knowledge base answers, and whether the routing gate is mounted. Run it first when something misbehaves.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      timeoutMs: 120000,
      async execute() {
        const lines = ['## ctk_doctor', '']
        const ok = (label, detail) => lines.push('[OK]   ' + label + (detail ? ' — ' + detail : ''))
        const bad = (label, detail) => lines.push('[FAIL] ' + label + (detail ? ' — ' + detail : ''))
        const warn = (label, detail) => lines.push('[WARN] ' + label + (detail ? ' — ' + detail : ''))

        // runtimes
        let runtimes = {}
        try { runtimes = probeRuntimes() } catch { /* reported below */ }
        const runtimeNames = Object.keys(runtimes)
        if (runtimeNames.length) ok('运行时 Runtimes', runtimeNames.join(', '))
        else bad('运行时 Runtimes', '找不到任何可启动的解释器')

        // really launch one
        if (runtimes.javascript) {
          try {
            const r = await runProcess(runtimes.javascript, ['-e', 'console.log(1)'], { timeoutMs: 30000 })
            if (r.ok) ok('解释器实测', (r.stdout || '').trim())
            else bad('解释器实测', 'exit=' + r.exitCode + ' ' + String(r.error || r.stderr).slice(0, 120))
          } catch (error) { bad('解释器实测', String((error && error.message) || error)) }
        }

        // scratch dir
        try {
          const dir = scratchDir()
          const probe = mkdtempSync(join(dir, 'ctk-doctor-'))
          rmSync(probe, { recursive: true, force: true })
          ok('临时目录 Scratch dir', dir)
        } catch (error) { bad('临时目录 Scratch dir', String((error && error.message) || error)) }

        // knowledge base round-trip
        if (store) {
          try {
            const before = store.stats()
            const probeTarget = 'text:ctk-doctor:' + Date.now()
            store.indexDocument({ path: probeTarget, title: 'ctk-doctor-probe', text: 'doctor probe body zzq-marker' })
            const found = store.search(['zzq-marker'], { limit: 1 })
            const hit = found[0] && found[0].hits.length > 0
            store.purge({ path: probeTarget })
            if (hit) ok('知识库往返 Knowledge base', before.documents + ' documents before probe')
            else bad('知识库往返 Knowledge base', '写入成功但检索不到')
          } catch (error) { bad('知识库 Knowledge base', String((error && error.message) || error)) }
        } else warn('知识库 Knowledge base', '未打开（storageDir 不可写？）')

        // gate
        if (config.routing) ok('路由门禁 Routing gate', 'enabled (denied ' + stats.denied + ' so far)')
        else warn('路由门禁 Routing gate', 'disabled in settings')

        // storage
        ok('存储目录 Storage', storageDir)
        ok('版本 Version', '0.1.0')

        lines.push('')
        const failed = lines.filter((l) => l.startsWith('[FAIL]')).length
        const warned = lines.filter((l) => l.startsWith('[WARN]')).length
        lines.push(failed ? failed + ' check(s) failed, ' + warned + ' warning(s)' : 'all checks passed' + (warned ? ' (' + warned + ' warning(s))' : ''))
        return { text: lines.join('\n'), isError: failed > 0 }
      },
    }, 'ctk_doctor'))
    stats.registered += 1
  }
}

/** The session working directory wins over the process default. */
function resolveCwd(requested, exec) {
  if (typeof requested === 'string' && requested.trim()) {
    return isAbsolute(requested) ? requested : resolve(process.cwd(), requested)
  }
  try {
    const fromSession = exec && exec.agent && exec.agent.session && exec.agent.session.header
      ? exec.agent.session.header.cwd : null
    if (fromSession) return fromSession
  } catch { /* keep the process default */ }
  return process.cwd()
}
