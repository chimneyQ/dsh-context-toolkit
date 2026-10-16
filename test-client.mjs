/**
 * Client-bundle contract tests.
 *
 * The settings page is rendered by client.js, and the two halves must not drift:
 * a field the page stages that Config does not declare throws inside the real
 * form, and a module-loader shape the harness does not recognise composes nothing
 * at all. Both failure modes are silent in the browser, so they are asserted here.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const profile = (process.env.DSH_HOME || 'C:/Users/lenovo/.dsh') + '/profiles/desktop'
const results = []
const check = (label, cond, extra = '') => results.push([cond ? 'PASS' : 'FAIL', label, extra])

const source = readFileSync(join(DIR, 'client.js'), 'utf8')
const mod = await import(pathToFileURL(join(DIR, 'index.js')).href)

// ---- module-loader shape ---------------------------------------------------
check('1a client.js calls __ModuleLoader__.load', /window\.__ModuleLoader__\.load\(/.test(source))
check('1b the loader id equals the package name', source.includes('id: "dsh-context-toolkit"'))
check('1c it exports a factory taking require', /factory:\s*\(require\)\s*=>/.test(source))
check('1d the factory returns module.exports', /return module\.exports/.test(source))

// ---- required services -----------------------------------------------------
const injectMatch = source.match(/const inject = (\[[^\]]*\])/)
check('2a the client declares its required services', Boolean(injectMatch), injectMatch ? injectMatch[1] : 'not found')
if (injectMatch) {
  const services = JSON.parse(injectMatch[1].replace(/'/g, '"'))
  for (const needed of ['slots', 'locale', 'configForms']) {
    check('2b declares ' + needed, services.includes(needed), services.join(','))
  }
}

// ---- staged fields must exist in Config ------------------------------------
// The page builds its control list from two literals; parsing them is stabler
// than scanning for "field:" strings, which the tool switches build by
// concatenation rather than spelling out.
const fieldsLiteral = source.match(/const FIELDS = (\[[\s\S]*?\]);/)
const toolsLiteral = source.match(/const TOOL_FIELDS = (\[[^\]]*\]);/)
check('3a the page declares its control list', Boolean(fieldsLiteral && toolsLiteral))
const plainFields = fieldsLiteral ? JSON.parse(fieldsLiteral[1].replace(/\r?\n\s*/g, ' ').replace(/'/g, '"')) : []
const toolNames = toolsLiteral ? JSON.parse(toolsLiteral[1].replace(/'/g, '"')) : []
const allStaged = [...plainFields.map((f) => f.field), ...toolNames.map((n) => 'tools.' + n)]
const declared = new Set(Object.keys(mod.Config.dict))
check('3b the page stages fields', allStaged.length > 0, allStaged.join(','))
const missing = allStaged.filter((f) => !declared.has(f))
check('3c every staged field exists in Config', missing.length === 0, 'missing: ' + missing.join(','))
const undeclared = [...declared].filter((k) => !allStaged.includes(k))
check('3d every Config field is staged by the page', undeclared.length === 0, 'unstaged: ' + undeclared.join(','))

// ---- both dictionaries, same keys ------------------------------------------
const zh = JSON.parse(readFileSync(join(DIR, 'locale', 'zh.json'), 'utf8')).strings
const en = JSON.parse(readFileSync(join(DIR, 'locale', 'en.json'), 'utf8')).strings
check('4a both locale files carry their strings', Object.keys(zh).length > 0 && Object.keys(en).length > 0)
const zhKeys = Object.keys(zh).sort()
const enKeys = Object.keys(en).sort()
check('4b the two dictionaries hold the same keys', JSON.stringify(zhKeys) === JSON.stringify(enKeys),
  'zh=' + zhKeys.length + ' en=' + enKeys.length)
const zhOnly = zhKeys.filter((k) => !enKeys.includes(k))
const enOnly = enKeys.filter((k) => !zhKeys.includes(k))
check('4c neither dictionary is missing a key', zhOnly.length === 0 && enOnly.length === 0, 'zhOnly=' + zhOnly.join(',') + ' enOnly=' + enOnly.join(','))

// every key the page asks for must be translated
const asked = new Set()
for (const m of source.matchAll(/t\("([^"]+)"\)/g)) asked.add(m[1])
let missingText = []
for (const key of asked) if (!(key in zh) || !(key in en)) missingText.push(key)
check('4d every literal translation key exists in both dictionaries', missingText.length === 0, 'missing: ' + missingText.join(','))

// ---- the tool-switch list matches Config ------------------------------------
check('5a the page lists its tool switches', toolNames.length > 0, toolNames.join(','))
{
  const names = toolNames
  const served = names.map((n) => 'tools.' + n)
  const declaredTools = [...declared].filter((k) => k.startsWith('tools.'))
  check('5b every page switch has a Config key', served.every((k) => declared.has(k)), 'served=' + served.join(','))
  check('5c no served tool key is missing from the page', declaredTools.every((k) => served.includes(k)), 'page=' + names.join(','))

  // each switch needs both a name and a hint, or the row renders a raw key
  let missingLabels = []
  for (const n of names) {
    if (!(('tools.' + n) in zh) || !(('tools.' + n + 'Hint') in zh)) missingLabels.push('tools.' + n)
  }
  check('5d every switch has a name and a hint in both languages', missingLabels.length === 0, missingLabels.join(','))
}

// ---- panel + form are siblings, not nested ---------------------------------
check('6a the panel is rendered beside the form', /panel,\s*\n\s*note/.test(source.replace(/\r/g, '')))
check('6b the panel reads the plugin-owned route', source.includes('/_dsh/context-toolkit/status'))
check('6c the route path matches the server half', source.includes('const STATUS_PATH = "/_dsh/context-toolkit/status"') && mod.STATUS_PATH === '/_dsh/context-toolkit/status', mod.STATUS_PATH)

// ---- registration is unconditional -----------------------------------------
check('7a the client registers via slots.inject', source.includes('ctx.slots.inject("settings.section"') && source.includes('ctx.slots.inject("plugins.item"'))
check('7b registration is not gated on another namespace being served', !/whileServed/.test(source))
check('7c the locale dictionaries are registered through ctx.effect', /ctx\.effect\(\(\) => ctx\.locale\.register\(/.test(source))
check('7d the controller is disposed through ctx.effect', /ctx\.effect\(\(\) => \(\) => \{ card\.dispose\(\)/.test(source))

const failed = results.filter((r) => r[0] === 'FAIL')
for (const r of results) console.log(r[0] + '  ' + r[1] + (r[2] ? '   [' + r[2] + ']' : ''))
console.log('')
console.log(failed.length === 0 ? 'ALL PASS (' + results.length + ')' : failed.length + ' FAILED of ' + results.length)
process.exit(failed.length === 0 ? 0 : 1)
