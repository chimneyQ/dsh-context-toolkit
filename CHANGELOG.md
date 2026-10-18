# Changelog (dsh-context-toolkit)

> [简体中文](./CHANGELOG.zh.md) | **English**

User-visible changes, newest first. Commit hashes in brackets.

## 0.3.11
- **Fixed: "exists" and "not found" could disagree about the same path.** Presence was judged two ways — `describeCaBundle` demanded a regular file, while the export refused to overwrite on a plain `existsSync`, which is also true for a directory. A path occupied by a directory therefore reported "file not found" in the UI while the export refused with `reason: exists`: two contradictory answers, and no way out through the UI. Both sides now go through one definition of "a usable bundle is there".
- **The write also reports the real reason now.** When the path cannot be replaced, the result says `EISDIR` / `ENOTDIR` instead of pretending the bundle already exists.
- **WAL is bounded.** `PRAGMA wal_autocheckpoint = 400` keeps `knowledge.db-wal` near 1.6 MB instead of letting the default 1000-page threshold leave a multi-megabyte side file behind.
- Offline assertions 100, client 27, packaging 20, release gate 34.

## 0.3.10
- **Fixed: the CA row showed "file not found" even when the bundle was there, and the button appeared to do nothing.** The row read its bundle from the settings-form snapshot (`props.useToolkitCard`), but that model only carries Config fields — it never contains the status payload, so `bundle` was always `{}` and `present` was always false. The server side was correct all along: `/status` returned `present: true` while the badge said otherwise, and the click sent no request at all because the row believed there was nothing to replace.
- **The row now fetches `/status` itself** on mount and again after every export attempt, so the badge reflects the real file. A `checking…` state covers the first paint instead of flashing "missing".
- New assertion: the row must call `fetch(STATUS_PATH` and must not read `state.data…caBundle`, so it cannot drift back onto the form snapshot.
- Offline assertions 100 (up from 99), client 27, packaging 20, release gate 34.

## 0.3.9
- **New: the CA bundle can be exported from the settings page.** `caPemPath: auto` has always pointed at `<DSH_HOME>/context-mode/ca/windows-roots.pem`, a file the package has never shipped — so on a fresh machine it simply is not there, and a machine behind a TLS-inspecting proxy stays unable to fetch. The row under `caPemPath` now reports whether that file exists and offers a button that writes it from the host's own root store (`tls.getCACertificates('system')`).
- **Loading only stats the file.** Presence is answered by a `statSync`; taking the snapshot (~500 certificates, ~820 KB, tens of milliseconds) happens only when the button is pressed.
- **An existing bundle is never replaced on one click.** The first press asks; only the explicit confirmation sends `force`, so a file the user built by hand cannot be destroyed by a stray click.
- **What the button does not do:** it exports the *system* store. If the proxy root was never installed into that store, the exported bundle is still not enough — the row says so rather than promising a fix.
- Offline assertions 99 (up from 94), client 27, packaging 20, release gate 34.

## 0.3.7
- **Fixed: a page larger than `fetchMaxBytes` hung `ctk_fetch_and_index` forever.** The CA path reads the body by hand, and on reaching the cap it called `response.destroy()` without settling the promise - no `resolve`, no `reject`. The tool then sat there until its own 180 s timeout. Only the CA branch could hit this: the no-CA branch still uses the built-in `fetch`, which caps nothing and never read this code.
- **Fix.** Every exit now goes through one `finish()`: the cap reached, the body ended, or a read error. Reaching the cap stops the stream and hands back the bytes that fit, so a truncated body is a normal result rather than a hang.
- **Why it was missed.** `httpsGetWithCa` was not exported and no assertion touched it - the four existing `caPemPath` assertions all covered `resolveCaBundle`, which never reads a body. The suite now starts a real local HTTPS server, completes a handshake against a throwaway CA, and reads a 3 MB body through a 64 KB cap: it fails on the old code by exceeding a 5 s deadline, and passes now. A second assertion pins the ordinary small-body path so the cap work cannot break it.
- Offline assertions 94 (up from 92), client 27, packaging 20, release gate 34.

