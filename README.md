# dsh-context-toolkit

> [简体中文](./README.zh.md) | **English** | [Changelog](./CHANGELOG.md)

A DeepSeek Harness bundle whose single job is **keeping bulk output out of the conversation**.

It separates *raw bytes* from *conclusions*: commands run in a child process, files are analysed in a sandbox, and long material is filed into a local knowledge base — while the conversation receives only conclusions, excerpts and counts. A routing gate refuses, before execution, the calls that would inevitably flood the transcript.

**No third-party runtime dependencies.** The knowledge base rides on Node's own `node:sqlite` (FTS5 included) and code execution uses interpreters already on the machine, so installing it pulls nothing else.

## What it is for

| Problem | What this does |
|---|---|
| A command prints thousands of lines; you only need a count | `ctk_execute` runs it in a child process and returns the answer |
| A large file needs statistics, not a full read | `ctk_execute_file` keeps its bytes in the sandbox |
| Many commands, one question | `ctk_batch_execute` answers in one call with per-command status |
| A page or spec is read once and never reused | `ctk_index` files it; `ctk_search` pulls excerpts on demand |
| `curl` / `wget` paste whole responses into the conversation | The routing gate refuses them and names the alternative |
| You cannot tell how much was saved | `ctk_stats` reports the ledger; the settings page shows a live occupancy panel |

## Tools

| Tool | Purpose |
|---|---|
| `ctk_execute` | Run code in a sandboxed child process (javascript / esm / typescript / shell), return only the answer |
| `ctk_execute_file` | Run code over a file for statistics or extraction; the file text stays in the sandbox |
| `ctk_batch_execute` | Several commands in one call, per-command status, conclusions only |
| `ctk_index` | File text or a file into the local FTS5 knowledge base |
| `ctk_search` | Multi-query retrieval; excerpts are centred on the match |
| `ctk_retrieve` | Read back a slimmed output's stored original, byte-for-byte, from its `[ctk_retrieve id=…]` marker |
| `ctk_fetch_and_index` | Fetch pages → strip markup → file them |
| `ctk_purge` | Delete filed material (requires `confirm: true`) |
| `ctk_stats` | Savings ledger: refusals, sandbox bytes, filed bytes, call counts |
| `ctk_doctor` | Self-check: interpreters really start, scratch dir writable, knowledge round-trip |
| `ctk_context_report` | This conversation's context occupancy and composition |

## Install

From npm (recommended):

```bash
dsh plugin --profile desktop add dsh-context-toolkit
```

From GitHub:

```bash
dsh plugin --profile desktop add github:chimneyQ/dsh-context-toolkit
```

From a local checkout:

```bash
dsh plugin --profile desktop add D:\path\to\dsh-context-toolkit
```

Confirm `dsh-context-toolkit` appears in `dsh.profile.bundles` inside `<DSH_HOME>/profiles/desktop/package.json`.

Remove:

```bash
dsh plugin --profile desktop remove dsh-context-toolkit
```

## Use it well

**Reach for `ctk_*` first** whenever the work is analysis, counting, filtering or summarising — reading that output into the conversation is the exact problem this bundle exists to solve.

```js
// How many .log files, and how big in total?
await ctk_execute({
  language: 'javascript',
  code: `
    const fs = require('fs');
    const dir = process.argv[2];
    let n = 0, bytes = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.log')) continue;
      n++; bytes += fs.statSync(dir + '/' + f).size;
    }
    console.log(n + ' files, ' + bytes + ' bytes');
  `
});
```

File long material once, then pull sections:

