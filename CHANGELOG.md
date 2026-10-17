# Changelog (dsh-context-toolkit)

> [简体中文](./CHANGELOG.zh.md) | **English**

User-visible changes, newest first. Commit hashes in brackets.

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
