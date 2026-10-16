/**
 * Release readiness for dsh-context-toolkit.
 *
 * Mirrors the discipline used for dsh-model-rotator, minus the parts that do not
 * apply here (this package ships no vendor tree and no submission entry of its
 * own). Every assertion below is a property the published tarball must have;
 * several of them exist because the corresponding property was once broken.
 *
 * Self-relative on purpose: a check that reads a hardcoded path tests the
 * developer's disk, not the bytes about to be published.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pub = dirname(fileURLToPath(import.meta.url)).replace(/\\\\/g, '/')
const read = (f) => readFileSync(pub + '/' + f, 'utf8')
const manifest = JSON.parse(read('package.json'))
const index = read('index.js')
const client = read('client.js')
const store = read('lib/store.js')
const runner = read('lib/runner.js')
const readmeEn = read('README.md')
const readmeZh = read('README.zh.md')
const results = []
const ck = (label, cond, extra = '') => results.push([cond ? 'PASS' : 'FAIL', label, extra])

// 1. manifest / bundle contract
ck('1 dsh.bundle patch declared and on disk', manifest.dsh?.bundle?.patch === './cordis.patch.yml' && existsSync(pub + '/cordis.patch.yml'))
ck('2 client declaration is the web platform with injects', manifest.dsh?.client?.platform === 'web' && Array.isArray(manifest.dsh.client.inject) && manifest.dsh.client.inject.length === 4, JSON.stringify(manifest.dsh?.client ?? {}))
ck('3 every files[] entry exists', (manifest.files ?? []).every((f) => f.includes('*') || existsSync(pub + '/' + f)), JSON.stringify(manifest.files))
// Exports may use a wildcard (./locale/*.json); that target is a real directory
// of files, so it is checked by expanding it rather than by a single existsSync.
const expandsTo = (entry) => { if (!entry.includes('*')) return existsSync(join(pub, entry)); const [head, tail] = entry.split('*'); const abs = join(pub, head); return existsSync(abs) && readdirSync(abs).some((f) => f.endsWith(tail || '')) }
ck('4 every exports target exists', Object.values(manifest.exports ?? {}).every(expandsTo), JSON.stringify(manifest.exports))
ck('5 private is gone', manifest.private === undefined)
ck('6 license fields agree with LICENSE', manifest.license === 'MIT' && /MIT License/.test(read('LICENSE')))
ck('7 the entry point resolves', existsSync(pub + '/index.js') && existsSync(pub + '/client.js'))

// 2. zero third-party runtime dependencies: the package installs and runs with
//    nothing but the Node the host already ships.
ck('8 there are no runtime or peer dependencies', Object.keys(manifest.dependencies ?? {}).length === 0 && Object.keys(manifest.peerDependencies ?? {}).length === 0)
ck('9 the knowledge base rides on node:sqlite', /from 'node:sqlite'/.test(store) && /fts5\(/.test(store))

// 3. no bare host import in either half (a bare import would make the bundle
//    depend on a module the host may not resolve).
ck('10 index.js has no bare host import', !/^\s*import\s+[^'"]+\s+from\s+['"](?!node:|\.)/m.test(index))
ck('11 the client half is loaded through the module loader', /__ModuleLoader__\.load\(/.test(client) && client.includes('id: "' + manifest.name + '"'))

// 4. the tools the README advertises are the tools the code registers
// The tool name is declared on the registration object (`name: 'ctk_…'`); the
// trailing-argument form is used only by some of them, so matching that shape
// undercounted by three. Match the declaration, then deduplicate.
const registered = [...index.matchAll(/name: '(ctk_[a-z_]+)'/g)].map((m) => m[1])
const unique = [...new Set(registered)].sort()
ck('12 the ten ctk tools are registered', unique.length === 10 && unique.every((n) => /^ctk_[a-z_]+$/.test(n)), unique.join(','))
ck('13 README.zh names every registered tool', unique.every((n) => readmeZh.includes(n)), unique.filter((n) => !readmeZh.includes(n)).join(','))
ck('14 README lists the same count the suite reports', /66 /.test(readmeZh) && /66 checks/.test(readmeEn))
ck('15 the two READMEs mirror each other', (readmeZh.match(/^## /gm) ?? []).length === (readmeEn.match(/^## /gm) ?? []).length, 'zh=' + (readmeZh.match(/^## /gm) ?? []).length + ' en=' + (readmeEn.match(/^## /gm) ?? []).length)

// 5. the gate covers every shell the host exposes, not just the shipped names.
//    A gate that only knows about bash/pwsh is bypassable by calling ops_bash.
const SHELLS = ['ops_bash', 'bash', 'pwsh', 'shell', 'bash_persistent', 'pwsh_persistent']
ck('16 the routing gate covers every shell tool name', /SHELL_TOOL_NAMES = new Set\(\[/.test(index) && SHELLS.every((s) => index.includes("'" + s + "'")), SHELLS.filter((s) => !index.includes("'" + s + "'")).join(','))
// Matching the whole line for a flood tool is the shape this gate must not regress
// to: it missed `… | curl -s https://x` and denied `echo wget && echo done`, where the
// word is plainly an argument. Segment splitting is what makes both directions exact.
ck('16b the gate matches a segment command word, not a substring of the line', /function commandSegments\(/.test(index) && /function leadingWord\(/.test(index) && /function floodNameOf\(/.test(index))
ck('16c the gate strips exec prefixes and path suffixes', /EXEC_PREFIXES = new Set\(/.test(index) && /exe\|cmd\|bat\|ps1/.test(index))
// ops_bash runs a *file* when handed script_path, so a gate that reads only
// args.command sees nothing at all for those calls — the same bypass as the shell
// name list, one field over.
ck('16d the gate reads the script a shell call will run', /function shellTextOf\(args\)/.test(index) && /readFileSync\(args\.script_path/.test(index) && /const shellText = SHELL_TOOL_NAMES\.has\(toolName\) \? shellTextOf\(args\)/.test(index))
ck('17 curl and wget are hard-denied by default', /denyCurlWget: z\.boolean\(\)\.default\(true\)/.test(index) && /FLOOD_TOOLS = new Set\(\['curl', 'wget'/.test(index))
ck('18 the gate can be turned off but defaults on', /routing: z\.boolean\(\)\.default\(true\)/.test(index))

// 6. version reporting must come from the manifest, never a literal
ck('19 the reported version is read from the manifest', /export const PLUGIN_VERSION = readManifestVersion\(\)/.test(index) && !/ok\('版本 Version', '\d/.test(index))
ck('20 the manifest version is a plain semver and matches the tarball intent', /^\d+\.\d+\.\d+$/.test(manifest.version), manifest.version)

// 7. the schema loader capability-tests volatile() rather than presence
ck('21 the schema loader capability-tests volatile()', /\.volatile\(\)/.test(index) && /acceptsChain/.test(index))

// 8. SHA256SUMS covers every shipped byte and still matches
const sumLines = read('SHA256SUMS.txt').trim().split(/\r?\n/).filter((l) => !l.startsWith('#'))
const sums = sumLines.map((l) => l.split(/\s+/))
const mismatch = sums.filter(([hash, file]) => !existsSync(pub + '/' + file) || createHash('sha256').update(readFileSync(pub + '/' + file)).digest('hex') !== hash)
ck('22 SHA256SUMS matches the shipped bytes', mismatch.length === 0, mismatch.map((m) => m[1]).join(',') || sums.length + ' entries')
// files[] entries may be globs; expand them before asking what is covered.
const expand = (entry) => { if (!entry.includes('*')) return [entry]; const [head, tail] = entry.split('*'); const abs = join(pub, head); if (!existsSync(abs)) return []; return readdirSync(abs).filter((f) => f.endsWith(tail || '')).map((f) => head + f) }
const shippable = (manifest.files ?? []).flatMap(expand).filter((f) => /\.(js|yml|json|md|svg)$/.test(f))
ck('23 every shipped file is covered by SHA256SUMS', shippable.every((f) => sums.some(([, file]) => file === f)), shippable.filter((f) => !sums.some(([, file]) => file === f)).join(','))

// 9. no suite may import the plugin through a machine-local absolute path
const PATH_SIG = new RegExp(['D', ':/DS_', 'harness|', '插件', '开发'].join(''))
const hardcoded = readdirSync(pub).filter((f) => /^(test.*|smoke|release-check)\.mjs$/.test(f)).filter((f) => PATH_SIG.test(read(f)))
ck('24 no suite hardcodes a machine-local plugin path', hardcoded.length === 0, hardcoded.join(',') || 'none')

let failed = 0
for (const [st, label, extra] of results) { if (st === 'FAIL') failed += 1; console.log(st.padEnd(5), label, extra === '' ? '' : '[' + extra + ']') }
console.log('')
console.log(failed === 0 ? 'ALL PASS (' + results.length + ')' : failed + ' FAILED of ' + results.length)
process.exit(failed === 0 ? 0 : 1)
