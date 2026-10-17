/**
 * Deterministic output slimming.
 *
 * The gate in index.js stops bulk output at the door; this module handles what is
 * already inside. Nothing here calls a model: every strategy is a rule, so the same
 * input always yields the same output and a regression is reproducible.
 *
 * The red line is reversibility. Anything lossy is accompanied by a blob marker, and
 * the caller stores the exact original under that id before returning the slim text,
 * so a restore is byte-for-byte. Two gates stand between a candidate and adoption:
 * the result must be at most keepRatioMax of the original bytes AND its estimated
 * token count must be strictly lower. A compression that saves neither is not a
 * compression — it is a loss with a receipt.
 */
import { Buffer } from 'node:buffer'

/** Token estimate, matching the ledger's own accounting (4 bytes per token). */
export function estimateTokens(text) {
  return Math.ceil(Buffer.byteLength(String(text == null ? '' : text), 'utf8') / 4)
}

export const DEFAULT_LIMITS = {
  /** Ordinary output below this stays untouched. */
  minBytes: 1400,
  /** Error output gets a much higher floor: debugging needs fidelity, not economy. */
  errorMinBytes: 6000,
  /** Byte gate: an adopted replacement may not exceed this fraction of the original. */
  keepRatioMax: 0.72,
  /** Window shape for tabular output: verbatim head, stride-sampled middle, verbatim tail. */
  tableHeadRows: 60,
  tableTailRows: 40,
  tableStrideSamples: 40,
  /** Window shape for prose and logs. */
  headChars: 1200,
  tailChars: 800,
  /** Uniform JSON arrays up to this many rows are re-encoded losslessly. */
  losslessArrayMaxRows: 200,
}

/** Line-numbered tool output is code: the model may be about to edit exact bytes. */
function looksLikeNumberedSource(text) {
  const lines = text.split('\n')
  let numbered = 0
  for (const line of lines) {
    if (/^\s*\d+[|\u2192]/.test(line)) numbered += 1
  }
  return lines.length > 4 && numbered / lines.length > 0.5
}

/**
 * Was this output already truncated upstream, by the tool that produced it?
 *
 * Two markers are in the wild on this machine. A torn subprocess output ends with a
 * bracket notice naming the spill file; the ctk_* sandbox caps what it hands back and
 * ends with a tilde line. In both cases the bytes that would have flooded the context
 * are already gone and already stored elsewhere, so compressing again cannot save
 * anything — it only stores a second copy of the same original and claims the same
 * saving twice. Telling them apart is the difference between a gate and a gate that
 * bills the same traffic twice.
 */
export function isAlreadyTruncated(text) {
  const source = String(text == null ? '' : text)
  // The notice is a whole line, so anchor it: a passing mention of the phrase inside
  // prose must not exempt the body it appears in.
  if (/^\[output truncated; full output: .+\]$/m.test(source)) return 'upstream spill notice'
  if (/^~+$/m.test(source)) return 'sandbox capture cap'
  return null
}

/** What kind of output is this? The strategy follows the shape, not a guess. */
export function classify(text) {
  const source = String(text || '')
  const lines = source.split('\n').filter((l) => l.length > 0)
  if (!lines.length) return 'empty'

  const trimmed = source.trim()
  if ((trimmed.startsWith('[') || trimmed.startsWith('{')) && trimmed.length > 40) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed.length >= 5 && uniformObjectKeys(parsed)) return 'json-array'
    } catch { /* not JSON after all: fall through to the shape tests */ }
  }

  if (looksLikeNumberedSource(source)) return 'code'

  // Two separators already mean three columns: a table does not have to be wide to be
  // a table. The first cut required three, so an ordinary three-column report fell
  // through to the prose window and lost its line coordinates along with the saving.
  const pipeRows = lines.filter((l) => (l.match(/\|/g) || []).length >= 2)
  if (lines.length >= 8 && pipeRows.length / lines.length >= 0.7) return 'table'

  // Deciding this before the search test matters: a timestamped log (a date, a time,
  // then a level) matches a naive path:line pattern, and classifying it as search
  // folds a log by file and throws away the diagnostics that fold exists to protect.
  //
  // The test is the *shape* — a level prefix or a timestamp on most lines. Keying it
  // on error density instead put a log with no errors into the prose bucket, which
  // happens to be the same window today and stops being so the moment either changes.
  const logShaped = lines.filter((l) => /^\s*[\[(]?\d{2}:\d{2}|^\s*\[[a-z]+\]|^\s*(INFO|DEBUG|WARN|ERROR|TRACE)\b|^\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/i.test(l))
  if (lines.length >= 20 && logShaped.length / lines.length >= 0.4) return 'log'

  // Search output is a path, a line number, then a colon — and the path carries no
  // whitespace. Without that last part the timestamp above matched it.
  const hits = lines.filter((l) => /^[^\s:][^\s:]*:\d+(?::\d+)?[:.]/.test(l))
  if (lines.length >= 8 && hits.length / lines.length >= 0.4) return 'search'

  return 'prose'
}

/** Whether every element of an array is a flat object with the same keys. */
function uniformObjectKeys(rows) {
  const first = rows[0]
  if (first === null || typeof first !== 'object' || Array.isArray(first)) return false
  const keys = Object.keys(first)
  if (!keys.length) return false
  const signature = keys.slice().sort().join('\u0000')
  let same = 0
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue
    if (Object.keys(row).slice().sort().join('\u0000') === signature) same += 1
  }
  return same / rows.length >= 0.8
}