```js
await ctk_index({ path: 'D:/specs/api.md' });          // the full text stays in the store
await ctk_search({ queries: ['rate limit', 'auth'] });  // only the relevant excerpts come back
```

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `routing` | `true` | Master switch for the routing gate |
| `denyCurlWget` | `true` | Block curl / wget outright |
| `bashNudgeMinCommandBytes` | `4096` | Nudge threshold for long commands (0 disables) |
| `maxReadBytesBeforeAsk` | `51200` | Nudge threshold for whole-file reads (0 disables) |
| `nudgeFetchTools` | `true` | Nudge the host fetchers (`web_fetch` / `read_page`) too |
| `trustedReadBasenames` | `package.json` etc. | Filenames exempt from the read nudge |
| `compressNudgeTokens` | `120000` | Occupancy warning threshold (tokens) |
| `searchLimit` | `5` | Excerpts per query in `ctk_search` |
| `snippetChars` | `900` | Character ceiling per excerpt |
| `fetchMaxBytes` | `2000000` | Per-page fetch ceiling |
| `storageDir` | empty | Knowledge-base root; empty = `<DSH_HOME>/context-toolkit` |
| `tools.*` | see below | Per-tool switches |

Tool switches: `tools.execute`, `tools.executeFile`, `tools.batchExecute`, `tools.index`, `tools.search`, `tools.fetchAndIndex`, `tools.purge`, `tools.stats`, `tools.contextReport`, `tools.doctor` — all on by default.

## Verify

The offline suites need no DSH runtime:

```bash
node smoke.mjs        # 85 checks: contract, runtime discovery, tools, gate (segment matching, host-aligned path base, script_path and host-fetcher coverage), output slimming with reversible retrieval and retention, resource disposal, knowledge base, observability, version reporting
node test-client.mjs  # 27 checks: browser-half contract and bilingual dictionary parity
node test-package.mjs # 20 checks: publish manifest and the zero-dependency constraint
node release-check.mjs # 30 checks: release readiness (manifest, deps, tool count, gate matching, version, SHA coverage, no hardcoded paths)
```

## Output slimming (after a tool runs)

The gate works at the *door*; slimming handles what is **already inside**. They catch different traffic: the gate can only read a call's *arguments*, while slimming sees the *bytes that actually came back* — from a tool the gate does not know, an entry point it does not cover, or output that was never predictable from the call.

At `tools/post-execute`, the strategy follows the shape:

| Shape | Treatment |
|---|---|
| Uniform JSON array | **Lossless** tabular re-encoding: keys written once, no information dropped |
| Table | Header plus both ends kept; the middle stride-sampled **with original line numbers** (the model gets a map with coordinates) |
| grep / search | Folded by file, first hits per file kept |
| Log | Ordinary lines folded away, **diagnostics kept verbatim** |
| Long prose | Head/tail window with an explicit elision marker |
| Code / key-value | **Not compressed** (the model may be about to edit exact bytes) |

**Two gates**: a candidate must be at most 72% of the original bytes *and* have a strictly lower token estimate, or it is dropped — no saving means no claim, and the ledger never overstates.

**Reversibility is the red line**: every lossy path stores the exact original first and injects a `[ctk_retrieve id=…]` marker, read back with `ctk_retrieve`. The originals live in the **same database as the FTS5 index** — one file, two jobs: FTS5 finds sections, blobs restore them.
- **Retention**: `slimOriginalTtlMinutes` (default 1440 = one day, 0 = forever) is swept once on every load; when a marker cannot be delivered the blob is rolled back by id, so an unrelated original is never taken with it.

## Known limits

- **Outbound fetching depends on this machine's network.** If host names resolve to a loopback address, `ctk_fetch_and_index` fails with that reason spelled out — not a bare "fetch failed" — and `ctk_index` is the way to file local material instead.
- **`ctk_execute` timeouts are hard kills**: the child is terminated and `timedOut` is reported.
- **A single run captures at most 256 KB**; anything beyond is counted but not retained. The text handed back is additionally capped at 4000 characters, so even a 1 MB single-line output cannot enter the conversation whole.
- **The knowledge base deduplicates by path**: filing the same path again replaces the earlier copy.
- **The gate is precise, not exhaustive.** A flood tool is refused only when it is the command word of some segment — after exec prefixes (`sudo`, `exec`, …) and path/extension normalisation are stripped — and `script_path` is read up to the first 256 KB. A tool a program invokes internally (`python -c 'import wget'`) is outside its remit.
- **Paths resolve the way the host resolves them.** For `script_path` and for `read`'s `file_path`, a relative path is resolved against the session working directory — the same base the host uses to open the file. A gate reading that string against its own cwd would miss anything the host can still run.

## License

MIT
