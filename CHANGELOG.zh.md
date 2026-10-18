# 更新说明（dsh-context-toolkit）

> **简体中文** | [English](./CHANGELOG.md)

本文件按版本记录用户可感知的变化。方括号内为对应提交。

## 0.3.6
- **修复：`caPemPath` 是个什么都不做的设置。** 这个键从首个提交起就写在本插件自带的 `cordis.patch.yml` 里，注释还写着「每个值都会经 Config schema 校验」——但它从不在 schema 中、`index.js` 里零引用、两版 README 也从未提及。zod 的 loose 模式把它静默放过，于是它看起来可配置，实际毫无作用。现在它是真的了：有声明、有读取、有生效。
- **为什么这件事在本机很重要。** `ctk_fetch_and_index` 抓不到任何一个公网页面：所有 https 请求都因 `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 失败，因为 Node 内置根证书不含本机的 TLS 拦截证书。插件甚至有一条分支专门**描述**这个失败（「A local interception certificate is the usual cause」），却没有提供任何修复途径。
- **怎么做的。** `caPemPath` 指定信任链：`auto` = `<DSH_HOME>/context-mode/ca/windows-roots.pem`（本机导出的 Windows 根证书）；绝对路径 = 该 PEM；留空 = Node 默认根证书。配置了 bundle 时，抓取改走 `node:https` 并带上 `ca`（内置 `fetch` 无法按次指定 CA——它的 `dispatcher` 属于 undici，而这里 import 不到 undici），手工跟随重定向，并如实报出用的是哪份信任链。配置了却读不到的路径会在输出里明说，而不是静默回落——因为静默回落恰好会重现这个设置本要修复的故障。
- **端到端已验证。** 默认信任链：`UNABLE_TO_VERIFY_LEAF_SIGNATURE`。注入该 bundle：HTTPS 200，且包含两跳重定向。`resolveCaBundle` 有四条断言覆盖 默认/真实文件/不可读路径/无证书文件；把实现回退掉，「resolves a real PEM file」会立刻失败。
- 离线断言 92 项（新增 4 项），客户端 27 项，打包 20 项，发布门 34 项。

## 0.3.5
- **修复：门禁四处绕过**。门禁判断的是「某段的命令词是不是 curl/wget」，因此凡合法地排在命令词前面的东西都必须先剥掉，否则它检查的是变量赋值并被判为安全。此前漏掉的：`FOO=1 curl …`、`PATH=/x curl …`（赋值前缀从未剥离）、`nice -n 5 curl …`、`timeout 30 curl …`（包装器自身选项被当成命令词）、`sudo FOO=1 curl …`（前缀上限 2 个 token）。现按「赋值 → 包装器 → 包装器选项 → 再赋值」的顺序剥离，并补 7 条必须拦、6 条必须放的断言；两条负向对照分别精确打掉赋值剥离与选项跳过。[`a6129be`]

## 0.3.4
- **修复**：对**已被上游截断**的输出不再重复压缩。上游工具（如 `ops_bash`）会自行截断并落盘，沙箱（`ctk_execute`）也有 256 KB 捕获上限并以 `~~~` 收尾；此前本层会对这些**已经处理过**的产物再压一次 —— 省不了任何字节，却把同一份原文**又存一遍**，等于把同一份流量记两次收益。现识别这两种截断标记（`[output truncated; full output: …]` 与独立的 `~~~` 行）并跳过，同时把跳过原因计入台账新增的「跳过原因」一行。[`038447b`]

## 0.3.3
- **文档**：新增中英双语更新说明（本文件），并纳入发布清单与发布门；README 与仓库首页说明同步更新。npm 包开始随版本携带 CHANGELOG。[`01d7107`]

## 0.3.2
- **修复**：`slimOriginalTtlMinutes`（原文保留期）此前只在设置页展示、代码从未读取 ⇒ 面板承诺的过期从不发生，原文无限累积；现于**每次加载**执行一次过期清理。
- **修复**：标记投递失败时的回滚调用 `purgeBlobs({ all: false })` 不传年龄 ⇒ **是空操作**，原文永久留存；现按**精确 id** 回滚，不会牵连其他原文。
- 台账新增「原文保留期 retention」一行，让被消费的配置可见。[`98f6a06`]

## 0.3.1
- **修复**：`ctk_retrieve` 成功路径漏 `isError` ⇒ 宿主按 schema 校验工具输出、缺必需属性直接拒调用，**可逆取回完全不可用**（标记已注入、原文已入库，却取不回来）；现补上。[`75ea559`]
- 台账渲染「输出瘦身 slimmed（块/字节/token/跳过数）」与「可逆原文 blobs」，并把瘦身字节计入 *kept out of context*。

## 0.3.0
- **新增：出口压缩（`tools/post-execute`）**——门禁守入口，这里处理**已经进来**的输出：同构 JSON **无损**表化重编码、表格保留表头+首尾并按**原始行号**采样中段、grep/search 按文件折叠、日志折叠普通行而**逐字保留诊断行**、代码与键值对**不压**。
- **双重门**：字节 ≤ 72% 且估算 token 严格下降，压不动就不压。
- **可逆红线**：有损路径先把原文**逐字节**存好并注入 `[ctk_retrieve id=…]` 标记；新增 `ctk_retrieve` 取回。原文与 FTS5 索引同在**同一个 SQLite 库**（`blobs` 表，BLOB 存取避免重编码）。[`61f162d`]

## 0.2.4
- **修复**：`read` 分支重犯了 `script_path` 的路径基准错——相对路径按插件进程 cwd 解析，而宿主按**会话工作目录**打开；实测同一份 70000 字节文件绝对路径被拦、相对路径整段进对话。[`8607fb2`]
- **新增**：把宿主自带取网页工具（`web_fetch` / `read_page`）纳入整页软引导（此前 shell 里的 curl 被拦而同页可从它们走进来）。

## 0.2.3
- **修复**：相对 `script_path` 解析基准与宿主不一致 ⇒ 读不到文件即当作「无脚本」放行；现统一按会话 cwd 解析。[`5820210`]

## 0.2.2
- **修复**：门禁匹配从「整行子串 + 两侧分隔符」改为**按命令分隔符分段、只比较各段命令词**——修掉双向错误（漏检非首位调用与带前缀/路径的调用；误拦工具名只是参数的文本）。
- **修复**：`ops_bash` 用 `script_path` 时载荷在文件里、门禁完全看不见 ⇒ 补读脚本前 256 KB。
- **修复**：套件自身的句柄泄漏（mock 丢弃 disposer ⇒ SQLite 句柄常开、Windows 删不掉临时目录）。[`da1b0fd`]

## 0.2.1
- **修复**：`ctk_doctor` 版本号硬编码 `0.1.0` 而包已 0.2.0 ⇒ 改为启动时读自身 `package.json`。
- **新增**：`release-check.mjs`（发布就绪门）。[`d98835a`]

## 0.2.0
- **修复**：`guard` 放行时返回 `null` 而非 `undefined` ⇒ 宿主按 `reason !== undefined` 判拒，**每个工具调用都被拒**（run_code 报裸 `Error: null`）。
- **修复**：门禁只认识自带的 shell 名 ⇒ `ops_bash` 上同样的 curl 可绕过；现覆盖全部 shell 名。

## 0.1.0
- 首个版本：`ctk_execute` / `ctk_execute_file` / `ctk_batch_execute`（子进程跑码只回结论）、`ctk_index` / `ctk_search`（基于 `node:sqlite` 的本地 FTS5 知识库）、路由门禁、`ctk_stats` / `ctk_doctor` 与实时占用面板。[`87b35fe`]
