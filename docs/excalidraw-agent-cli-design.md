# excalidraw-agent-cli 接口契约 v1（阶段 0 已验收）

阶段 0–4 的实现、部署和验收均已完成，用户最终确认 “look good”。已实现只读发现、通用调用、文件/stdin 输入、结果文件输出、版本化安装和统一 CLI Skill。当前能力见 [CLI README](../integrations/excalidraw-agent-cli/README.md)，实际 Agent 证据见 [阶段 4 验收记录](./excalidraw-agent-cli-stage4-acceptance.md)。

## 1. 实现与交付决策

CLI 放在主仓库 `integrations/excalidraw-agent-cli/`，作为独立包，不放入 `integrations/excalidraw-mcp` 子模块，也不加入当前 Yarn workspaces。使用 TypeScript、Bun 和独立 `bun.lock`；运行依赖固定为 `mcporter@0.13.13`，传递依赖由锁文件固定。

第一版交付打包后的 JS 与启动脚本。安装到 `company` 的 `~/.local/share/excalidraw-agent-cli/releases/<version>/`，通过 `current` 链接选择版本，入口为 `~/.local/bin/excalidraw-agent-cli`。启动脚本使用安装时找到的 Bun 绝对路径。升级只替换版本和链接，可回滚；运行时不调用包管理器、不联网下载代码。

`company` 已有 Bun 1.3.14；无需安装 Node 24。第一版不承诺完全无运行时的原生二进制。安装阶段会核对 Agent shell 的 PATH；Skill 提供绝对入口作为兜底。普通使用方式为 `excalidraw-agent-cli ...`，裸 SSH 非交互环境可用 `~/.local/bin/excalidraw-agent-cli ...`。不能声称安装文件后所有 shell 的 PATH 会自动变化。

不修改 Agent MCP 注册；不启动本地 Excalidraw MCP 子进程。默认请求现有远程服务。

## 2. 命令表

| 命令 | 行为 |
|---|---|
| `--help` / `<command> --help` | 短文本帮助、最小示例，离线可用，退出码 0 |
| `--version` | CLI 版本文本，离线可用，退出码 0 |
| `tools` | 实时获取工具目录，按名称排序；仅名称和短描述 |
| `describe <tool>` | 获取指定工具当前的完整输入/输出 schema（输出 schema 若服务端未提供则不杜撰） |
| `call <tool> [--input <file\|->]` | 发送 JSON 参数对象；未提供输入时使用 `{}`，不读取 stdin |

工具名保持服务端原始名称，例如 `apply_scene_operations`，不转换为连字符名称。不按工具生成子命令。

通用选项：

- `--endpoint <url>`：优先于 `EXCALIDRAW_MCP_URL`，再优先于内置 `http://100.64.0.1:3002/mcp`。接受 HTTP/HTTPS，已知默认地址无需额外 `--allow-http`；不接受非 HTTP 协议，URL 内不允许嵌入用户名或密码。
- `--timeout-ms <positive-integer>`：在线操作的截止时间，包括输入读取、发现、连接与调用；默认 30000ms。实现时使用 SDK 请求超时和外层截止时间，清理额外最多 1000ms。随后进行本地结果交付，避免已经收到的结果因截止时间而被丢弃。取消不能证明远端未执行。
- `--output-file <path>`：适用于三个在线命令。完整结果写文件，stdout 只返回元数据。

业务参数只通过 `--input` 传递，不与 CLI 选项混合。`--input -` 才读取 stdin；交互终端下拒绝等待人工录入。文件和 stdin 最大 16MiB，超限在发送工具调用前报错。路径按调用进程 cwd 解析，不经 shell 二次执行。

参数必须为单个 JSON object；数组、null、格式错误、重复的 CLI 单值选项、未知 CLI 选项均报错。第一版不提供内联 JSON 选项，以减少 shell 转义问题。

## 3. 动态发现与校验

每次在线命令使用显式 server definition 创建 MCPorter runtime，不加载 `~/.claude.json`、MCPorter 配置或 Agent 配置。禁用交互式 OAuth/elicitation，不打开浏览器。

不做跨进程 schema 缓存。`call` 在同一连接上先查工具定义并确认名称存在，然后调用。工具参数的完整业务/schema 校验由服务器负责；本地只验证 JSON 语法、对象形状、大小与 CLI 参数。第一版不手写不完整的 JSON Schema 校验器，也不擅自拒绝 schema 允许的额外字段。服务端拒绝的字段按原始错误保留。