/**
 * Re-encode a uniform array without losing anything.
 *
 * Writing the keys once instead of once per row is where the saving comes from; the
 * values stay JSON, so the encoding is exact rather than approximate. This is the
 * route preferred whenever it applies, because a lossless saving needs no marker and
 * no restore.
 */
export function toonEncode(rows, name = 'rows') {
  const keys = Object.keys(rows[0])
  const header = name + '[' + rows.length + ']{' + keys.join(',') + '}:'
  const body = rows.map((row) => keys.map((k) => JSON.stringify(row[k] ?? null)).join(',')).join('\n')
  return { text: header + '\n' + body, keys }
}

/** Keep the head, stride-sample the middle with original line numbers, keep the tail. */
function windowTable(lines, header, limits) {
  const { tableHeadRows: head, tableTailRows: tail, tableStrideSamples: samples } = limits
  if (lines.length <= head + tail) return null
  const middle = lines.slice(head, lines.length - tail)
  const stride = Math.max(1, Math.floor(middle.length / Math.max(1, samples)))
  const picked = []
  for (let i = 0; i < middle.length; i += stride) {
    picked.push('L' + (head + i + 1) + ': ' + middle[i])
  }
  const kept = [...lines.slice(0, head), '… ' + (middle.length - picked.length) + ' rows sampled below (line numbers are original) …',
    ...picked, '… ' + tail + ' tail rows …', ...lines.slice(lines.length - tail)]
  return header ? [header].concat(kept) : kept
}

/**
 * Cut a string at a character boundary that does not split a surrogate pair.
 *
 * `String.prototype.slice` counts UTF-16 code units, so a naive cut through an
 * astral character (an emoji, an uncommon CJK ideograph) leaves a lone surrogate
 * behind. That lone surrogate then goes to the store, is written to SQLite as
 * UTF-8, and reads back as U+FFFD — the text a user is shown has been corrupted
 * at exactly the cut, while the ledger still claims the original is retrievable
 * byte-for-byte. The original *is* retrievable; the copy in the transcript is
 * what rotted, which is the one thing a reversible slimmer must never do.
 *
 * @param text - the source string.
 * @param index - a UTF-16 offset that may land inside a surrogate pair.
 * @returns the same offset, moved one code unit left when it would split a pair.
 */
function safeCut(text, index) {
  if (index <= 0) return 0
  if (index >= text.length) return text.length
  const before = text.charCodeAt(index - 1)
  const at = text.charCodeAt(index)
  // A high surrogate followed by a low one is a pair; cutting between them is the bug.
  const splitsPair = before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff
  return splitsPair ? index - 1 : index
}

/** Keep a head and a tail of a plain-text body, with an explicit elision marker. */
function windowText(text, limits) {
  const { headChars, tailChars } = limits
  if (text.length <= headChars + tailChars) return null
  // Both cuts go through safeCut: a lone surrogate here would corrupt the transcript
  // copy while the stored original stays intact, which is the worst of both worlds.
  const headEnd = safeCut(text, headChars)
  const tailStart = safeCut(text, text.length - tailChars)
  const head = text.slice(0, headEnd)
  const tail = text.slice(tailStart)
  const dropped = text.length - headChars - tailChars
  return head + '\n… ' + dropped + ' characters elided …\n' + tail
}

/**
 * Try to slim one text block.
 *
 * Returns an outcome only when a gate accepted it, and null when the body is too
 * small, is code, or when every candidate failed the never-worse gates. A null is
 * the honest answer: it means "leave this text alone".
 */
