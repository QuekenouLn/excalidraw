---
name: excalidraw
description: >
  用 excalidraw-agent-cli 创建、查询、增量编辑并保存远程 Excalidraw 图表及 Markdown Frame。
  用于 /excalidraw、画架构图/流程图、编辑已有画布或远程 .excalidraw 文件。
  通过 shell 调用 CLI，无需 Coding Agent 注册 MCP。
---

# Excalidraw via CLI

使用 `excalidraw-agent-cli`，其默认端点已配置。CLI 通过 MCP 与服务通信，但 Agent 不需要使用 `search_tool`、原生 MCP 工具或配置 MCP server。

适配 CLI 0.3.x / 0.4.x、输出契约 `contractVersion: 1`。工具和参数以实时查询为准；不要把本指南当作完整 schema。

## 最小入口

```bash
excalidraw-agent-cli --version
excalidraw-agent-cli tools
excalidraw-agent-cli describe create_view
excalidraw-agent-cli call read_me
```

若 PATH 找不到命令，尝试 `~/.local/bin/excalidraw-agent-cli`。若仍不可用，报告安装缺失；不要临时使用 npx 下载未知版本。默认地址是 `http://100.64.0.1:3002/mcp`，需要 Tailscale 可达；仅在用户要求其他端点时使用 `--endpoint` 或 `EXCALIDRAW_MCP_URL`。

第一次使用一个工具前，`describe <tool>` 查看参数。无参数工具省略 `--input` 即传 `{}`。有参数时写普通 JSON **请求文件**，再调用：

```bash
excalidraw-agent-cli call <tool> --input request.json
# 或显式从管道读取一个 JSON object
printf '%s\n' '{}' | excalidraw-agent-cli call list_remote_files --input -
```

允许使用 Python/JS 编写、读取请求和结果 JSON；所有远程图表内容修改必须通过 CLI 的业务工具完成。不要直接写 `.excalidraw` 文件或修改服务端存储来绕过版本检查。

## 先理解结果，再继续

- 检查进程退出码、`ok`、`execution`。完整业务结果在 `result` 中。
- 若有 `resultFile`，读取该本地文件以获取完整 envelope；摘要不是缺失业务数据。不要为获取完整结果而重复执行写操作。
- 优先使用 `result.structuredContent`。某些工具只有 `result.content[].text`，其中可能是 JSON，先检查再解析。不要假定所有工具返回相同形状。
- `--output-file <new-path>` 保存完整结果到运行 CLI 的机器，**不等于远程图表已保存**。文件必须尚不存在。
- 警告、异步状态或部分成功仍需检查。CLI `ok: true` 不证明布局正确，也不证明所有业务动作完成。

## 工作流

根据任务按需读取 [workflows.md](./references/workflows.md)，然后按实时 schema 调用对应工具。

| 目标 | 路径 |
|---|---|
| 新图 | `read_me`（本次首次创建前只读一次）→ `create_view` |
| 编辑单个节点 / 线头 / 卡片 | `open_remote_file` → `select_scene_elements`（按 ID）→ `edit_scene_element` |
| 批量连线与标签操作 | `open_remote_file` → 按目标选择 → `apply_scene_operations` |
| Markdown | `create_markdown_frame`，或先 `get_markdown_frame` 再 `update_markdown_frame` |
| 长期保存 | `save_remote_file` → `open_remote_file` → 查询核对 |
| 结构检查 | `query_scene_graph`，必要时 `read_checkpoint` |

Skill 教工作流；`describe` 提供参数事实。局部编辑优先 `edit_scene_element`：支持节点位置、尺寸、样式和标签，箭头样式与线头，以及 Markdown Frame 转普通卡片。默认仅目标及其绑定文字可变化；连带修改其他元素会整笔失败，必须显式列入 `allowedElementIds` 才可提交。不要用 `create_view` 重建整图来修改一个元素，不要为局部编辑查询完整场景。

## 状态与版本

随任务维护小型账本：当前 checkpoint、父 checkpoint、元素 ID、远程文件名/revision、Markdown frame ID/version。

- 新 checkpoint 成功返回后立即更新账本，不继续用旧 checkpoint 编辑。
- **远程文件 revision**、**场景 revision**、**元素 version/versionNonce** 是不同的并发控制值，不能混用。
- 原子编辑前查询场景 revision 和当前元素版本；Markdown 编辑前读取其当前版本。
- 只有 `save_remote_file` 成功返回 revision 才算持久化。已有文件必须传最新 `expectedRevision`；新文件先查重，创建时不伪造 revision。
- 保存后重新打开和检查实际内容；checkpoint 是临时工作版本，远程文件是长期真源。

## 错误恢复

| 情况 | 下一步 |
|---|---|
| 退出 2，`not_attempted` | 修正 CLI 参数或 JSON；不要把数组当工具参数根对象 |
| 退出 3 | 重新 `tools` / `describe`，不要猜不存在的工具 |
| 退出 4，连接或认证失败 | 检查端点/Tailscale；不修改 Agent MCP 配置来解决 CLI 连接 |
| 退出 5，`TOOL_ERROR` | 读取保留的服务端错误；revision 冲突时重新打开，再重放最小编辑 |
| 退出 6 或 `execution: unknown` | 远端可能已执行或仍在执行；先查询目标文件/checkpoint，**不能盲目重试写操作** |
| 退出 7，输出失败 | 查看 `operationOk`、`execution` 和备用 `resultFile`；不要因此重做远端写入 |

不绕过版本检查，不去掉 `expectedRevision` 强写，不杜撰幂等键或 dry-run 能力。远程删除仅在用户明确授权对应文件后执行；验证任务优先使用新建且可辨认的测试文件。

## 完成与视觉边界

完成后报告：文件名、最新 revision/checkpoint、所做变更、警告和验证结果；涉及 Markdown 时报告 frame ID/version。

CLI 不渲染聊天里的 MCP App。数据检查不等于视觉验收：看文字裁切、重叠、箭头位置需要真实画布；拖动跟随需要实际交互检查。现有画布入口为 `http://100.64.0.1:5000/`，在 **Remote files** 打开目标文件。未做视觉或拖动检查时明确说明，不声称通过。