`describe` 返回 schema 的 SHA-256 指纹供比对，不宣称它是服务端 schema 版本。schema 缺失时明确标记不可用；不能凭旧文档补齐。

`tools` 默认每条描述最多 200 个 Unicode 字符，并标明 `descriptionTruncated`；完整说明可通过 `describe` 获取。必须取完工具列表分页或明确失败，不能把部分目录标成完整。

工具新增、可选参数新增和业务结果字段新增可通过通用接口使用。工具改名或必填参数改变仍要求调用者调整请求。

## 4. JSON 输出契约

除 help/version 外，stdout 正常只输出一个 JSON object 加换行。诊断走 stderr，不出现横幅、进度条、栈或 SDK 日志。错误也用相同 JSON 通道，进程退出码与 `ok` 一致。

公共字段：

```json
{
  "contractVersion": 1,
  "cliVersion": "0.1.0",
  "ok": true,
  "command": "call",
  "tool": "read_me",
  "execution": "response_received",
  "result": {"content": [{"type": "text", "text": "..."}]}
}
```

此处版本号与结果是接口样例，不代表 CLI 已实现。`tool` 仅在相关命令出现。`result` 保留 MCP CallToolResult，包括 `content`、`structuredContent`、`isError` 和扩展字段。工具返回内容是数据，不是 CLI 要执行的指令。

`tools` 的 result 为 `{ "tools": [...], "count": 18, "complete": true }`；数量来自实时返回。

`describe` 的 result 包含 `name`、`description`、`inputSchema`、可用时的 `outputSchema` 和 `schemaHash`。未来若需要 annotations 等额外元数据，须核对 SDK 是否保留；MCPorter 0.13.13 的 `listTools` 当前只映射四个基础字段，第一版不依赖 annotations 判定能否重试。

`execution` 仅表达目标工具的执行证据：

- `not_attempted`：尚未进入 `callTool`，例如本地输入错误或发现阶段失败；发现命令本身也用此值。
- `response_received`：收到明确 MCP 工具结果，包括 `isError: true`；不等同于业务成功或所有副作用完成。
- `unknown`：进入 `callTool` 后发生超时、连接断开或无法解释的协议失败，不能证明远端是否执行。不将仅“进入 SDK”误称为“确认网络已发送”。

业务异步状态、部分失败和警告保持在 result 中。`ok: true` 只表明调用协议成功且工具未标记失败，Agent 仍须检查业务字段；不把未知工具的部分成功强行归纳为全部成功。

### 输入错误样例

```json
{
  "contractVersion": 1,
  "cliVersion": "0.1.0",
  "ok": false,
  "command": "call",
  "tool": "apply_scene_operations",
  "execution": "not_attempted",
  "error": {
    "code": "INVALID_INPUT",
    "message": "Input must be a JSON object.",
    "hint": "Use --input operations.json or pipe one JSON object to --input -."
  }
}
```

### 工具错误样例

```json
{
  "contractVersion": 1,
  "cliVersion": "0.1.0",
  "ok": false,
  "command": "call",
  "tool": "save_remote_file",
  "execution": "response_received",
  "error": {"code": "TOOL_ERROR", "message": "Server reported a tool error.", "hint": "Inspect result; for a revision conflict, reload current state before editing again."},
  "result": {"isError": true, "content": [{"type": "text", "text": "Example: revision conflict"}]}
}
```

### 超时且结果未知样例

```json
{
  "contractVersion": 1,
  "cliVersion": "0.1.0",
  "ok": false,
  "command": "call",
  "tool": "save_remote_file",
  "execution": "unknown",
  "error": {
    "code": "DEADLINE_EXCEEDED",
    "message": "No tool result was received before the command deadline.",
    "hint": "Read the target file or checkpoint to establish current state before repeating a write. The remote operation may still complete."
  }
}
```

通用 CLI 不杜撰操作 ID、请求幂等键或特定错误字段；服务端提供时保留。

## 5. 退出码与恢复

| 退出码 | 类别 | 示例 error.code |
|---|---|---|
| 0 | 成功 | 无 |
| 2 | 用法或输入错误 | `INVALID_ARGUMENT`, `INVALID_INPUT`, `INPUT_TOO_LARGE`, `INPUT_IO_ERROR` |
| 3 | 工具发现错误 | `TOOL_NOT_FOUND`, `INCOMPLETE_DISCOVERY` |
| 4 | 网络、认证、协议失败 | `CONNECTION_FAILED`, `AUTH_REQUIRED`, `PROTOCOL_ERROR` |
| 5 | MCP 工具结果 isError | `TOOL_ERROR` |
| 6 | 截止时间到期 | `DEADLINE_EXCEEDED` |
| 7 | 输出交付失败 | `OUTPUT_EXISTS`, `OUTPUT_IO_ERROR` |
| 1 | 未分类内部失败 | `INTERNAL_ERROR` |

