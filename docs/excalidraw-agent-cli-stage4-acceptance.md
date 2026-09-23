# 阶段 4：Skill 与 Coding Agent 验收

状态：实现、自动验收及用户最终验收均通过（用户确认 “look good”）。CLI `0.4.0`，MCPorter `0.13.13`，Bun `1.3.14`。

## 已交付

- 仓库维护源：[Excalidraw CLI Skill](../integrations/excalidraw-agent-cli/skill/excalidraw/SKILL.md) 及 [工作流参考](../integrations/excalidraw-agent-cli/skill/excalidraw/references/workflows.md)。
- Skill 安装器：`dist/install-skill.js --source <skill/excalidraw>`。
- company 上三个发现入口指向同一个内容版本，不维护多份正文：
  - `~/.agents/skills/excalidraw-skill`
  - `~/.claude/skills/excalidraw-skill`
  - `~/.opengrok/skills/excalidraw`
- 该版本的实际路径：`~/.local/share/excalidraw-agent-cli/skills/8a009074ea38c8e8/excalidraw`。
- 旧 Skill 及发现目录内的旧备份均移至 `~/.local/state/excalidraw-agent-cli/skill-backups/1790153220560-cb12d66a/`，manifest 记录原路径，可恢复。
- 正常 OpenGrok `inspect` 只发现一份名为 `excalidraw` 的 CLI Skill；已有 MCP 注册仍保留，不是此工作流的前提。
- CLI 已升级到 `0.4.0`，`previous` 指向 `releases/0.3.0`。CLI 回滚和 Skill 恢复是两项独立操作。

Skill 只记录使用策略、状态账本、错误恢复和工作流。参数 schema 通过 CLI 实时获取；没有复制完整 API 定义。它明确区别远程文件 revision、场景 revision 和元素版本，要求检查 warnings、保存后重新打开，不盲目重试未知结果。

## 隔离 Agent 试验

在 company 上运行实际 OpenGrok，模型 `gpt-6-sol`。使用独立 HOME、独立工作目录、临时链接的现有模型配置和已安装 Skill；没有复制或创建 MCP 注册文件。

启动前证据：

- `open-grok mcp list` 返回 `No MCP servers configured`。
- `open-grok inspect --json` 中 `mcpServers: []`，仅发现该 Excalidraw Skill。
- headless 工具允许列表仅含终端和文件读取；禁用 web search、子 Agent 和跨会话记忆。

要求 Agent 实际完成：新建中文三节点图及绑定箭头、创建 Markdown、保存重开、原子修改中间标签、版本化更新 Markdown、保存后重读并验证。限制写入新建的唯一验收文件；不允许原生 MCP 工具、直接 HTTP 请求、直接写 `.excalidraw` 或修改配置。

首轮在 35 轮运行器上限处终止。此时业务创建、修改、保存与最终重读都已经完成，但未生成总结文件。随后续接**同一会话**，只读取现有结果并写报告，3 轮后成功。续接未重复远程创建、编辑或保存。

运行结束后移除了隔离 HOME 中临时的模型配置符号链接；生产模型/MCP 配置没有修改。测试轨迹和报告留存，不能将“0 MCP 注册”误称为没有使用 MCP 协议——CLI 内部仍通过 MCPorter 调用远程 MCP 服务。

## 结果与独立复核

| 字段 | 值 |
|---|---|
| 文件 | `cli-stage4-agent-05e0ceb6.excalidraw` |
| 远程 revision | `e473f9c51531fff39e8a209362ca2e26156fa785a6b46e92590a46bc651d8989` |
| Agent 最终重开 checkpoint | `2e689335398341d482` |
| 独立复核重开 checkpoint | `aae4b45920a04d669d` |
| Markdown frame | `markdown_126de85b528e46da93` |
| Markdown version | `2` |
| 保存 warnings | `[]` |

已独立通过 CLI 重新打开远程文件，核对：

