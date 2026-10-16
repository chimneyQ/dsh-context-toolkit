# dsh-context-toolkit

> [简体中文](./README.zh.md) | **English**

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
| `ctk_fetch_and_index` | Fetch pages → strip markup → file them |
| `ctk_purge` | Delete filed material (requires `confirm: true`) |
| `ctk_stats` | Savings ledger: refusals, sandbox bytes, filed bytes, call counts |
| `ctk_doctor` | Self-check: interpreters really start, scratch dir writable, knowledge round-trip |
| `ctk_context_report` | This conversation's context occupancy and composition |

## Install

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
node smoke.mjs        # 52 checks: contract, runtime discovery, tools, gate, knowledge base, observability
node test-client.mjs  # 27 checks: browser-half contract and bilingual dictionary parity
node test-package.mjs # 18 checks: publish manifest and the zero-dependency constraint
```

## Known limits

- **Outbound fetching depends on this machine's network.** If host names resolve to a loopback address, `ctk_fetch_and_index` fails with that reason spelled out — not a bare "fetch failed" — and `ctk_index` is the way to file local material instead.
- **`ctk_execute` timeouts are hard kills**: the child is terminated and `timedOut` is reported.
- **A single run captures at most 256 KB**; anything beyond is counted but not retained. The text handed back is additionally capped at 4000 characters, so even a 1 MB single-line output cannot enter the conversation whole.
- **The knowledge base deduplicates by path**: filing the same path again replaces the earlier copy.

## License

MIT
