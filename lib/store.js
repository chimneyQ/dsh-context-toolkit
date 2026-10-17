/**
 * The local knowledge base.
 *
 * Large material is filed here and retrieved by section later, so the bytes
 * never occupy the conversation in the meantime. The whole store rides on
 * node:sqlite, whose FTS5 module ships with Node itself — no native build, no
 * third-party package, which is what keeps this plugin installable anywhere.
 *
 * Layout: one database per workspace. Documents are split into chunks at
 * heading boundaries so a search hit returns the relevant section rather than a
 * whole file, and chunk text is indexed with BM25 ranking.
 */
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'

const SCHEMA_VERSION = 1

/** Split text into indexable chunks at markdown headings, keeping code fences intact. */
export function chunkText(text, options = {}) {
  const { maxChars = 1800, minChars = 1 } = options
  const source = String(text || '')
  if (!source.trim()) return []

  const lines = source.split('\n')
  const chunks = []
  let heading = ''
  let buffer = []
  let size = 0
  let inFence = false

  const flush = () => {
    const body = buffer.join('\n').trim()
    if (body.length >= minChars) chunks.push({ heading, text: body })
    buffer = []
    size = 0
  }

  for (const line of lines) {
    // A fence toggles raw mode: a "## " inside a code block is not a heading.
    if (/^```/.test(line)) inFence = !inFence
    const isHeading = !inFence && /^#{1,6}\s+/.test(line)
    if (isHeading && size > 0) flush()
    if (isHeading) heading = line.replace(/^#{1,6}\s+/, '').trim()
    buffer.push(line)
    size += line.length + 1
    if (size >= maxChars && !inFence) flush()
  }
  flush()
  return chunks
}

/** A stable id for a document path, so re-indexing replaces rather than duplicates. */
export function documentKey(absPath) {
  const normalized = resolve(String(absPath)).replace(/\\/g, '/').toLowerCase()
  return createHash('sha256').update(normalized).digest('hex').slice(0, 24)
}

/**
 * Build a readable excerpt centred on the first query term found.
 *
 * Slicing from the start of a chunk hides the very words that matched whenever
 * the hit sits mid-chunk, which makes a search result useless for judging
 * relevance. The window opens just before the match and is marked when it is
 * not the beginning of the chunk.
 */
export function excerptAround(text, query, maxChars = 900) {
  const body = String(text || '')
  if (body.length <= maxChars) return body
  const terms = String(query || '').split(/\s+/).filter((t) => t.length > 1)
  let at = -1
  for (const term of terms) {
    const found = body.toLowerCase().indexOf(term.toLowerCase())
    if (found >= 0 && (at < 0 || found < at)) at = found
  }
  if (at < 0) return body.slice(0, maxChars)
  const back = Math.floor(maxChars * 0.3)
  const start = Math.max(0, at - back)
  const end = Math.min(body.length, start + maxChars)
  return (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '')
}

export function openStore(storageDir) {
  mkdirSync(storageDir, { recursive: true })
  const dbPath = join(storageDir, 'knowledge.db')
  const db = new DatabaseSync(dbPath)

  // The schema is created idempotently; an FTS5 virtual table backs retrieval.
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS documents (
      doc_key TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      title TEXT,
      bytes INTEGER,
      mtime_ms INTEGER,
      chunks INTEGER,
      indexed_at_ms INTEGER
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
      body,
      doc_key UNINDEXED,
      path UNINDEXED,
      title UNINDEXED,
      heading UNINDEXED,
      ord UNINDEXED,
      tokenize = 'unicode61'
    );
    -- Reversible storage. The chunks table is lossy by construction (it trims and
    -- hard-splits at maxChars), so it can never hand back the exact bytes it was
    -- given. Compression needs the opposite guarantee: whatever replaces the text
    -- must be restorable byte-for-byte, which means the original has to be kept
    -- somewhere verbatim. Keeping it in this same database rather than a second
    -- store is the point — one file, two jobs: FTS5 finds sections, blobs restore them.
    CREATE TABLE IF NOT EXISTS blobs (
      blob_id TEXT PRIMARY KEY,
      body BLOB NOT NULL,
      bytes INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
  `)
  db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION))
  return makeApi(db, dbPath, storageDir)
}