- 中间节点标签为“Agent CLI 已验证”。
- Markdown 状态为“Skill 与 CLI 闭环已完成”。
- 两条箭头的双端 binding 与节点反向引用一致。
- 最终保存和独立打开返回同一文件 revision。
- Agent 报告明确未做视觉或拖动验收，没有把数据检查冒充画布验证。

本轮没有修改阶段 3 的文件或其他业务图表。当前原子工具没有移动节点操作，所以试验使用实时支持的标签编辑；阶段 3 的实际拖动检查已由用户确认。

## 测量结果与边界

| 指标 | 实测 |
|---|---|
| Agent 调用的终端工具 | 45 次 |
| Agent 文件读取工具 | 10 次 |
| 原生 MCP 工具调用 | 0 次 |
| 首轮 / 续接轮数 | 35 / 3 |
| 两次运行器耗时合计 | 378.53 秒 |
| 轨迹中 tool_result 内容序列化字节数 | 454,782 bytes |
| 本地测试 | 27 项、167 个断言通过 |

工具调用按轨迹 tool-use ID 去重；终端调用次数不是 MCP 请求次数，一个终端命令可能执行多项只读检查。tool_result 字节数是轨迹可见内容的 JSON UTF-8 序列化长度，不等同于模型 token 数，也不包括全部系统提示。

模型上报的原始 usage 分别为：

- 首轮：input_tokens 566,377；output_tokens 4,951；cache_read_input_tokens 804,608。
- 续接：input_tokens 145,784；output_tokens 1,761；cache_read_input_tokens 12,800。

这些字段保留为服务返回值，不据此推断实际账单；自定义模型的 cost 字段为 0 不代表免费。本次只有单次工作流验证，没有 CLI/MCP 对照实验，**不能声称已证明 token 或耗时优势**。达到轮数上限是测试运行器限制，已如实记录；流程中的多次结果读取也说明仍有压缩反馈成本的优化空间。

测试覆盖：只读发现、分页、动态工具/参数、输入校验、工具错误、超时不重发、文件竞争恢复、版本安装/回滚，以及旧 Skill 去重备份。类型检查、构建和格式检查通过；代码知识图谱已更新。

## 证据位置

company：

```text
~/.local/state/excalidraw-agent-cli/acceptance/stage4-agent-05e0ceb6/
  inspect.json                    # 启动时发现的 Skill / 空 MCP 列表
  mcp-list.txt
  prompt.txt
  events.ndjson                   # 首轮轨迹
  run-status.json
  finish-events.ndjson            # 同会话续接轨迹
  finish-status.json
  metrics.json
  independent-verification.json
  workspace/summary.json          # Agent 自己生成的总结
  workspace/*request.json         # Agent 请求
  workspace/*result.json          # Agent 结果
```

## 用户最终验收

新开 company 上的 OpenGrok 会话，让它载入更新后的 Skill：

```text
/excalidraw 用 excalidraw-agent-cli 打开 cli-stage4-agent-05e0ceb6.excalidraw，检查三个节点和 Markdown 状态；不要修改文件。
```

也可以直接：

```bash
ssh company
excalidraw-agent-cli --version
excalidraw-agent-cli tools
```

查看画布时打开 <http://100.64.0.1:5000/>，在 Remote files 中选择上述阶段 4 文件。本次新图的视觉/拖动未自动验收；需要视觉确认时由用户实际查看。

- [x] CLI 与 Skill 部署完成。
- [x] 无原生 MCP 注册的实际 Agent 数据闭环通过。
- [x] 独立复核远程持久化与绑定通过。
- [x] 用户最终验收通过。

用户在 `~/coding/risk` 试用后确认 “look good”，并提供终端摘要：耗时 `1m31s`、模型 `gpt-6-sol` / `medium`，显示 `↑19k ↓999 R102k CH96.9%`。会话恢复提示为 `pi --session 01a0cd81-c3a2-762e-8ae2-cbb96ce99068`。

这些是用户提供的试用记录；未读取该会话轨迹，也不据此推断具体工具调用次数、原生 MCP 使用情况或视觉检查范围。它与上文独立隔离试验的指标分开记录。
