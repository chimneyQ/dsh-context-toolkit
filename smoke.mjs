/**
 * Offline smoke suite. Runs without DSH: a mock host context exercises the real
 * code paths, so a regression here means a real regression.
 *
 * The environment probes below are deliberately strict: this sandbox exports a
 * broken PATHEXT and no COMSPEC, and os.tmpdir() degenerates to "undefined\\temp".
 * A sandbox that cannot spawn its own interpreter is useless, so those are
 * covered by assertions rather than assumed.
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const mod = await import('file:///' + join(DIR, 'index.js').replace(/\\/g, '/'))

let pass = 0
let fail = 0
function check(label, fn) {
  try { fn(); pass += 1; console.log('  ok   ' + label) }
  catch (error) { fail += 1; console.log('  FAIL ' + label + ' :: ' + (error && error.message ? error.message : error)) }
}
async function checkAsync(label, fn) {
  try { await fn(); pass += 1; console.log('  ok   ' + label) }
  catch (error) { fail += 1; console.log('  FAIL ' + label + ' :: ' + (error && error.message ? error.message : error)) }
}

// ── mock host ───────────────────────────────────────────────────────────────
const registered = []
const guards = []
const handlers = {}
const workDir = mkdtempSync(join(DIR, '.smoke-'))
const mockCtx = {
  logger: { info: () => {}, warn: () => {} },
  get: (name) => undefined,
  on: (event, fn) => { handlers[event] = fn },
  inject: () => {},
  tools: {
    register: (def) => { registered.push(def); return () => {} },
    guard: (fn) => { guards.push(fn) },
  },
  systemPrompt: { section: () => {} },
  effect: (fn) => fn(),
}

console.log('== 1. contract ==')
check('exports apply as a function', () => assert.equal(typeof mod.apply, 'function'))
check('apply does not return a thenable', () => {
  const ret = mod.apply(mockCtx, { storageDir: workDir, routing: true })
  assert.ok(!(ret && typeof ret.then === 'function'))
})
check('no default export', () => assert.equal(Object.prototype.hasOwnProperty.call(mod, 'default'), false))
check('exports Config', () => assert.ok(mod.Config && mod.Config.dict))
check('exports a stable name', () => assert.equal(mod.name, 'dsh-context-toolkit'))
check('declares the tools service', () => assert.ok(Array.isArray(mod.inject) && mod.inject.includes('tools')))

console.log('== 2. tools registered ==')
const names = registered.map((d) => d.name).sort()
check('registers the sandbox, knowledge and observability tools', () => assert.deepEqual(names, ['ctk_batch_execute', 'ctk_context_report', 'ctk_doctor', 'ctk_execute', 'ctk_execute_file', 'ctk_fetch_and_index', 'ctk_index', 'ctk_purge', 'ctk_search', 'ctk_stats']))
check('every tool declares parameters, output and execute', () => {
  for (const def of registered) {
    assert.equal(typeof def.execute, 'function', def.name + ' lacks execute')
    assert.ok(def.parameters && def.parameters.type === 'object', def.name + ' lacks parameters')
    assert.ok(def.output && typeof def.output.render === 'function', def.name + ' lacks output.render')
  }
})

console.log('== 3. runtime discovery survives this sandbox ==')
const runner = await import('file:///' + join(DIR, 'lib', 'runner.js').replace(/\\/g, '/'))
check('a javascript runtime is found', () => assert.ok(runner.probeRuntimes().javascript, 'no node found'))
check('a shell is found', () => assert.ok(runner.probeRuntimes().shell, 'no shell found'))
check('the scratch dir is a real path, not "undefined\\temp"', () => {
  const dir = runner.scratchDir()
  assert.ok(!/undefined/i.test(dir), 'bogus scratch dir: ' + dir)
  assert.ok(existsSync(dir), 'scratch dir does not exist: ' + dir)
})
await checkAsync('a child can actually run the interpreter', async () => {
  const r = await runner.runProcess(runner.probeRuntimes().javascript, ['-e', 'console.log("alive")'])
  assert.equal(r.ok, true, 'spawn failed: ' + r.error)
  assert.equal(r.stdout.trim(), 'alive')
})
await checkAsync('a shell child can resolve a bare interpreter name', async () => {
  const plan = runner.shellPlan()
  const r = await runner.runProcess(plan.command, plan.args('node -v'), {})
  assert.equal(r.ok, true, 'bare name did not resolve: ' + r.stderr.slice(0, 120))
})

console.log('== 4. ctk_execute ==')
const tool = (n) => registered.find((d) => d.name === n)
await checkAsync('javascript runs under CommonJS (require available)', async () => {
  const r = await tool('ctk_execute').execute({ language: 'javascript', code: 'const os=require("os");console.log("ok")' }, {})
  assert.equal(r.isError, false, r.text)
  assert.ok(/ok/.test(r.text), r.text.slice(0, 200))
})
await checkAsync('esm runs under import syntax', async () => {
  const r = await tool('ctk_execute').execute({ language: 'esm', code: 'import {platform} from "node:os";console.log("ok")' }, {})
  assert.equal(r.isError, false, r.text)
})
await checkAsync('a nonzero exit is reported as an error', async () => {
  const r = await tool('ctk_execute').execute({ language: 'javascript', code: 'process.exit(7)' }, {})
  assert.equal(r.isError, true)
  assert.ok(/exit: 7/.test(r.text), r.text.slice(0, 200))
})
await checkAsync('an unsupported language is refused, not guessed', async () => {
  const r = await tool('ctk_execute').execute({ language: 'ruby', code: 'puts 1' }, {})
  assert.equal(r.isError, true)
  assert.ok(/unsupported language/.test(r.text))
})

console.log('== 5. output is bounded, never streamed whole ==')
await checkAsync('a 1 MB stdout is captured but reported as bytes, not pasted whole', async () => {
  const r = await tool('ctk_execute').execute({ language: 'javascript', code: 'process.stdout.write("x".repeat(1048576))' }, {})
  assert.equal(r.isError, false)
  assert.ok(r.text.length < 20000, 'the whole 1 MB reached the result: ' + r.text.length)
  assert.ok(/1048576 B captured/.test(r.text), 'byte count missing: ' + r.text.slice(0, 200))
})
await checkAsync('a timeout kills the child and says so', async () => {
  const r = await tool('ctk_execute').execute({ language: 'javascript', code: 'setTimeout(()=>{},60000)', timeoutMs: 1200 }, {})
  assert.equal(r.isError, true)
  assert.ok(/timed out/.test(r.text), r.text.slice(0, 200))
})

console.log('== 6. ctk_execute_file ==')
const big = join(workDir, 'big.txt')
writeFileSync(big, Array.from({ length: 4000 }, (_, i) => 'row ' + i + ' v=' + i).join('\n'), 'utf8')
await checkAsync('the file is analysed inside the sandbox and only the answer returns', async () => {
  const code = 'const fs=require("fs");const t=fs.readFileSync(process.argv[2],"utf8");const L=t.split("\\n");let s=0;for(const l of L){const m=l.match(/v=(\\d+)/);if(m)s+=+m[1];}console.log("lines="+L.length+" sum="+s);'
  const r = await tool('ctk_execute_file').execute({ path: big, language: 'javascript', code }, {})
  assert.equal(r.isError, false, r.text)
  assert.ok(/lines=4000/.test(r.text), r.text.slice(0, 300))
  assert.ok(r.text.length < 3000, 'the file body leaked into the result')
})
await checkAsync('a missing file is reported, not thrown', async () => {
  const r = await tool('ctk_execute_file').execute({ path: join(workDir, 'nope.txt'), language: 'javascript', code: 'console.log(1)' }, {})
  assert.equal(r.isError, true)
  assert.ok(/no such file/.test(r.text))
})

console.log('== 7. ctk_batch_execute ==')
await checkAsync('several commands return one report with per-command status', async () => {
  const r = await tool('ctk_batch_execute').execute({
    commands: [
      { label: 'good', command: 'node -v' },
      { label: 'bad', command: 'exit 3' },
    ],
  }, {})
  assert.equal(r.isError, false, 'partial failure must not mark the whole call failed')
  assert.ok(/good/.test(r.text) && /bad/.test(r.text), r.text.slice(0, 300))
  assert.ok(/exit 3/.test(r.text), 'per-command status missing')
})
await checkAsync('the shell reports a nonzero exit faithfully', async () => {
  const r = await tool('ctk_batch_execute').execute({ commands: [{ label: 'nope', command: 'exit 3' }] }, {})
  assert.ok(/exit 3/.test(r.text), 'exit code lost: ' + r.text.slice(0, 200))
})
await checkAsync('an empty command list is refused', async () => {
  const r = await tool('ctk_batch_execute').execute({ commands: [] }, {})
  assert.equal(r.isError, true)
})

console.log('== 8. routing gate ==')
check('the gate is mounted and guards are registered', () => {
  assert.equal(typeof handlers['tools/pre-execute'], 'function')
  assert.ok(guards.length >= 1, 'no monotonic guard')
})
const gate = handlers['tools/pre-execute']
const next = async () => ({ kind: 'next' })
const denies = async (command) => (await gate({ name: 'pwsh', arguments: { command } }, next)).kind === 'deny'
await checkAsync('curl and wget are refused', async () => {
  assert.equal(await denies('curl https://example.com'), true)
  assert.equal(await denies('wget https://example.com'), true)
  assert.equal(await denies('echo hi | curl -s https://x'), true)
})
await checkAsync('ordinary commands are not refused', async () => {
  assert.equal(await denies('echo hello'), false)
  assert.equal(await denies('node -v'), false)
})
await checkAsync('a word merely containing a flood tool name is not refused', async () => {
  assert.equal(await denies('echo curl-config'), false)
  assert.equal(await denies('echo curler'), false)
})
await checkAsync('a whole-file read over the threshold is nudged', async () => {
  const r = await gate({ name: 'read', arguments: { file_path: big } }, async () => ({ kind: 'ask' }))
  assert.notEqual(r.kind, 'next', 'oversized read was not flagged')
})
await checkAsync('a bounded read is left alone', async () => {
  const r = await gate({ name: 'read', arguments: { file_path: big, offset: 1, limit: 5 } }, next)
  assert.equal(r.kind, 'next')
})
await checkAsync('an exempt basename is left alone', async () => {
  const r = await gate({ name: 'read', arguments: { file_path: join(workDir, 'package.json') } }, next)
  assert.equal(r.kind, 'next')
})

console.log('== 9. knowledge base ==')
const kbDir = mkdtempSync(join(DIR, '.kb-'))
const storeMod = await import('file:///' + join(DIR, 'lib', 'store.js').replace(/\\/g, '/'))
const kb = storeMod.openStore(kbDir)

check('chunking splits at headings', () => {
  const cs = storeMod.chunkText('# A\n\ntext a\n\n## B\n\ntext b')
  assert.equal(cs.length, 2)
  assert.equal(cs[1].heading, 'B')
})
check('a heading inside a fenced block is not treated as a heading', () => {
  const cs = storeMod.chunkText('# A\n\n```\n## not a heading\n```\n\ntail')
  assert.ok(!cs.some((c) => c.heading === 'not a heading'), JSON.stringify(cs.map((c) => c.heading)))
})
check('filing text creates retrievable chunks', () => {
  const r = kb.indexDocument({ path: 'text:alpha', title: 'alpha', text: '# 手册\n\n## 检索\nBM25 排序与片段返回。' })
  assert.ok(r.chunks > 0)
  assert.equal(kb.stats().documents, 1)
})
check('searching returns the matching section', () => {
  const res = kb.search(['BM25'], { limit: 3 })
  assert.equal(res[0].hits.length >= 1, true, JSON.stringify(res))
  assert.equal(res[0].hits[0].heading, '检索')
})
check('a long snippet is centred on the match, not sliced from the start', () => {
  const big = Array.from({ length: 200 }, (_, i) => 'row ' + i + ' marker-' + i).join('\n')
  kb.indexDocument({ path: 'text:big', title: 'big', text: big })
  const res = kb.search(['marker-180'], { limit: 1, maxChars: 400 })
  assert.ok(res[0].hits.length >= 1, 'no hit for a term late in the document')
  assert.ok(res[0].hits[0].snippet.includes('marker-180'), 'the snippet does not contain the match')
})
check('re-filing the same target replaces instead of duplicating', () => {
  const before = kb.stats().documents
  kb.indexDocument({ path: 'text:alpha', title: 'alpha', text: '# 手册\n\n换了内容。' })
  assert.equal(kb.stats().documents, before, 'a duplicate row appeared')
})
check('purging one document leaves the others', () => {
  kb.purge({ path: 'text:big' })
  assert.equal(kb.stats().documents, 1)
})
check('purging everything empties the store', () => {
  kb.purge({ all: true })
  assert.equal(kb.stats().documents, 0)
  assert.equal(kb.stats().chunks, 0)
})
check('a label target is not mistaken for a disk path', () => {
  assert.equal(storeMod.normalizeTarget('https://example.com'), 'https://example.com')
  assert.equal(storeMod.normalizeTarget('text:label'), 'text:label')
})

await checkAsync('ctk_index files inline text and ctk_search reads it back', async () => {
  const r1 = await tool('ctk_index').execute({ text: '# 说明\n\n## 用法\n调用 ctk_search 取片段。', title: '说明' }, {})
  assert.equal(r1.isError, false, r1.text)
  const r2 = await tool('ctk_search').execute({ queries: ['ctk_search'] }, {})
  assert.equal(r2.isError, false, r2.text)
  assert.ok(/用法/.test(r2.text), r2.text.slice(0, 300))
})
await checkAsync('ctk_purge refuses without confirm', async () => {
  const r = await tool('ctk_purge').execute({ all: true, confirm: false }, {})
  assert.equal(r.isError, true)
  assert.ok(/confirm/.test(r.text), r.text)
})
await checkAsync('ctk_purge with confirm removes the document', async () => {
  const all = await tool('ctk_index').execute({ text: 'temp body for purge', title: 'temp' }, {})
  assert.equal(all.isError, false, all.text)
  const before = 1
  const r = await tool('ctk_purge').execute({ all: true, confirm: true }, {})
  assert.equal(r.isError, false, r.text)
  assert.ok(/removed/.test(r.text))
})
check('htmlToText strips markup, scripts and styles', () => {
  const html = '<html><head><style>b{}</style></head><body><h1>T</h1><p>p&amp;q</p><script>var x=1</script></body></html>'
  const text = mod.htmlToText(html)
  assert.ok(!/var x|<style|\{\}/.test(text), 'markup survived: ' + text)
  assert.ok(/T/.test(text) && /p&q/.test(text), text)
})
check('a fetch failure names a loopback refusal instead of "fetch failed"', () => {
  const err = new Error('fetch failed')
  err.cause = { code: 'ECONNREFUSED', address: '127.0.0.1', port: 443 }
  const text = mod.describeFetchFailure(err, 'https://example.com')
  assert.ok(/loopback/.test(text), text)
})
try { kb.close() } catch { /* best effort */ }
try { rmSync(kbDir, { recursive: true, force: true, maxRetries: 5 }) } catch { /* best effort */ }

