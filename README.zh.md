# 上下文工具箱（dsh-context-toolkit）

> **简体中文** | [English](./README.md)

一个给 DeepSeek Harness 用的插件：**让大块输出不进对话**。

它的做法是把"原始字节"和"结论"分开——命令在子进程里跑、文件在沙箱里分析、网页与长材料归档进本地知识库，对话里只留下结论、片段和计数。另有一道路由门禁，在工具调用前挡掉那些注定会灌满对话的操作。

**零第三方运行时依赖**：知识库用 Node 自带的 `node:sqlite`（含 FTS5），跑码用系统已有的解释器，安装后不需要再拉任何包。

## 它有什么用

| 问题 | 这个插件的做法 |
|---|---|
| 跑个命令，输出几千行，只想知道"有几个" | `ctk_execute` 在子进程里跑，只把结论带回来 |
| 读大文件做统计，不想把全文塞进上下文 | `ctk_execute_file` 让文件留在沙箱里 |
| 一次要问很多条命令 | `ctk_batch_execute` 一条调用跑完，逐条报状态 |
| 网页/长文档看完就废，下次还要重看 | `ctk_index` 归档，`ctk_search` 按需取片段 |
| `curl` / `wget` 直接把整页灌进对话 | 路由门禁硬拦，并给出替代方案 |
| 不知道到底省了多少 | `ctk_stats` 报台账；设置页有实时占用面板 |

## 工具

| 工具 | 用途 |
|---|---|
| `ctk_execute` | 在沙箱子进程里跑代码（javascript / esm / typescript / shell），只回结论 |
| `ctk_execute_file` | 对某个文件跑代码做统计或抽取，文件原文不出沙箱 |
| `ctk_batch_execute` | 一次跑多条命令，逐条状态，输出只有结论 |
| `ctk_index` | 把文本或文件存进本地 FTS5 知识库 |
| `ctk_search` | 多查询检索知识库，返回围绕命中词的片段 |
| `ctk_fetch_and_index` | 抓网页 → 去标签转文本 → 直接入库 |
| `ctk_purge` | 删除已归档内容（必须 `confirm: true`） |
| `ctk_stats` | 节约台账：拦截次数、沙箱保留字节、归档字节、调用计数 |
| `ctk_doctor` | 自检：解释器能否真启动、临时目录可写、知识库能否往返 |
| `ctk_context_report` | 当前会话的上下文占用与构成 |

## 安装

从 npm 安装（推荐）：

```bash
dsh plugin --profile desktop add dsh-context-toolkit
```

从 GitHub 安装：

```bash
dsh plugin --profile desktop add github:chimneyQ/dsh-context-toolkit
```

本地 checkout 时可直接指定目录：

```bash
dsh plugin --profile desktop add D:\path\to\dsh-context-toolkit
```

装完确认 `<DSH_HOME>/profiles/desktop/package.json` 的 `dsh.profile.bundles` 里出现 `dsh-context-toolkit`。

卸载：

```bash
dsh plugin --profile desktop remove dsh-context-toolkit
```

## 怎么用更划算

**默认就该走 `ctk_*`**。尤其是要分析、计数、过滤、看摘要的场合——直接把输出读进对话是这套插件要解决的原始问题。

```js
// 想知道一个大目录里有多少 .log 文件、总共多大
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

长材料先归档，之后按需取：

```js
await ctk_index({ path: 'D:/specs/api.md' });          // 全文留在库里
await ctk_search({ queries: ['rate limit', 'auth'] });  // 只取相关片段
```

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `routing` | `true` | 路由门禁总开关 |
| `denyCurlWget` | `true` | 硬拦 curl / wget |
| `bashNudgeMinCommandBytes` | `4096` | 超长命令的引导阈值（0 = 关闭） |
| `maxReadBytesBeforeAsk` | `51200` | 大文件整读的引导阈值（0 = 关闭） |
| `nudgeFetchTools` | `true` | 把宿主取网页工具（`web_fetch` / `read_page`）也纳入整页引导 |
| `trustedReadBasenames` | `package.json` 等 | 不受整读门禁限制的文件名 |
| `compressNudgeTokens` | `120000` | 占用提示阈值（tokens） |
| `searchLimit` | `5` | `ctk_search` 每次查询的片段数上限 |
| `snippetChars` | `900` | 每个片段的字符上限 |
| `fetchMaxBytes` | `2000000` | 单页抓取上限 |
| `storageDir` | 空 | 知识库根目录，空 = `<DSH_HOME>/context-toolkit` |
| `tools.*` | 见下 | 逐个工具的开关 |

工具开关：`tools.execute`、`tools.executeFile`、`tools.batchExecute`、`tools.index`、`tools.search`、`tools.fetchAndIndex`、`tools.purge`、`tools.stats`、`tools.contextReport`、`tools.doctor`，默认全部开启。

## 校验

离线套件不依赖 DSH 运行时：

```bash
node smoke.mjs        # 70 项：契约、运行时探测、三工具、门禁（分段匹配 + 前缀/路径归一 + 路径基准对齐 + script_path 与取网页工具覆盖）、资源释放、知识库、观测、版本自述
node test-client.mjs  # 27 项：浏览器半体契约与双语字典一致性
node test-package.mjs # 20 项：发布清单与零依赖约束
node release-check.mjs # 27 项：发布就绪（清单/依赖/工具数/门禁匹配/版本/SHA 覆盖/无硬编码路径）
```

## 已知边界

- **出站抓取受本机网络影响**：若本机把域名解析到回环地址，`ctk_fetch_and_index` 会失败并明确说明原因（而不是只报 "fetch failed"）；此时改用 `ctk_index` 归档本地材料。
- **`ctk_execute` 的超时是硬杀**：超时会终止子进程并把 `timedOut` 标出来。
- **单次捕获上限 256 KB**，超出部分只计数不保留；回给对话的文本另有 4000 字符硬帽，因此 1 MB 的单行输出也不会整段进入上下文。
- **知识库按路径去重**：同一路径再次归档是替换，不是追加。
- **门禁精确而非穷尽**：只有当洪水工具是某个分段的「命令词」时才拒绝（会先剥掉 `sudo`/`exec` 等前缀、归一化路径与 `.exe` 等扩展名），`script_path` 最多读取前 256 KB。程序内部发起的调用（如 `python -c 'import wget'`）不在其职责内。
- **路径基准与宿主一致**：门禁读取 `script_path` 与 `read` 的 `file_path` 时，按**会话工作目录**解析相对路径（与宿主实际打开文件的基准相同）；否则「宿主能跑、门禁看不见」就是一条现成的绕过路径。

## 许可

MIT