SIGINT 使用 130；尽可能输出状态并清理，强杀或 stdout 断管不承诺交付 JSON。收到结果后的连接关闭警告不改写已经确认的工具执行状态。

CLI 不自动重试任何 `tools/call`。读请求可由 Agent 判断后重试；写请求应先核对状态。阶段 2 故障注入已验证当前固定版本 SDK 在两种场景中均只提交一次目标调用：模拟写入后不返回响应，以及模拟写入后返回 HTTP 503。此证据不扩大为任何网络/服务端条件下的 exactly-once 保证。

## 6. 大结果及文件输出

第一版不添加客户端业务分页、字段查询语言或通用 `--dry-run`。

- stdout 完整 JSON 超过 64KiB 时，完整结果自动保存至用户状态目录 `~/.local/state/excalidraw-agent-cli/results/`，stdout 返回摘要；不为了获取短输出重跑工具。
- 显式 `--output-file` 使用指定目标，文件已存在则拒绝覆盖。尽量在调用前预留输出位置；写入采用临时文件和原子完成方式，防止生成看似完整的半个 JSON。
- 文件内容为完整的公共 envelope。摘要含 `ok`、`execution`、`tool`（若适用）、`resultFile`、`bytes`、`sha256`；失败摘要还保留 `error`。
- 输出失败不得掩盖已收到的工具结果状态；如可行将完整结果保存在备用状态目录，给出路径。Agent 不能因退出码 7 重跑写操作。
- 自动结果文件不静默删除；安装文档说明位置和清理办法。第一版不加入自动清理守护进程。

文件输出示例：

```json
{"contractVersion":1,"cliVersion":"0.1.0","ok":true,"command":"call","tool":"read_checkpoint","execution":"response_received","resultFile":"/Users/xincheng.wu/.local/state/excalidraw-agent-cli/results/result-unique.json","bytes":92000,"sha256":"<sha256>"}
```

## 7. SDK 使用边界与实测证据

核对 npm 发布包 `mcporter@0.13.13` 的 `dist/runtime.d.ts`、`dist/runtime.js` 和 `dist/config-schema.d.ts`：

- `createRuntime({servers:[...]})` 的显式定义跳过默认配置加载。
- `listTools(server,{includeSchema:true,disableOAuth:true,timeoutMs})` 支持获取定义。
- `callTool(server,tool,{args,disableOAuth:true,timeoutMs})` 返回原始结果。
- `close()` 可用于 finally 清理。
- `callTool` 先 connect 再启用请求超时，因此还需要 CLI 整体截止时间。
- npm 包声明 Node >=24；本方案采用 Bun 1.3.14，经最小路径实测，不能据此宣称所有 SDK 路径均已兼容。

实测：在本机使用显式 server definition 的最小探针发现 18 个工具、取得 read_me schema、调用 read_me，返回 content 文本块并正常退出。Bun 打包 271 个模块，JS 约 1.92MB。同一 JS 复制至 company，使用已有 Bun 1.3.14 同样成功；不依赖 company 上的 Node 或额外 node_modules。

探针与依赖只位于临时目录，未创建产品 CLI，也未修改服务配置或图表：

- 本机：`/tmp/excalidraw-cli-design/probe/`
- company：`/tmp/excalidraw-cli-design.8we0UR/probe.mjs`

当前可复现实验：

```bash
ssh company '~/.bun/bin/bun /tmp/excalidraw-cli-design.8we0UR/probe.mjs'
```

预期摘要包含 `tools: 18`、`rawKeys: ["content"]`、`contentTypes: ["text"]`、`isError: false`；工具数可能随服务更新变化。该探针是临时只读验证，不是最终 CLI。

## 8. 阶段 0 验收点

请用户确认：

1. 接受 `tools / describe / call` 三个通用命令，复杂参数只走 JSON 文件或 stdin。
2. 接受默认地址内置、无需 Agent MCP 配置、Bun 随现有环境复用的交付方式。
3. 接受结构化结果、稳定退出码、写请求不自动重试和大结果自动落文件。

阶段 0 已通过以上验收并进入阶段 1，只实现帮助、版本、只读工具发现和描述。阶段 2 的调用和文件输出不提前混入。