console.log('== 10. observability ==')
await checkAsync('ctk_stats reports a ledger and call counts', async () => {
  const r = await tool('ctk_stats').execute({}, {})
  assert.equal(r.isError, false, r.text)
  assert.ok(/savings ledger/.test(r.text), r.text.slice(0, 200))
  assert.ok(/documents/.test(r.text))
})
await checkAsync('the ledger credits bytes the sandbox kept out, not only truncated tails', async () => {
  const before = Number((await tool('ctk_stats').execute({}, {})).text.match(/bytesSandboxed: (\d+)/)[1])
  await tool('ctk_execute').execute({ language: 'javascript', code: 'process.stdout.write("y".repeat(300000))' }, {})
  const after = Number((await tool('ctk_stats').execute({}, {})).text.match(/bytesSandboxed: (\d+)/)[1])
  assert.ok(after > before, 'ledger did not move: ' + before + ' -> ' + after)
  assert.ok(after - before > 250000, 'a 300 KB output should credit most of its bytes, moved only ' + (after - before))
})
await checkAsync('ctk_doctor runs its own checks and passes here', async () => {
  const r = await tool('ctk_doctor').execute({}, {})
  assert.equal(r.isError, false, r.text)
  assert.ok(/\[OK\]/.test(r.text), r.text.slice(0, 300))
  assert.ok(!/\[FAIL\]/.test(r.text), r.text)
})
await checkAsync('ctk_doctor cleans up its own probe document', async () => {
  // The doctor files a probe and removes it; verify through the tool surface, not
  // a shared handle, because the suite deliberately closed the standalone store.
  const before = await tool('ctk_stats').execute({}, {})
  const b = Number(before.text.match(/documents: (\d+)/)[1])
  const ran = await tool('ctk_doctor').execute({}, {})
  assert.equal(ran.isError, false, ran.text)
  const after = await tool('ctk_stats').execute({}, {})
  const a = Number(after.text.match(/documents: (\d+)/)[1])
  assert.equal(a, b, 'the doctor left a probe document behind: ' + b + ' -> ' + a)
})

console.log('== 11. config surface ==')
check('every control is a flat volatile key', () => {
  const keys = Object.keys(mod.Config.dict)
  for (const key of keys) assert.ok(mod.Config.dict[key].meta.volatile === true, key + ' is not volatile')
})
check('tool switches are flat dotted names, not a nested object', () => {
  const keys = Object.keys(mod.Config.dict).filter((k) => k.startsWith('tools.'))
  assert.deepEqual(keys.sort(), ['tools.batchExecute', 'tools.contextReport', 'tools.doctor', 'tools.execute', 'tools.executeFile', 'tools.fetchAndIndex', 'tools.index', 'tools.purge', 'tools.search', 'tools.stats'])
})
check('readVolatile unwraps a live handle', () => {
  const handle = { [Symbol.for('cosmokit.volatile.read')]: () => 42 }
  assert.equal(mod.readVolatile(handle, 1), 42)
  assert.equal(mod.readVolatile(undefined, 1), 1)
})

try { rmSync(workDir, { recursive: true, force: true }) } catch { /* best effort */ }
console.log('')
console.log(fail === 0 ? 'ALL PASS (' + pass + ')' : fail + ' FAILED of ' + (pass + fail))
process.exit(fail === 0 ? 0 : 1)