## 0.3.6
- **Fixed: `caPemPath` was a setting that did nothing.** The key has been in this plugin's own `cordis.patch.yml` since the first commit, annotated "validated against the plugin's Config schema" - but it was never in the schema, never read anywhere in `index.js`, and never mentioned in either README. zod's loose mode let it through silently, so it looked configurable while having no effect whatsoever. It is now real: announced, read, and honoured.
- **Why it matters here.** `ctk_fetch_and_index` could not fetch a single public page on this machine: every https request failed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` because Node's built-in roots do not include the local TLS-inspection certificate. The plugin even had a branch that *described* that failure ("a local interception certificate is the usual cause") without offering any way to fix it.
- **How it works.** `caPemPath` names the trust store: `auto` = `<DSH_HOME>/context-mode/ca/windows-roots.pem` (this machine's exported Windows roots), an absolute path = that PEM, empty = Node's default roots. When a bundle is configured, fetching goes through `node:https` with `ca` set (the built-in `fetch` cannot take a per-call CA - its `dispatcher` is undici's, and undici is not importable from a plugin here), follows redirects by hand, and reports which trust store it used. A configured path that cannot be read is reported in the output rather than silently falling back, because falling back would recreate the exact failure the setting exists to fix.
- **Verified end to end.** With the default trust store: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. With the bundle injected: HTTPS 200, including a two-hop redirect. `resolveCaBundle` has four assertions covering default / real file / unreadable path / file without a certificate; reverting the implementation fails "resolves a real PEM file" immediately.
- 92 offline assertions (4 new), 27 client, 20 package, 34 release gate.

## 0.3.5
- **Fixed: four gate bypasses.** The gate asks whether the *command word* of a segment is a flood tool, so anything that legally precedes that word has to be peeled first — otherwise it inspects a variable assignment and calls it safe. Previously missed: `FOO=1 curl …`, `PATH=/x curl …` (assignment prefixes were never peeled), `nice -n 5 curl …`, `timeout 30 curl …` (a wrapper's own options were read as the command word), and `sudo FOO=1 curl …` (the prefix loop capped at two tokens). Prefixes are now peeled as assignment → wrapper → wrapper options → assignment, with seven must-block and six must-allow assertions; two negative controls knock out the assignment peel and the option skip respectively. [`a6129be`]

## 0.3.4
- **Fixed**: output that a tool already truncated is no longer compressed a second time. An upstream tool (`ops_bash`) truncates its own output and spills the rest to a file, and the sandbox (`ctk_execute`) caps a run at 256 KB and closes with a `~~~` line; this layer used to compress those already-handled bodies again — saving nothing, storing a second copy of the same original, and counting the same traffic twice. Both markers (`[output truncated; full output: …]` and a standalone `~~~` line) are recognised and skipped, and the reason is reported in a new "skip reasons" ledger line. [`038447b`]

## 0.3.3
- **Docs**: adds this bilingual changelog, listed in the manifest and gated by release-check; the README and repository description were refreshed too. The npm package now carries the changelog with each release. [`01d7107`]

## 0.3.2
- **Fixed**: `slimOriginalTtlMinutes` was displayed in the settings page and never read by the code, so the expiry the panel promised never happened and stored originals accumulated without limit; the sweep now runs once on every load.
- **Fixed**: the rollback call `purgeBlobs({ all: false })` passed no age and was therefore a no-op, leaving the original forever; a rollback now removes exactly the id it wrote and cannot take an unrelated original with it.
- The ledger reports the effective retention, making a consumed setting visible. [`98f6a06`]

## 0.3.1
- **Fixed**: `ctk_retrieve` omitted `isError` on its success path; the host validates a tool's output against its schema and rejects the call when a required property is missing, so read-back was unusable — the marker was injected and the original stored, and it could not be read. [`75ea559`]
- The ledger now renders slimming counts (blocks, bytes, tokens, skipped) and stored originals, and counts slimmed bytes as kept out of context.

## 0.3.0
- **New: output slimming at `tools/post-execute`** — the gate guards the door; this handles what is already inside: uniform JSON re-encoded losslessly, tables keeping header and both ends with the middle sampled by original line number, grep/search folded by file, logs folded with diagnostics kept verbatim, code and key-value left alone.
- **Two never-worse gates**: at most 72% of the bytes and a strictly lower token estimate, or the candidate is dropped.
- **Reversibility is the red line**: every lossy path stores the exact original first and injects a `[ctk_retrieve id=…]` marker, read back with the new `ctk_retrieve`. Originals live in the **same SQLite database as the FTS5 index** (a `blobs` table; BLOB access so nothing re-encodes the bytes). [`61f162d`]

## 0.2.4
- **Fixed**: the `read` branch repeated `script_path`'s path-base mistake — a relative path was resolved against the plugin process's cwd while the host opens it against the session working directory; measured on live code, the same 70 KB file was refused by absolute path and read whole by relative path. [`8607fb2`]
- **New**: the host's own fetchers (`web_fetch`, `read_page`) are nudged too — previously curl in a shell was refused while the same page walked in through them.

## 0.2.3
- **Fixed**: a relative `script_path` was resolved against a different base than the host uses, so the gate read nothing and waved the call through; resolution now uses the session working directory. [`5820210`]

## 0.2.2
- **Fixed**: gate matching moved from a whole-line substring with delimiters to splitting at command separators and comparing each segment's command word — fixing both directions (misses on non-leading invocations and prefixed/pathed ones, false denials where the tool name is just an argument).
- **Fixed**: `ops_bash` runs a file when handed `script_path`, which the gate never saw; the script is now read (first 256 KB).
- **Fixed**: the suite leaked its own handles (the mock discarded the disposer, so the SQLite handle stayed open and Windows could not delete the temp directory). [`da1b0fd`]

## 0.2.1
- **Fixed**: `ctk_doctor` printed a hardcoded `0.1.0` while the bundle shipped 0.2.0; it now reads its own `package.json` at load.
- **New**: `release-check.mjs`, the release-readiness gate. [`d98835a`]

## 0.2.0
- **Fixed**: `guard` returned `null` instead of `undefined` when allowing, and the host denies whenever the reason is not undefined — every tool call was denied (run_code failed with a bare `Error: null`).
- **Fixed**: the gate recognised only the shell names it shipped with, so `curl` through `ops_bash` slipped past; every shell name is covered now.

## 0.1.0
- First release: `ctk_execute` / `ctk_execute_file` / `ctk_batch_execute` (run code in a child process, return only the conclusion), `ctk_index` / `ctk_search` (a local FTS5 knowledge base on `node:sqlite`), the routing gate, `ctk_stats` / `ctk_doctor` and a live occupancy panel. [`87b35fe`]
