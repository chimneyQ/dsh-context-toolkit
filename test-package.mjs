/**
 * Package-manifest contract tests.
 *
 * These exist because the failure they catch is invisible until install time: a
 * bundle that declares a browser half without publishing it makes the host fail
 * to compose its client graph and roll the whole profile back to defaults.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const results = []
const check = (label, cond, extra = '') => results.push([cond ? 'PASS' : 'FAIL', label, extra])

const exportsMap = pkg.exports || {}

check('1a package.json declares a name', typeof pkg.name === 'string' && pkg.name.length > 0, pkg.name)
check('1b the package is not private', pkg.private !== true)
check('1c a license is declared', typeof pkg.license === 'string', String(pkg.license))
check('1d the entry point exists on disk', existsSync(join(dir, exportsMap['.'] || './index.js')), String(exportsMap['.']))
check('1e the bundle patch is declared and exists', Boolean(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch) && existsSync(join(dir, pkg.dsh.bundle.patch)), String(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch))

// The crash case: a declared browser half that a tarball would not carry.
const declaresClient = Boolean(pkg.dsh && pkg.dsh.client)
check('2a dsh.client is declared', declaresClient)
if (declaresClient) {
  check('2b exports["./client"] exists', typeof exportsMap['./client'] === 'string', String(exportsMap['./client']))
  const clientTarget = exportsMap['./client']
  check('2c the client target exists on disk', Boolean(clientTarget && existsSync(join(dir, clientTarget))), String(clientTarget))
  const clientFile = basename(clientTarget || '')
  check('2d the client bundle is listed in files', (pkg.files || []).includes(clientFile), (pkg.files || []).join(','))
  check('2e the inject list is a non-empty list of strings', Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.length > 0 && pkg.dsh.client.inject.every((s) => typeof s === 'string'))
}

// No third-party runtime dependency may exist: the whole point of this package is
// that it installs and runs with nothing but the Node the host already ships.
const deps = Object.keys(pkg.dependencies || {})
const peer = Object.keys(pkg.peerDependencies || {})
check('3a there are no runtime dependencies', deps.length === 0, deps.join(','))
check('3b there are no peer dependencies', peer.length === 0, peer.join(','))

// Every file in the manifest must be shippable and present.
const expand = (entry) => {
  if (!entry.includes('*')) return existsSync(join(dir, entry)) ? [entry] : []
  const [head, tail] = entry.split('*')
  const abs = join(dir, head)
  if (!existsSync(abs)) return []
  return readdirSync(abs).filter((f) => f.endsWith(tail || '')).map((f) => head + f)
}
const listed = (pkg.files || []).flatMap(expand)
const absent = listed.filter((f) => !existsSync(join(dir, f)))
check('4a every listed file exists', absent.length === 0, 'missing: ' + absent.join(','))
check('4b the manifest lists more than one file', listed.length > 1, String(listed.length))

// The bundle half must register itself under the package name.
const indexSource = readFileSync(join(dir, exportsMap['.'] || './index.js'), 'utf8')
check('5a the bundle registers under the package name', indexSource.includes("export const name = '" + pkg.name + "'"), pkg.name)
// The version the plugin reports must be the version the manifest ships. It was
// hardcoded once and drifted (the doctor said 0.1.0 while the bundle shipped
// 0.2.0), which makes the one line meant to identify a build the least
// trustworthy one.
check('5e the reported version is read from the manifest, not hardcoded', /export const PLUGIN_VERSION = readManifestVersion\(\)/.test(indexSource) && !/ok\('版本 Version', '\d/.test(indexSource))
check('5f the manifest version is a plain semver', /^\d+\.\d+\.\d+$/.test(pkg.version), String(pkg.version))
check('5b it declares the tools service', /export const inject = \[[^\]]*'tools'/.test(indexSource))
const clientSource = declaresClient ? readFileSync(join(dir, exportsMap['./client']), 'utf8') : ''
check('5c the client bundle calls __ModuleLoader__.load', clientSource.includes('window.__ModuleLoader__.load('))
check('5d its module id equals the package name', clientSource.includes('id: "' + pkg.name + '"'))

const failed = results.filter((r) => r[0] === 'FAIL')
for (const r of results) console.log(r[0] + '  ' + r[1] + (r[2] ? '   [' + r[2] + ']' : ''))
console.log('')
console.log(failed.length === 0 ? 'ALL PASS (' + results.length + ')' : failed.length + ' FAILED of ' + results.length)
process.exit(failed.length === 0 ? 0 : 1)
