# 阶段 3：company 安装与远程图表验收

状态：安装和 CLI 数据闭环检查完成；用户已确认本阶段验收通过（“is ok. can next”）。CLI 版本 `0.3.0`，MCPorter `0.13.13`，Bun `1.3.14`。以下安装路径和版本是阶段 3 的验收记录；当前版本以 `--version` 为准。

## 安装结果

- 命令：`/Users/xincheng.wu/.local/bin/excalidraw-agent-cli`
- 当前版本：`/Users/xincheng.wu/.local/share/excalidraw-agent-cli/releases/0.3.0/`
- 版本指针：`~/.local/share/excalidraw-agent-cli/current`
- 安装器：`~/.local/share/excalidraw-agent-cli/current/install.js`
- 默认服务：`http://100.64.0.1:3002/mcp`

安装器固化 Bun 的绝对路径，打包产物包含运行依赖。重复安装同一产物已验证；不会运行 npm/npx 或在线下载依赖。

company 的 `.zshrc` 已包含用户命令目录，但原 `.zshenv` 没有。已保留原内容并创建带时间戳备份，再增加一个仅当 PATH 中缺少该目录时才加入 `$HOME/.local/bin` 的区块。没有修改 OpenGrok、Claude Code 或其他 Agent 的 MCP 配置。

已验证：

```bash
ssh company 'command -v excalidraw-agent-cli; excalidraw-agent-cli --version'
# /Users/xincheng.wu/.local/bin/excalidraw-agent-cli
# 0.3.0
```

交互式 zsh 也能找到命令。若某个 Agent 主动重置 PATH，可以使用绝对入口；这是运行环境问题，无需配置 MCP。

## 验收图表账本

| 字段 | 值 |
|---|---|
| 远程文件 | `cli-stage3-acceptance-d99d0c74.excalidraw` |
| 当前远程 revision | `009d0855715b50962ce5d6455c8ff6fe34638d1a4c825b6b804e5bc67595709b` |
| 保存时 checkpoint | `b030e3d5cc1948518d` |
| 保存后重新打开的 checkpoint | `8c511cdce2cb4a3ab0` |
| 场景 revision（不同于远程文件 revision） | `54cceeec100fc71325547606448856a4a3f2ed93fe2e02dada1e4f6dc6078656` |
| Markdown frameId | `markdown_261ce76e9c2f4e56b1` |
| Markdown elementVersion | `2` |
| 保存警告 | `[]` |

以上是本阶段自动检查时的状态，后续人工编辑会改变 revision。新建/派生链：

`f0dbd88f138c492d93` → `655ee0bf0fbf413dbb` → 打开文件 `43df972f1f2a4822ac` → 原子编辑 `4df4190951194269a0` → Markdown 更新 `1869abc240ed41b2a4` → restore `b030e3d5cc1948518d` → 重开 `8c511cdce2cb4a3ab0`。

节点 ID：`cli_input`、`cli_edit`、`cli_saved`；箭头：`cli_arrow1`、`cli_arrow2`；标题：`cli_title`。

公司机器上的完整请求、结果与账本位于：

```text
~/.local/state/excalidraw-agent-cli/acceptance/cli-stage3-acceptance-d99d0c74/
```

没有修改或删除其他远程图表。

## 已完成检查

- 创建中文三节点图与双端绑定箭头；创建 Markdown Frame。
- 初次保存成功，重新打开得到 10 个场景元素。
- 从实时 `query_scene_graph` 获取场景 revision 和元素版本，通过 `apply_scene_operations` 将中间标签改为“原子编辑已验证”。返回的派生 diff 包含两条箭头的几何刷新。
- 读取 Markdown 当前版本后，以 `find_replace` 更新状态，版本从 1 增至 2。
- restore 最新 checkpoint 后保存，warnings 为空。
- 使用旧远程 revision 故意保存同一验收文件，服务端返回 `File changed since it was opened`；CLI 退出码 5、`TOOL_ERROR`、`execution: response_received`。
- 再次打开确认文件 revision 未被冲突请求改变，中文标签与 Markdown 更新均已持久化。
- 两条箭头的起点和终点都为 bound；节点到箭头的反向引用仍存在。
- 文字使用 fontFamily 11、水平居中，绑定文字宽度在容器范围内。这是数据层检查，不代替实际视觉检查。
- 25 项测试、149 个断言、类型检查与构建通过。安装测试覆盖简化 PATH、含空格/引号路径、重复安装、升级/回滚、同版本内容变更拒绝、非托管命令保护。

实时原子编辑 schema 只包含 `add_edge`、`set_edge_label`、`set_node_label`，没有移动节点操作。本阶段未通过原始 x/y 字段赋值模拟移动。

## 用户验收

SSH 后已不需要临时函数：

```bash
ssh company
excalidraw-agent-cli --version
excalidraw-agent-cli tools

cli_acceptance="$HOME/.local/state/excalidraw-agent-cli/acceptance/cli-stage3-acceptance-d99d0c74"
excalidraw-agent-cli call open_remote_file --input "$cli_acceptance/open.json"
excalidraw-agent-cli call query_scene_graph --input "$cli_acceptance/graph.json"
excalidraw-agent-cli call get_markdown_frame --input "$cli_acceptance/markdown.json"
```

`graph.json` 和 `markdown.json` 使用上面的验收 checkpoint。以后若 checkpoint 失效，先 open 文件，再把新 checkpointId 用于查询；不要把旧 checkpoint 当永久档案。

画布入口：<http://100.64.0.1:5000/>。在 **Remote files** 中搜索并打开 `cli-stage3-acceptance-d99d0c74.excalidraw`。

- [x] 三个中文节点及标题可读，无裁切或重叠；中间标签为“原子编辑已验证”。
- [x] Markdown Frame 显示验收说明，末尾状态为“原子编辑已验证，已完成保存后重新读取”。
- [x] 拖动中间节点，确认两侧箭头端点随动。
- [x] 若保存了拖动结果，重新打开后再次检查绑定；最终 revision 需重新查询。

以上以用户对阶段 3 的整体验收确认为依据，不表示浏览器自动化通过。

mybrowser 已在隔离浏览器中打开页面，但元素定位连续失败，因此未自动完成视觉或拖动检查。页面 HTTP 200 以及绑定结构正确，都不能替代上述人工验收。

## 升级与回滚

本机构建后，把 `dist/cli.js` 和 `dist/install.js` 传到 company，在 company 执行：

```bash
~/.bun/bin/bun /path/to/install.js --bundle /path/to/cli.js
```

新版本写入独立目录并原子切换 `current`，保留旧版本作为 `previous`。同版本产物内容不同会拒绝安装，必须增加版本号。安装器不会覆盖无托管标记的现有命令。

已有上一正式版本时：

```bash
~/.bun/bin/bun ~/.local/share/excalidraw-agent-cli/current/install.js --rollback
```

阶段 3 是首次正式安装，当时 `previous` 为空。后续升级会建立 `previous`；实际状态以安装器输出为准。升级/回滚逻辑已在隔离测试目录验证。