export function slimText(text, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) }
  const source = String(text == null ? '' : text)
  const originalBytes = Buffer.byteLength(source, 'utf8')
  const floor = options.isError ? limits.errorMinBytes : limits.minBytes
  if (originalBytes < floor) return null

  // Exempt before any strategy runs: work already done upstream is not work saved here.
  // Reported through onSkip so the caller can count it instead of silently ignoring it.
  const truncatedBy = isAlreadyTruncated(source)
  if (truncatedBy) {
    if (typeof options.onSkip === 'function') options.onSkip(truncatedBy)
    return null
  }

  const kind = classify(source)
  if (kind === 'code' || kind === 'empty') return null

  // Candidates are ranked. When a structural strategy cannot clear the never-worse
  // gates it is not the end of the story — a plain window almost always can, and
  // giving up instead left large, plainly savable bodies untouched (a grep result
  // whose files each held one match folded to the same size, and was kept intact).
  const candidates = []
  const lossless = false

  if (kind === 'json-array') {
    const rows = JSON.parse(source.trim())
    if (rows.length <= limits.losslessArrayMaxRows) {
      const encoded = toonEncode(rows, options.label || 'rows')
      candidates.push({ text: encoded.text, strategy: 'json-array lossless re-encoding', lossless: true })
    } else {
      const lines = rows.map((r) => JSON.stringify(r))
      const windowed = windowTable(lines, '# ' + rows.length + ' rows, one JSON object per line:', limits)
      if (windowed) candidates.push({ text: windowed.join('\n'), strategy: 'json-array windowed sampling' })
    }
  } else if (kind === 'table') {
    const lines = source.split('\n')
    const windowed = windowTable(lines, '', limits)
    if (windowed) candidates.push({ text: windowed.join('\n'), strategy: 'table window with line coordinates' })
  } else if (kind === 'search') {
    const lines = source.split('\n').filter((l) => l.length > 0)
    const byFile = new Map()
    for (const line of lines) {
      const m = line.match(/^([^:]+):(\d+)/)
      const file = m ? m[1] : '(unlabelled)'
      if (!byFile.has(file)) byFile.set(file, [])
      byFile.get(file).push(line)
    }
    const folded = []
    for (const [file, group] of byFile) {
      folded.push(file + ' (' + group.length + ' matches)')
      for (const line of group.slice(0, 12)) folded.push('  ' + line)
      if (group.length > 12) folded.push('  … ' + (group.length - 12) + ' more matches in this file …')
    }
    candidates.push({ text: folded.join('\n'), strategy: 'search folded by file' })
  } else if (kind === 'log') {
    const lines = source.split('\n')
    const interesting = lines.filter((l) => /error|fail|exception|assert|traceback|panic|warn/i.test(l))
    const others = lines.filter((l) => !interesting.includes(l))
    if (interesting.length && interesting.length < lines.length) {
      candidates.push({
        text: ['# ' + lines.length + ' lines, ' + others.length + ' repeat/ordinary lines folded away, diagnostics kept verbatim:']
          .concat(interesting.slice(0, 400)).join('\n'),
        strategy: 'log fold keeping diagnostics',
      })
    }
  }

  // The window is the shape-independent fallback, and it runs for every kind, not
  // only for prose. A structural strategy that cannot clear the gates should lose to
  // it, not cancel the attempt.
  const windowed = windowText(source, limits)
  if (windowed) candidates.push({ text: windowed, strategy: kind === 'prose' ? 'prose head/tail window' : 'head/tail window (fallback)' })

  if (!candidates.length) return null

  // The never-worse gates, applied to every candidate. Bytes first, then a strictly
  // lower token estimate: a replacement that saves neither is not a compression, it
  // is a loss with a receipt, and adopting it would make the ledger a liar.
  const tokensBefore = estimateTokens(source)
  let best = null
  for (const item of candidates) {
    const bytes = Buffer.byteLength(item.text, 'utf8')
    const ratio = bytes / Math.max(1, originalBytes)
    if (ratio > limits.keepRatioMax) continue
    const tokensAfter = estimateTokens(item.text)
    if (!(tokensAfter < tokensBefore)) continue
    // First passing candidate wins, and candidates are ordered by how much they
    // preserve rather than by how small they are. Picking the smallest byte count
    // instead let a plain window beat the table window — which threw away the line
    // coordinates that exist precisely so the model can ask for a middle row.
    best = { ...item, slimBytes: bytes, tokensAfter }
    break
  }
  if (!best) return null

  return {
    text: best.text,
    strategy: best.strategy,
    lossless: best.lossless === true,
    originalBytes,
    slimBytes: best.slimBytes,
    savedBytes: originalBytes - best.slimBytes,
    tokensBefore,
    tokensAfter: best.tokensAfter,
    savedTokens: tokensBefore - best.tokensAfter,
  }
}
