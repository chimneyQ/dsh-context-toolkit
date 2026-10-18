// dsh-context-toolkit — browser half: the settings page and the occupancy panel.
//
// The harness module loader expects exactly one __ModuleLoader__.load() with an id
// and a factory. The server half renders nothing; every field staged here must
// exist in the plugin's Config, and the panel reads the plugin's own HTTP route so
// it keeps working while the host has not served the settings namespace.
window.__ModuleLoader__.load({
  id: "dsh-context-toolkit",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let React = require("react");
    let jsxRuntime = require("react/jsx-runtime");
    let P = require("@deepseek-ai/dsh-client-ui-primitives");
    let jsx = jsxRuntime.jsx;
    let jsxs = jsxRuntime.jsxs;

    //#region locales
    const zh = {"title":"上下文工具箱","description":"在沙箱里跑代码、把大块材料归档成可检索的本地知识库、并挡住会灌满对话的抓取与整读。附一张实时上下文占用面板。","hint":"下列开关即时生效，无需重启：门禁在每次工具调用前读取。","routing":"路由门禁","routingHint":"总开关。开启后，每次工具调用执行前都会经过门禁检查。","denyCurlWget":"硬拦 curl / wget","denyCurlWgetHint":"这两个工具的设计就是把整页内容塞进对话；拦掉，改用 ctk_fetch_and_index。","bashNudgeMinCommandBytes":"长命令引导阈值（字节）","bashNudgeMinCommandBytesHint":"命令超过这个长度时提示改用 ctk_batch_execute。填 0 表示不提示。","maxReadBytesBeforeAsk":"大文件整读引导阈值（字节）","maxReadBytesBeforeAskHint":"整读超过这个大小的文件时提示改用 ctk_execute_file。填 0 表示不提示。","nudgeFetchTools":"取网页工具也纳入整页引导","nudgeFetchToolsHint":"把宿主自带的 web_fetch / read_page 也纳入引导：它们与 shell 里的 curl 取回同样一整页，却不在 shell 门禁的视野里。关闭则只拦 shell 一侧。","slimOutputs":"工具输出瘦身","slimOutputsHint":"工具执行后、进入模型历史前压缩：表格保留表头+首尾+带原始行号的中段采样，同构 JSON 走无损重编码，日志折叠掉普通行保住诊断行。有损路径一定把原文逐字节存好，可用 ctk_retrieve 取回。","slimMinBytes":"普通输出瘦身门槛（字节）","slimMinBytesHint":"普通输出小于此值不动。0 表示关闭普通输出瘦身。","slimErrorMinBytes":"错误输出瘦身门槛（字节）","slimErrorMinBytesHint":"留得比普通输出高：调试时要的是保真，不是省字节。","slimOriginalTtlMinutes":"可逆原文保留时长（分钟）","slimOriginalTtlMinutesHint":"瘦身前存的原文保留多久；0 表示一直保留。","trustedReadBasenames":"不受整读门禁限制的文件名","trustedReadBasenamesHint":"逗号分隔；这些文件即使很大也允许整读。","compressNudgeTokens":"占用提示阈值（tokens）","compressNudgeTokensHint":"表面占用达到此值时，占用报告给出压缩建议。填 0 表示不提示。","searchLimit":"检索返回条数上限","searchLimitHint":"ctk_search 每次查询返回的片段数上限。","snippetChars":"片段最大字符数","snippetCharsHint":"ctk_search 每个片段返回的字符上限，超出部分省略。","fetchMaxBytes":"单页抓取上限（字节）","caPemPath":"TLS 信任链（CA 证书）","fetchMaxBytesHint":"ctk_fetch_and_index 抓取单页的最大字节数，超出部分丢弃。","caPemPathHint":"auto = 用 <DSH_HOME>/context-mode/ca/windows-roots.pem（本机导出的系统根证书）；也可填某个 PEM 的绝对路径；留空 = 用 Node 默认信任链。企业代理拦截 HTTPS 导致抓取报证书错误时，配这一项。","storageDir":"知识库根目录","storageDirHint":"留空 = <DSH_HOME>/context-toolkit。","toolsTitle":"工具开关","toolsHint":"逐个启用或停用 ctk_* 工具。","overridden":"已覆盖","reset":"恢复默认","readOnly":"本部署的设置为只读。","unavailable":"该插件当前未加载，暂时无法配置。","save":"保存","saving":"保存中…","saveFailed":"本部署没有接受这些值，已保留供你修改。","invalidNumber":"请填数字；留空表示使用默认值。","note":"门禁开关即时生效；工具开关改动后建议重开页面确认。","ctxTitle":"上下文情况","ctxLoading":"正在读取…","ctxReload":"刷新","ctxFailed":"读取失败：","ctxNoSession":"本会话暂无可测量的投影。","ctxStale":"以下为最近一次实测快照（{time}）：网页请求没有会话边界，实时值请在对话中调用 ctk_context_report。","ctxTotal":"总压力 {n} tokens","ctxSurface":"表面占用 {n} tokens","ctxBudget":"提示阈值 {n} tokens","ctxOver":"已超过提示阈值，建议把大块输出改走 ctk_execute / ctk_index。","ctxUnder":"低于提示阈值，暂不需要干预。","ctxSystem":"系统提示","ctxTools":"工具 schema","ctxMessages":"会话消息","ctxEstimated":"（估算）","ctxNodes":"占用大头（前 {n} 项）","ctxLedger":"本插件节约台账","ctxLedgerLine":"门禁已拦截 {n} 次，约 {bytes} 字节未进入上下文；沙箱保留 {sandbox} 字节；已注册 {tools} 个 ctk_* 工具。","ctxKnowledge":"知识库：{docs} 文档 / {chunks} 片段（{bytes} 字节）","ctxStorage":"知识库位置：{path}","tools.execute":"ctk_execute（在沙箱里跑代码，只把结论带回来）","tools.executeHint":"用于「只想要结论、不想让原始输出占满上下文」的分析型任务。","tools.executeFile":"ctk_execute_file（对某个文件跑代码，只回结论）","tools.executeFileHint":"适合读大文件后做统计或抽取，文件原文留在沙箱里。","tools.batchExecute":"ctk_batch_execute（一次跑多条命令，逐条状态）","tools.batchExecuteHint":"多条命令一次调用，只有结论回来。","tools.index":"ctk_index（把大块材料存进本地知识库）","tools.indexHint":"把长文档、日志、规范归档，之后用 ctk_search 按需取用。","tools.search":"ctk_search（按需检索知识库，取片段而非整份）","tools.searchHint":"知识库里已有的内容优先用它检索，不要整份读进来。","tools.fetchAndIndex":"ctk_fetch_and_index（抓网页并直接并入索引）","tools.fetchAndIndexHint":"抓整页网页又不让它淹没对话时用；curl/wget 会被门禁拦掉。","tools.purge":"ctk_purge（删除已索引内容，不可恢复）","tools.purgeHint":"清理知识库用；会永久删除，调用必须带 confirm:true。","tools.stats":"ctk_stats（节约台账与知识库用量）","tools.statsHint":"想知道这个插件省了多少、归档了多少时看它。","tools.doctor":"ctk_doctor（自检：运行时、临时目录、知识库往返）","tools.doctorHint":"出现异常（子进程跑不起来、索引失败）时先跑它定位。","tools.contextReport":"ctk_context_report（会话上下文占用报告）","tools.contextReportHint":"让模型可以主动查询本会话的上下文占用与构成。","restart":"需重启","caBundleTitle":"本机证书包（从系统证书库导出）","caBundleHint":"auto 指向的 PEM 是否存在。点按钮从系统证书库导出；若抓取仍报握手失败，说明代理根证书没有被装进系统证书库。","caPresent":"已存在 {kb} KB","caMissing":"未找到该文件","caExport":"导出到 auto 路径","caReexport":"重新导出","caExporting":"导出中…","caOverwrite":"确认覆盖","caCancel":"取消","caOverwriteAsk":"该文件已存在。覆盖会用当前系统证书库重写它，原有副本不保留。","caExported":"已导出 {kb} KB / {count} 张证书","caExportFailed":"导出失败：","caChecking":"检测中…"};
    const en = {"title":"Context Toolkit","description":"Run code in a sandbox, file large material into a local searchable knowledge base, and block the fetches and whole-file reads that flood a conversation. Ships a live context-occupancy panel.","hint":"These switches apply immediately, no restart: the gate is read before every tool call.","routing":"Routing gate","routingHint":"Master switch. When on, every tool call passes through the gate before running.","denyCurlWget":"Block curl / wget","denyCurlWgetHint":"Both exist to paste whole responses into the conversation; blocked here, use ctk_fetch_and_index instead.","bashNudgeMinCommandBytes":"Long-command nudge (bytes)","bashNudgeMinCommandBytesHint":"Commands longer than this get a nudge toward ctk_batch_execute. 0 disables it.","maxReadBytesBeforeAsk":"Whole-file read nudge (bytes)","maxReadBytesBeforeAskHint":"Reading a file larger than this gets a nudge toward ctk_execute_file. 0 disables it.","nudgeFetchTools":"Nudge the host fetchers too","nudgeFetchToolsHint":"Also nudge the host own web_fetch / read_page: they pull back the same whole page as a shell curl, and the shell gate never sees them. Off leaves that door unwatched.","slimOutputs":"Slim tool output","slimOutputsHint":"Compress after a tool runs and before its result reaches the model: tables keep a header, both ends and a middle sampled with original line numbers; uniform JSON is re-encoded losslessly; logs drop ordinary lines and keep diagnostics. Any lossy path stores the exact original first, retrievable with ctk_retrieve.","slimMinBytes":"Slimming floor, ordinary output (bytes)","slimMinBytesHint":"Ordinary output below this is left untouched. 0 disables slimming for it.","slimErrorMinBytes":"Slimming floor, error output (bytes)","slimErrorMinBytesHint":"Kept higher than ordinary output: debugging wants fidelity, not economy.","slimOriginalTtlMinutes":"Retention for stored originals (minutes)","slimOriginalTtlMinutesHint":"How long a stored original is kept; 0 keeps it forever.","trustedReadBasenames":"Filenames exempt from the read nudge","trustedReadBasenamesHint":"Comma separated; these may be read whole however large they are.","compressNudgeTokens":"Occupancy warning (tokens)","compressNudgeTokensHint":"At this surface occupancy the report suggests compaction. 0 disables it.","searchLimit":"Search result limit","searchLimitHint":"How many excerpts ctk_search returns per query.","snippetChars":"Excerpt size (chars)","snippetCharsHint":"Character ceiling on each excerpt from ctk_search.","fetchMaxBytes":"Per-page fetch ceiling (bytes)","caPemPath":"TLS trust store (CA bundle)","fetchMaxBytesHint":"ctk_fetch_and_index keeps at most this many bytes of each page.","caPemPathHint":"auto = use <DSH_HOME>/context-mode/ca/windows-roots.pem (this machine's exported system roots); or give an absolute path to a PEM; empty = Node's default roots. Set this when a TLS-inspecting proxy makes fetches fail on certificate errors.","storageDir":"Knowledge-base root","storageDirHint":"Empty = <DSH_HOME>/context-toolkit.","toolsTitle":"Tool switches","toolsHint":"Enable or disable individual ctk_* tools.","overridden":"overridden","reset":"reset","readOnly":"This deployment is read-only.","unavailable":"The plugin is not loaded right now; it cannot be configured.","save":"Save","saving":"Saving…","saveFailed":"This deployment did not accept those values; they are kept for you to edit.","invalidNumber":"Numbers only; blank means the default.","note":"Gate switches apply immediately; reopen the page to confirm tool-switch changes.","ctxTitle":"Context occupancy","ctxLoading":"Reading…","ctxReload":"Refresh","ctxFailed":"Read failed: ","ctxNoSession":"No measurable projection in this session yet.","ctxStale":"Snapshot from the last real measurement ({time}): a page request has no session boundary; ask ctk_context_report in the conversation for a live reading.","ctxTotal":"{n} tokens total","ctxSurface":"{n} tokens on the surface","ctxBudget":"warning at {n} tokens","ctxOver":"Above the warning threshold — route bulk output through ctk_execute / ctk_index.","ctxUnder":"Below the warning threshold; nothing to do.","ctxSystem":"System prompt","ctxTools":"Tool schemas","ctxMessages":"Conversation","ctxEstimated":" (estimated)","ctxNodes":"Biggest contributors (top {n})","ctxLedger":"This plugin's ledger","ctxLedgerLine":"The gate blocked {n} calls, about {bytes} bytes kept out of context; the sandbox kept out {sandbox} bytes; {tools} ctk_* tools registered.","ctxKnowledge":"Knowledge base: {docs} documents / {chunks} chunks ({bytes} bytes)","ctxStorage":"Knowledge base at {path}","tools.execute":"ctk_execute (run code in the sandbox, return only the answer)","tools.executeHint":"For analysis where you want the conclusion, not the raw output.","tools.executeFile":"ctk_execute_file (run code over a file, return only the answer)","tools.executeFileHint":"Read a big file, compute over it, keep its bytes in the sandbox.","tools.batchExecute":"ctk_batch_execute (many commands in one call, per-command status)","tools.batchExecuteHint":"One call for many commands; only conclusions come back.","tools.index":"ctk_index (file large material into the local knowledge base)","tools.indexHint":"Archive long docs, logs or specs, then pull sections with ctk_search.","tools.search":"ctk_search (retrieve excerpts on demand, not the whole thing)","tools.searchHint":"Prefer this for material already in the knowledge base.","tools.fetchAndIndex":"ctk_fetch_and_index (fetch a page straight into the index)","tools.fetchAndIndexHint":"When a whole page would flood the conversation; curl/wget are gated.","tools.purge":"ctk_purge (delete indexed content — permanent)","tools.purgeHint":"Clears the knowledge base; permanent, so the call must confirm:true.","tools.stats":"ctk_stats (this plugin's savings ledger and knowledge usage)","tools.statsHint":"How much this plugin saved, and how much it filed.","tools.doctor":"ctk_doctor (self-check: runtimes, scratch dir, knowledge round-trip)","tools.doctorHint":"Run it first when a child process or indexing misbehaves.","tools.contextReport":"ctk_context_report (session context occupancy report)","tools.contextReportHint":"Lets the model ask for this session context occupancy and composition.","restart":"needs a restart","caBundleTitle":"Local certificate bundle (exported from the system store)","caBundleHint":"Whether the PEM that auto points at exists. The button exports from the system certificate store; if fetching still fails the handshake, the proxy root was never installed into that store.","caPresent":"present, {kb} KB","caMissing":"file not found","caExport":"export to the auto path","caReexport":"re-export","caExporting":"exporting…","caOverwrite":"overwrite","caCancel":"cancel","caOverwriteAsk":"That file already exists. Overwriting rewrites it from the current system store; the old copy is not kept.","caExported":"exported {kb} KB, {count} certificates","caExportFailed":"export failed: ","caChecking":"checking…"};
    //#endregion

    /** Fill the {name} holes in a translated sentence. */
    function fill(text, values) {
      return String(text).replace(/\{(\w+)\}/g, (whole, name) => {
        const v = values[name];
        return v === undefined ? whole : String(v);
      });
    }

    //#region fields
    const FIELDS = [{"field":"routing","kind":"bool"},{"field":"denyCurlWget","kind":"bool"},{"field":"bashNudgeMinCommandBytes","kind":"number"},{"field":"maxReadBytesBeforeAsk","kind":"number"},{"field":"nudgeFetchTools","kind":"bool"},{"field":"compressNudgeTokens","kind":"number"},{"field":"searchLimit","kind":"number"},{"field":"snippetChars","kind":"number"},{"field":"fetchMaxBytes","kind":"number"},{"field":"caPemPath","kind":"text"},{"field":"slimOutputs","kind":"bool"},{"field":"slimMinBytes","kind":"number"},{"field":"slimErrorMinBytes","kind":"number"},{"field":"slimOriginalTtlMinutes","kind":"number"},{"field":"trustedReadBasenames","kind":"text"},{"field":"storageDir","kind":"text"}];
    const TOOL_FIELDS = ["execute","executeFile","batchExecute","index","search","retrieve","fetchAndIndex","purge","stats","contextReport","doctor"];
    const STATUS_PATH = "/_dsh/context-toolkit/status";
    const EXPORT_CA_PATH = "/_dsh/context-toolkit/export-ca";
    //#endregion

    //#region styles
    const rowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 0" };
    const labelStyle = { display: "flex", flexDirection: "column", gap: "2px" };
    const nameStyle = { fontSize: "13px" };
    const hintStyle = { fontSize: "12px", opacity: 0.7, maxWidth: "46em" };
    const controlsStyle = { display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto" };
    const resetStyle = { background: "transparent", border: "none", color: "inherit", opacity: 0.75, cursor: "pointer", fontSize: "12px", textDecoration: "underline", padding: 0 };
    const sectionStyle = { marginTop: "18px", borderTop: "1px solid rgba(128,128,128,0.25)", paddingTop: "14px" };
    const sectionTitleStyle = { fontSize: "13px", fontWeight: 600 };
    const sectionHintStyle = { fontSize: "12px", opacity: 0.7, margin: "4px 0 8px", maxWidth: "46em" };
    const panelStyle = { marginTop: "18px", border: "1px solid rgba(128,128,128,0.25)", borderRadius: "6px", padding: "12px 14px" };
    const panelHeadStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "6px" };
    const statRowStyle = { display: "flex", alignItems: "center", gap: "10px", padding: "4px 0", fontSize: "12px" };
    const statNameStyle = { flex: "0 0 9em" };
    const barWrapStyle = { flex: "1 1 auto", height: "10px", background: "rgba(128,128,128,0.18)", borderRadius: "5px", overflow: "hidden", display: "flex" };
    const statValueStyle = { flex: "0 0 8em", textAlign: "right", fontFamily: "monospace", fontSize: "11px", opacity: 0.85 };
    const monoStyle = { fontFamily: "monospace", fontSize: "11px", opacity: 0.8 };
    const smallButtonStyle = { background: "transparent", border: "1px solid rgba(128,128,128,0.4)", borderRadius: "4px", color: "inherit", cursor: "pointer", fontSize: "11px", padding: "2px 8px" };
    const OVER_COLOR = "#bf8700";
    const OK_COLOR = "#2ea043";
    const BAR_COLOR = { system: "#8250df", tools: "#0969da", messages: "#2ea043" };
    //#endregion

    //#region BoolField
    function BoolField(props) {
      const t = props.t;
      const fieldState = props.state[props.spec.field] === undefined ? {} : props.state[props.spec.field];
      return jsxs("div", {
        style: rowStyle,
        children: [
          jsxs("div", { key: "label", style: labelStyle, children: [
            jsx("div", { key: "name", style: nameStyle, children: t(props.spec.field) }),
            jsx("div", { key: "hint", style: hintStyle, children: t(props.spec.field + "Hint") })
          ]}),
          jsxs("div", { key: "controls", style: controlsStyle, children: [
            fieldState.overridden === true
              ? jsx("button", { key: "reset", type: "button", style: resetStyle, disabled: !props.state.writable, onClick: () => props.onReset(), children: t("reset") })
              : null,
            jsx(P.Switch, {
              key: "switch",
              checked: fieldState.text === "true",
              disabled: !props.state.writable,
              label: t(props.spec.field),
              onChange: (next) => props.onEdit(next ? "true" : "false")
            })
          ]})
        ]
      });
    }
    //#endregion

    //#region panel
    /**
     * A live read of this session's context occupancy.
     *
     * It reloads on mount and on demand — a settings page has no business polling
     * forever. When the route can only offer a snapshot it says so, with the time,
     * so an old number is never mistaken for a live one.
     */
    function ContextPanel(props) {
      const t = props.t;
      const [state, setState] = React.useState({ status: "loading", data: null, error: "" });
      const load = React.useCallback(() => {
        setState({ status: "loading", data: null, error: "" });
        Promise.resolve()
          .then(() => fetch(STATUS_PATH, { headers: { accept: "application/json" } }))
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
          .then((data) => setState({ status: "ready", data: data, error: "" }))
          .catch((error) => setState({ status: "failed", data: null, error: String((error && error.message) || error) }));
      }, []);
      React.useEffect(() => { load(); }, [load]);

      const children = [];
      children.push(jsxs("div", { key: "head", style: panelHeadStyle, children: [
        jsx("div", { key: "title", style: sectionTitleStyle, children: t("ctxTitle") }),
        jsx("button", { key: "reload", type: "button", style: smallButtonStyle, onClick: load, children: t("ctxReload") })
      ]}));

      if (state.status === "loading") {
        children.push(jsx("div", { key: "loading", style: hintStyle, children: t("ctxLoading") }));
        return jsx("div", { "data-context-panel": true, style: panelStyle, children: children });
      }
      if (state.status === "failed") {
        children.push(jsx("div", { key: "failed", style: hintStyle, children: t("ctxFailed") + state.error }));
        return jsx("div", { "data-context-panel": true, style: panelStyle, children: children });
      }

      const data = state.data || {};
      const context = data.context || {};
      const ledger = data.ledger || {};

      if (context.ok !== true) {
        children.push(jsx("div", { key: "none", style: hintStyle, children: context.why ? t("ctxFailed") + context.why : t("ctxNoSession") }));
      } else {
        if (context.stale === true) {
          children.push(jsx("div", { key: "stale", style: Object.assign({}, hintStyle, { color: OVER_COLOR }), children: fill(t("ctxStale"), { time: new Date(Number(context.at) || Date.now()).toLocaleTimeString() }) }));
        }
        const total = Number(context.totalTokens) || 0;
        const surface = Number(context.surfaceTokens) || 0;
        const budget = Number(context.budget) || 0;
        children.push(jsx("div", { key: "totals", style: monoStyle, children: fill(t("ctxTotal"), { n: total }) + "  ·  " + fill(t("ctxSurface"), { n: surface }) + "  ·  " + fill(t("ctxBudget"), { n: budget }) }));
        const over = context.overBudget === true;
        children.push(jsx("div", { key: "verdict", style: Object.assign({}, hintStyle, { color: over ? OVER_COLOR : OK_COLOR }), children: over ? t("ctxOver") : t("ctxUnder") }));
        const bd = context.breakdown;
        if (bd && bd.total > 0) {
          const rows = [
            { key: "system", tokens: bd.system, label: t("ctxSystem") },
            { key: "tools", tokens: bd.tools, label: t("ctxTools") },
            { key: "messages", tokens: bd.messages, label: t("ctxMessages") }
          ];
          for (const row of rows) {
            const pct = Math.round((row.tokens / bd.total) * 100);
            children.push(jsxs("div", { key: "bd-" + row.key, style: statRowStyle, children: [
              jsx("span", { key: "n", style: statNameStyle, children: row.label + (bd.estimated ? t("ctxEstimated") : "") }),
              jsx("span", { key: "bar", style: barWrapStyle, children: jsx("span", { style: { width: pct + "%", background: BAR_COLOR[row.key] || "#8b949e", display: "block" } }) }),
              jsx("span", { key: "v", style: statValueStyle, children: row.tokens + " (" + pct + "%)" })
            ]}));
          }
        }
        if (Array.isArray(context.nodes) && context.nodes.length > 0) {
          const shown = context.nodes.slice(0, 10);
          children.push(jsx("div", { key: "nodes-title", style: Object.assign({}, hintStyle, { marginTop: "10px" }), children: fill(t("ctxNodes"), { n: shown.length }) }));
          children.push(jsx("div", { key: "nodes", children: shown.map((node, index) => jsxs("div", { key: "node-" + index, style: statRowStyle, children: [
            jsx("span", { key: "n", style: statNameStyle, children: "seq " + node.seq + (node.system ? " [system]" : "") }),
            jsx("span", { key: "v", style: statValueStyle, children: node.tokens + " tokens" })
          ]})) }));
        }
      }

      children.push(jsx("div", { key: "ledger-title", style: Object.assign({}, hintStyle, { marginTop: "12px" }), children: t("ctxLedger") }));
      children.push(jsx("div", { key: "ledger", style: hintStyle, children: fill(t("ctxLedgerLine"), { n: Number(ledger.denied) || 0, bytes: Number(ledger.deniedBytes) || 0, sandbox: Number(ledger.bytesSandboxed) || 0, tools: Number(ledger.registered) || 0 }) }));
      if (data.knowledge && typeof data.knowledge.documents === "number") {
        children.push(jsx("div", { key: "kb", style: monoStyle, children: fill(t("ctxKnowledge"), { docs: data.knowledge.documents, chunks: data.knowledge.chunks, bytes: data.knowledge.bytes }) }));
      }
      if (typeof data.storage === "string" && data.storage !== "") {
        children.push(jsx("div", { key: "storage", style: monoStyle, children: fill(t("ctxStorage"), { path: data.storage }) }));
      }
      return jsx("div", { "data-context-panel": true, style: panelStyle, children: children });
    }
    //#endregion

    //#region CaBundleField
    /**
     * The CA bundle row, rendered directly under caPemPath.
     *
     * Host SettingsValueField owns caPemPath itself, so this is a sibling row, not
     * something that can live inside it. Loading only reports whether the file
     * exists — snapshotting the root store is a click, never a page open.
     *
     * An existing bundle is never replaced on one click: the first press asks, and
     * only the explicit confirmation sends force.
     */
    function CaBundleField(props) {
      const t = props.t;
      const useState = React.useState;
      const useEffect = React.useEffect;
      // This row cannot read the settings form's snapshot: that model only carries
      // Config fields, never the status payload. It fetches /status itself, which
      // is also what makes the badge correct on first paint.
      const [bundle, setBundle] = useState(null);
      const [busy, setBusy] = useState(false);
      const [result, setResult] = useState(null);
      const [confirming, setConfirming] = useState(false);

      const load = () => {
        Promise.resolve()
          .then(() => fetch(STATUS_PATH, { headers: { accept: "application/json" } }))
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
          .then((data) => setBundle((data && data.caBundle) || { present: false, reason: "no caBundle in /status" }))
          .catch((error) => setBundle({ present: false, reason: String((error && error.message) || error) }));
      };
      useEffect(() => { load(); }, []);

      const info = bundle === null ? null : bundle;
      const present = info !== null && info.present === true;
      const kb = (n) => String(Math.round((Number(n) || 0) / 102.4) / 10);

      const run = async (force) => {
        if (busy) return;
        setBusy(true);
        setResult(null);
        try {
          const response = await fetch(EXPORT_CA_PATH, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ force: force === true })
          });
          const data = await response.json().catch(() => null);
          setResult(data || { ok: false, reason: "empty response" });
          if (data && data.ok === true) setConfirming(false);
          // Either way the file may have changed: re-stat through the route.
          load();
        } catch (error) {
          setResult({ ok: false, reason: "request failed", message: String((error && error.message) || error) });
        }
        setBusy(false);
      };

      const badge = info === null
        ? t("caChecking")
        : (present ? t("caPresent").replace("{kb}", kb(info.bytes)) : t("caMissing"));
      const controls = [
        jsx("span", { key: "state", style: Object.assign({}, hintStyle, {
          opacity: 1, color: info === null ? "inherit" : (present ? "inherit" : "#c46a00")
        }), children: badge })
      ];
      if (confirming) {
        controls.push(jsx("button", { key: "confirm", type: "button", style: smallButtonStyle, disabled: busy,
          onClick: () => run(true), children: busy ? t("caExporting") : t("caOverwrite") }));
        controls.push(jsx("button", { key: "cancel", type: "button", style: smallButtonStyle, disabled: busy,
          onClick: () => setConfirming(false), children: t("caCancel") }));
      } else {
        controls.push(jsx("button", { key: "export", type: "button", style: smallButtonStyle, disabled: busy || info === null || !props.writable,
          // A bundle already on disk is only replaced after an explicit confirmation.
          onClick: () => { if (present) setConfirming(true); else run(false); },
          children: busy ? t("caExporting") : (present ? t("caReexport") : t("caExport")) }));
      }
      const children = [
        jsxs("div", { key: "label", style: labelStyle, children: [
          jsx("div", { key: "name", style: nameStyle, children: t("caBundleTitle") }),
          jsx("div", { key: "hint", style: hintStyle, children: t("caBundleHint") })
        ]}),
        jsx("div", { key: "controls", style: controlsStyle, children: controls })
      ];
      if (confirming) {
        children.push(jsx("div", { key: "ask", style: Object.assign({}, hintStyle, {
          opacity: 1, marginTop: "6px", color: "#c46a00"
        }), children: t("caOverwriteAsk") }));
      }
      if (result) {
        const ok = result.ok === true;
        const text = ok
          ? t("caExported").replace("{kb}", kb(result.bytes)).replace("{count}", String(result.count || 0))
          : t("caExportFailed") + (result.reason || "") + (result.message ? ": " + result.message : "");
        children.push(jsx("div", { key: "result", style: Object.assign({}, hintStyle, {
          opacity: 1, marginTop: "6px", color: ok ? "inherit" : "#c0392b"
        }), children: text }));
      }
      return jsx("div", { style: Object.assign({}, rowStyle, { alignItems: "flex-start" }), children: children });
    }

    //#endregion

    //#region card
    function ToolkitCard(props) {
      const t = props.t;
      if (props.view === "summary") return t("description");
      const state = props.useToolkitCard((snapshot) => snapshot);
      const children = [];
      children.push(jsx("p", { key: "hint", style: Object.assign({}, hintStyle, { margin: "0 0 6px" }), children: t("hint") }));

      for (const spec of FIELDS) {
        const fieldState = state[spec.field] === undefined ? {} : state[spec.field];
        if (spec.kind === "bool") {
          children.push(jsx(BoolField, { key: spec.field, t: t, state: state, spec: spec,
            onEdit: (text) => props.edit(spec.field, text), onReset: () => props.resetField(spec.field) }));
          continue;
        }
        children.push(jsx(P.SettingsValueField, {
          key: spec.field,
          id: "plugin-config-context-toolkit-" + spec.field,
          label: t(spec.field),
          hint: t(spec.field + "Hint"),
          overriddenLabel: t("overridden"),
          resetLabel: t("reset"),
          invalidLabel: t("invalidNumber"),
          numeric: spec.kind === "number",
          disabled: !state.writable,
          text: fieldState.text,
          overridden: fieldState.overridden,
          invalid: fieldState.invalid,
          onEdit: (text) => props.edit(spec.field, text),
          onReset: () => props.resetField(spec.field)
        }));
        if (spec.field === "caPemPath") {
          children.push(jsx(CaBundleField, {
            key: "ca-bundle",
            t: t,
            writable: state.writable,
            onRefresh: props.refreshStatus
          }));
        }
      }

      children.push(jsxs("div", { key: "tools-head", style: sectionStyle, children: [
        jsx("div", { key: "t", style: sectionTitleStyle, children: t("toolsTitle") }),
        jsx("div", { key: "h", style: sectionHintStyle, children: t("toolsHint") })
      ]}));
      for (const name of TOOL_FIELDS) {
        const field = "tools." + name;
        children.push(jsx(BoolField, { key: field, t: t, state: state, spec: { field: field },
          onEdit: (text) => props.edit(field, text), onReset: () => props.resetField(field) }));
      }

      // Rendered BESIDE the form, not inside it: the host's SettingsForm returns
      // early — dropping every child — while the namespace is unserved, and the
      // panel must survive exactly that state to be worth having.
      const panel = jsx(ContextPanel, { key: "panel", t: t });
      const note = jsx("p", { key: "note", style: Object.assign({}, hintStyle, { marginTop: "12px" }), children: t("note") });

      return jsxs("div", { key: "context-toolkit-page", children: [
        jsx(P.SettingsForm, {
          key: "form",
          labels: { unavailable: t("unavailable"), readOnly: t("readOnly"), saveFailed: t("saveFailed"), save: t("save"), saving: t("saving") },
          state: state,
          onSave: props.save,
          onDiscard: props.discard,
          children: children
        }),
        panel,
        note
      ]});
    }
    //#endregion

    //#region controller
    /** Dictionary namespace owned by this plugin. */
    const NS = "settings.contextToolkit";
    /** The plugin's own settings namespace (its bundle id). */
    const CTX_MODE_NS = "dsh-context-toolkit";
    const ToolkitCardController = class {
      constructor(scope) {
        const specs = [];
        for (const spec of FIELDS) {
          if (spec.kind === "number") specs.push(P.settingsNumberField(spec.field));
          else if (spec.kind === "bool") specs.push({ field: spec.field, format: formatBoolean, parse: parseBoolean });
          else specs.push({ field: spec.field, format: formatText, parse: parseText });
        }
        for (const name of TOOL_FIELDS) specs.push({ field: "tools." + name, format: formatBoolean, parse: parseBoolean });
        this.form = new P.SettingsFormModel(scope, specs);
        this.store = this.form.bind(() => this.projection());
      }
      projection() {
        const snapshot = Object.assign({}, this.form.shell());
        for (const spec of FIELDS) snapshot[spec.field] = this.form.field(spec.field);
        for (const name of TOOL_FIELDS) snapshot["tools." + name] = this.form.field("tools." + name);
        return snapshot;
      }
      inject() {
        return Object.assign({ hooks: { toolkitCard: this.store } }, this.form.actions());
      }
      dispose() { this.form.dispose(); }
    };

    function formatBoolean(value) {
      if (value === true) return "true";
      if (value === false) return "false";
      return "";
    }
    function parseBoolean(text) {
      const trimmed = String(text).trim().toLowerCase();
      if (trimmed === "") return { kind: "clear" };
      if (trimmed === "true") return { kind: "set", value: true };
      if (trimmed === "false") return { kind: "set", value: false };
      return { kind: "invalid", message: "expected true or false" };
    }
    function formatText(value) {
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value.join(", ");
      return "";
    }
    function parseText(text) {
      const trimmed = String(text).trim();
      if (trimmed === "") return { kind: "clear" };
      return { kind: "set", value: trimmed };
    }
    //#endregion

    //#region mount
    /**
     * Mount the settings page.
     *
     * Two host containers publish a slot this form can occupy:
     *   - settings.section is the Settings shell navigation list;
     *   - plugins.item is the Plugins panel card list, which renders the same
     *     component as its card body.
     *
     * Registration is unconditional: gating it on the host having served our own
     * namespace fails silently (no error, zero cells) and hides the entry, and the
     * card already renders its own unavailable state when no form is served.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), "context-toolkit: dictionaries");
      const card = new ToolkitCardController(ctx.configForms.get(CTX_MODE_NS));
      ctx.effect(() => () => { card.dispose(); }, "context-toolkit: form subscription");
      const definition = (name, order) => ({
        name: name,
        id: "context-toolkit",
        order: order,
        label: () => t("title"),
        locale: NS,
        inject: () => card.inject()
      });
      ctx.slots.inject("settings.section", () => ctx.slots.register(definition("settings.section", 30), ToolkitCard));
      ctx.slots.inject("plugins.item", () => ctx.slots.register(definition("plugins.item", 55), ToolkitCard));
    }
    /** Required services (cordis fiber inject). */
    const inject = ["slots", "locale", "configForms"];
    //#endregion

    exports.NS = NS;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