/** Paths that are labels rather than disk locations must survive resolve(). */
export function normalizeTarget(path) {
  const value = String(path || '')
  if (/^(text|memory|https?):/i.test(value)) return value
  return resolve(value)
}

function makeApi(db, dbPath, storageDir) {
  const insertChunk = db.prepare('INSERT INTO chunks(body, doc_key, path, title, heading, ord) VALUES (?, ?, ?, ?, ?, ?)')
  const deleteChunks = db.prepare('DELETE FROM chunks WHERE doc_key = ?')
  const upsertDoc = db.prepare(`INSERT OR REPLACE INTO documents
    (doc_key, path, title, bytes, mtime_ms, chunks, indexed_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const findDoc = db.prepare('SELECT * FROM documents WHERE doc_key = ?')

  const insertBlob = db.prepare('INSERT OR REPLACE INTO blobs(blob_id, body, bytes, created_at_ms) VALUES (?, ?, ?, ?)')
  const selectBlob = db.prepare('SELECT body, bytes, created_at_ms FROM blobs WHERE blob_id = ?')

  return {
    /**
     * Store an original verbatim under a caller-chosen id.
     *
     * The bytes go in as a BLOB and come back as a Buffer, so nothing between the
     * two ends re-encodes them: a restore is only meaningful if it is exact, and
     * TEXT round-tripping is one surprise away from not being.
     */
    putBlob(id, text) {
      const blobId = String(id || '')
      if (!blobId) throw new Error('putBlob needs an id')
      const body = Buffer.from(String(text == null ? '' : text), 'utf8')
      insertBlob.run(blobId, body, body.length, Date.now())
      return { id: blobId, bytes: body.length }
    },

    /** Read a stored original back byte-for-byte; null when the id is unknown. */
    getBlob(id) {
      const row = selectBlob.get(String(id || ''))
      if (!row) return null
      return { id: String(id), text: Buffer.from(row.body).toString('utf8'), bytes: Number(row.bytes) || 0, createdAtMs: Number(row.created_at_ms) || 0 }
    },

    /**
     * Drop stored originals: specific ids, everything older than an age, or all.
     *
     * The three modes answer different questions. A caller whose marker never reached
     * the model removes the one id it just wrote; a retention policy removes by age; a
     * reset removes all. Removing by id first means a rollback cannot take an unrelated
     * original down with it.
     */
    purgeBlobs({ ids = [], olderThanMs = 0, all = false } = {}) {
      if (all) {
        const n = db.prepare('SELECT COUNT(*) AS n FROM blobs').get().n
        db.exec('DELETE FROM blobs;')
        return { removed: Number(n) || 0 }
      }
      const list = (Array.isArray(ids) ? ids : [ids]).map((v) => String(v || '')).filter(Boolean)
      if (list.length) {
        const del = db.prepare('DELETE FROM blobs WHERE blob_id = ?')
        let removed = 0
        for (const id of list) removed += Number(del.run(id).changes) || 0
        return { removed }
      }
      if (!(olderThanMs > 0)) return { removed: 0 }
      const cutoff = Date.now() - olderThanMs
      const n = db.prepare('SELECT COUNT(*) AS n FROM blobs WHERE created_at_ms < ?').get(cutoff).n
      db.prepare('DELETE FROM blobs WHERE created_at_ms < ?').run(cutoff)
      return { removed: Number(n) || 0 }
    },

    /** Drop originals older than a retention in minutes; 0 means keep forever. */
    purgeBlobsOlderThan(minutes) {
      const n = Number(minutes)
      // An explicit 0 is a policy ("keep forever"), not an oversight, so it must not be
      // read as "expire immediately".
      if (!(n > 0)) return { removed: 0 }
      return this.purgeBlobs({ olderThanMs: n * 60000 })
    },

    /** File one document, replacing any earlier version of the same path. */
    indexDocument({ path, title, text, mtimeMs }) {
      const abs = normalizeTarget(path)
      const key = documentKey(abs)
      const body = String(text == null ? '' : text)
      const chunks = chunkText(body)
      const meta = findDoc.get(key)
      const now = Date.now()

      const write = db.prepare('BEGIN')
      write.run()
      try {
        deleteChunks.run(key)
        upsertDoc.run(key, abs, String(title || basename(abs)), Buffer.byteLength(body, 'utf8'),
          Number(mtimeMs) || 0, chunks.length, now)
        chunks.forEach((c, i) => insertChunk.run(c.text, key, abs, String(title || basename(abs)), c.heading || '', i))
        db.prepare('COMMIT').run()
      } catch (error) {
        try { db.prepare('ROLLBACK').run() } catch { /* already rolled back */ }
        throw error
      }
      return { key, path: abs, chunks: chunks.length, bytes: Buffer.byteLength(body, 'utf8'), replaced: Boolean(meta) }
    },

    /** Index a file straight from disk. */
    indexFile(path, options = {}) {
      const abs = normalizeTarget(path)
      if (!existsSync(abs)) throw new Error('no such file: ' + abs)
      const st = statSync(abs)
      if (!st.isFile()) throw new Error('not a regular file: ' + abs)
      const text = readFileSync(abs, 'utf8')
      return this.indexDocument({ path: abs, title: options.title, text, mtimeMs: st.mtimeMs })
    },

    /**
     * Search the knowledge base.
     *
     * BM25 ranks the chunks; results carry the heading so a caller can decide
     * which section is worth opening in full.
     */
    search(queries, options = {}) {
      const list = Array.isArray(queries) ? queries : [queries]
      const { limit = 5, maxChars = 900 } = options
      const results = []
      for (const raw of list) {
        const query = String(raw || '').trim()
        if (!query) continue
        // Quote each term so FTS5 treats user text as terms, not as operators.
        const terms = query.split(/\s+/).filter(Boolean).map((t) => '"' + t.replace(/"/g, '""') + '"')
        if (!terms.length) continue
        const match = terms.join(' OR ')
        let rows = []
        try {
          rows = db.prepare(`
            SELECT body, path, title, heading, bm25(chunks) AS score
            FROM chunks WHERE chunks MATCH ? ORDER BY score LIMIT ?
          `).all(match, limit)
        } catch (error) {
          results.push({ query, error: String((error && error.message) || error), hits: [] })
          continue
        }
        results.push({
          query,
          hits: rows.map((row) => {
            const body = String(row.body || '')
            return {
              path: row.path,
              title: row.title,
              heading: row.heading,
              snippet: excerptAround(body, query, maxChars),
              score: Number(row.score),
            }
          }),
        })
      }
      return results
    },

    /** Every document currently filed. */
    list() {
      return db.prepare('SELECT path, title, bytes, chunks, indexed_at_ms FROM documents ORDER BY indexed_at_ms DESC').all()
        .map((r) => ({ path: r.path, title: r.title, bytes: r.bytes, chunks: r.chunks, indexedAt: r.indexed_at_ms }))
    },

    /** Remove documents by path, by key, or all of them. */
    purge({ path, all = false } = {}) {
      if (all) {
        const count = db.prepare('SELECT COUNT(*) AS n FROM documents').get().n
        db.exec('DELETE FROM chunks; DELETE FROM documents;')
        return { removed: Number(count) || 0, scope: 'all' }
      }
      if (!path) return { removed: 0, scope: 'none' }
      const key = documentKey(path)
      const before = findDoc.get(key)
      deleteChunks.run(key)
      db.prepare('DELETE FROM documents WHERE doc_key = ?').run(key)
      return { removed: before ? 1 : 0, scope: 'path', path: normalizeTarget(path) }
    },

    stats() {
      const docs = db.prepare('SELECT COUNT(*) AS n FROM documents').get().n
      const chunks = db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n
      const bytes = db.prepare('SELECT COALESCE(SUM(bytes),0) AS n FROM documents').get().n
      const blobs = db.prepare('SELECT COUNT(*) AS n FROM blobs').get().n
      const blobBytes = db.prepare('SELECT COALESCE(SUM(bytes),0) AS n FROM blobs').get().n
      return { documents: Number(docs) || 0, chunks: Number(chunks) || 0, bytes: Number(bytes) || 0,
        blobs: Number(blobs) || 0, blobBytes: Number(blobBytes) || 0, dbPath }
    },

    close() { try { db.close() } catch { /* already closed */ } },
    _db: db,
    _storageDir: storageDir,
  }
}

export { SCHEMA_VERSION }
