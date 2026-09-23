# excalidraw-agent-cli：分阶段任务与验收

状态：阶段 0–4 全部完成，用户最终验收通过（“look good”）。

阶段 0 交付：[接口契约 v1](./excalidraw-agent-cli-design.md)。

## 目标与已确认决策

- 命令名：`excalidraw-agent-cli`。
- 使用场景：Coding Agent 在 `company` 上，通过 shell 调用当前机器的 Excalidraw MCP 服务，无须给 Agent 注册 MCP。
- 默认端点：`http://100.64.0.1:3002/mcp`，经 Tailscale 访问；允许用环境变量或显式选项覆盖，正常使用无须配置。
- CLI 自己定义命令与执行契约，使用 MCPorter 运行库处理 MCP 通信；不采用固定工具子命令的 `generate-cli` 路线。
- 从服务端动态发现工具和 schema，透传工具参数及业务结果。兼容性服务更新不要求更新 CLI；破坏性接口变化仍可能要求调整调用或 Skill。
- 安装时携带固定版本的依赖，正常执行不临时下载依赖。
- 原子编辑、字体度量、远程文件与 Markdown Frame 等业务逻辑继续由现有 MCP Server 提供。
- 设计依据：[面向 Agent 的 CLI 设计研究](../../../notes/research/agent-native-cli-design.md)。该链接相对于本文所在目录。

已验证：从 `company` 可完成 MCP 握手、发现 18 个工具，并通过 MCPorter 0.13.13 调用 `read_me`。尚未验证 MCPorter 运行库集成、专用 CLI 打包和完整编辑闭环。

## 验收协作方式

每阶段：实现及自动检查 → 报告结果和限制 → 提供用户复现命令 → 用户实际验收 → 记录结论 → 下一阶段。

- 每次只提交当前阶段的验收请求，不要求用户同时验收后续阶段。
- 用户验收状态由用户确认后更新，自动检查通过不等于用户验收通过。
- 写入类验收使用新建且明确标识的测试文件，记录文件名和 revision/checkpoint，不修改现有图表。
- 失败时留在当前阶段修复；不通过增加功能绕开验收问题。
- 不自动发布包、推送提交或删除验收文件。

## 阶段 0：确定接口契约与代码归属

交付：简短接口设计文档及样例输入/输出；决定 CLI 存放位置和打包方式。

- [x] 检查主仓库、MCP 子模块的包管理和构建约束，确定 CLI 目录，避免默认把定制客户端混入上游子模块。
- [x] 验证 MCPorter 运行库的工具发现、调用、原始结果及连接释放 API，确定固定依赖版本。
- [x] 定义 `tools`、`describe <tool>`、`call <tool>`、`--help`、`--version`。
- [x] 定义 `--input <file>` / `--input -`，缺输入、冲突参数和未知 CLI 选项的处理方式。
- [x] 定义默认端点、覆盖优先级、超时，以及 HTTP 地址的处理方式。
- [x] 定义 JSON 输出契约、业务结果保留方式、错误码、进程退出码；区分 MCP `isError`、协议错误和网络错误。
- [x] 明确写请求发送后超时的结果未知状态；默认不自动重试工具调用。
- [x] 定义输出大小策略与 `--output-file` 行为，禁止静默截断和无意覆盖文件。
- [x] 确定首次发现失败、schema 缓存及刷新策略；不承诺缺失的 schema 版本字段。
- [x] 确定 Bun/Node 或独立可执行文件交付方案，核对 `company` 的实际运行环境。

验收材料：命令表、成功/参数错误/工具错误/结果未知四类 JSON 样例、安装使用说明草案。

用户验收：命令是否直观；是否满足安装后直接使用；输出是否足以指导下一步。

- [x] 自动调研与接口评审完成
- [x] 用户验收通过

## 阶段 1：只读发现与最小 CLI

交付：可运行的 CLI，实现帮助、版本、工具列表、单工具描述和连接诊断。

- [x] 建立独立 CLI 包与可执行入口，接入固定版本 MCPorter 运行库。
- [x] 实现默认端点和显式覆盖，无须 Agent MCP 配置。
- [x] `tools` 默认返回简短工具目录，不展开所有 schema。
- [x] `describe <tool>` 返回服务端当前定义，工具不存在时返回可识别错误。
- [x] stdout 输出 JSON；stderr 用于诊断，输出不包含启动横幅或依赖下载日志。
- [x] 设置有限连接超时，确保关闭 stdin 或无 TTY 时不等待交互。
- [x] 验证资源释放，命令执行完成后正常退出。
- [x] 用隔离的模拟服务验证新增工具可被发现，无需修改 CLI。

用户复现命令：

```bash
excalidraw-agent-cli --help
excalidraw-agent-cli --version
excalidraw-agent-cli tools
excalidraw-agent-cli describe apply_scene_operations
excalidraw-agent-cli describe tool_that_does_not_exist
```

验收：能读取现有远程工具和 schema；不存在的工具有稳定错误和非零退出码；没有交互等待。

实现位置：`integrations/excalidraw-agent-cli/`。9 项子进程/HTTP fixture 测试、59 个断言通过，类型检查和构建通过；本机及 company 的 tools/describe 实测通过。

company 临时验收（尚未正式安装）：

```bash
ssh company
~/.bun/bin/bun /tmp/excalidraw-agent-cli-stage1.QqKVO8/cli.js --help
~/.bun/bin/bun /tmp/excalidraw-agent-cli-stage1.QqKVO8/cli.js tools
~/.bun/bin/bun /tmp/excalidraw-agent-cli-stage1.QqKVO8/cli.js describe apply_scene_operations
~/.bun/bin/bun /tmp/excalidraw-agent-cli-stage1.QqKVO8/cli.js describe tool_that_does_not_exist
echo $? # 预期 3
```

阶段 1 交付时未实现 `call`、`--output-file` 和自动大结果落文件；这些能力已在阶段 2 实现。上面的临时入口保留阶段 1 构建。

- [x] 自动检查通过
- [x] 用户验收通过（用户：继续吧）

## 阶段 2：通用调用与可靠结果

交付：`call`、文件/stdin 输入、结构化结果、结果写文件及稳定错误行为。

- [x] 实现 JSON 文件和 stdin 输入；格式错误给出明确位置或原因。
- [x] 根据服务端 schema 确定本地校验范围，保留开放字段；不能擅自拒绝 schema 允许的扩展属性。
- [x] 实现动态 `tools/call`，保留业务字段和 MCP 内容块，不丢弃图像或资源引用信息。
- [x] 将 MCP `isError: true` 映射为失败状态和非零退出码，即使 HTTP 状态为 200。
- [x] 实现 `--output-file`，大结果落文件后 stdout 返回路径和必要元数据。
- [x] 明确区分本地未发送、服务端已返回、已发送但结果未知；不把通信超时解释为未执行。
- [x] 验证非法 JSON、缺参数、服务不可达、工具失败和超时行为。
- [x] 模拟写入成功但响应丢失，确认 CLI 不自动重发工具调用。
- [x] 模拟服务端新增工具及可选参数，确认通用调用无需更新 CLI。

用户验收：调用 `read_me`；从文件和 stdin 调用只读工具；分别检查非法输入和输出文件。不在此阶段对真实图表写入。

检查结果：22 项子进程/HTTP fixture 测试、131 个断言通过；类型检查和构建通过。模拟响应丢失、HTTP 503、输出文件竞争均确认只调用工具一次；远端新增工具/参数无需重新构建。company 上 read_me 文件输出、list_remote_files 的文件/stdin 输入和非法输入检查通过。

company 临时验收（CLI 0.2.0，尚未正式安装）：

```bash
ssh company
excalidraw-agent-cli() {
  ~/.bun/bin/bun /tmp/excalidraw-agent-cli-stage2.d2EqWf/cli.js "$@"
}
excalidraw-agent-cli --version
excalidraw-agent-cli call list_remote_files --input /tmp/excalidraw-agent-cli-stage2.d2EqWf/args.json
printf '%s\n' '{}' | excalidraw-agent-cli call list_remote_files --input -
# 目录每次新建，避免重跑验收时撞到已存在的输出文件
cli_review_dir=$(mktemp -d /tmp/excalidraw-cli-review.XXXXXX)
excalidraw-agent-cli call read_me --output-file "$cli_review_dir/reference.json"
# 预期 INVALID_INPUT，execution=not_attempted，退出码 2
printf '%s\n' '[]' | excalidraw-agent-cli call read_me --input -
echo $?
```

说明：结果文件存储在运行 CLI 的 company 上，不是远端图表保存动作。截止时间覆盖输入、连接、发现和工具调用；已取得结果后的本地落盘独立完成，以保留执行结果。

- [x] 自动检查通过
- [x] 用户验收通过（用户：go next）

## 阶段 3：在 company 安装并验证图表闭环

交付：可重复安装的 CLI，在 `company` 上执行一次隔离的真实编辑任务。

- [x] 打包 CLI 及依赖；验证日常运行不会在线拉取 npm 包。
- [x] 安装到 `company` 用户命令目录，验证交互 shell 和非交互 shell 均能找到命令；实际 Agent 工作流在阶段 4 验证。
- [x] 验证无需修改 OpenGrok、Claude Code 或其他 Agent 的 MCP 配置即可运行。
- [x] 明确 CLI 版本、默认端点、升级和回滚方法。
- [x] 通过 CLI 创建独立验收图表，包含中文标签和绑定箭头。
- [x] 保存并重新打开验收文件，核对标识与场景内容。
- [x] 执行原子编辑，重新读取验证元素、绑定、checkpoint/revision 和警告。
- [x] 创建、读取、更新 Markdown Frame，验证持久化结果。
- [x] 验证服务端 revision 冲突等实际错误能被 CLI 正确呈现。
- [x] 提供验收图表的访问方式，由用户在现有 Excalidraw 页面检查中文布局、绑定和 Markdown 显示。

验收：用户从 `ssh company` 直接执行 CLI，完成“发现 → 打开/创建 → 编辑 → 保存 → 重新读取”的闭环；无需启动本地 MCP 子进程。

说明：CLI 的 MCP 调用不会自动渲染 MCP App 画布。视觉验收沿用现有浏览器入口；独立导出图片不作为本阶段隐含承诺。

阶段 3 交付：[安装与图表验收记录](./excalidraw-agent-cli-stage3-acceptance.md)。CLI 0.3.0 已安装，25 项测试、149 个断言通过；新建文件 `cli-stage3-acceptance-d99d0c74.excalidraw`，保存、原子标签编辑、Markdown 更新、重读和旧 revision 拒绝均验证通过。

视觉边界：mybrowser 打开实际页面成功，但元素定位失败，未完成自动视觉/拖动验证；该部分后来由用户确认验收通过。当前原子编辑 schema 不提供移动节点操作，未用原始字段赋值冒充交互绑定测试。

- [x] 自动与真实服务检查通过
- [x] 用户验收通过（用户：is ok. can next）

## 阶段 4：Skill 与 Agent 端到端验收

交付：面向 CLI 的 Skill、简短安装文档和验收记录。

- [x] 检查现有 Excalidraw Skill，确定改造或新增方式，避免留下两份冲突的默认调用指导。
- [x] Skill 说明使用条件、最小流程、检查警告、持久化和视觉检查步骤。
- [x] 参数事实由 `describe` 提供，Skill 不复制全部工具 schema。
- [x] 写明 revision 冲突及结果未知时的恢复方法，不盲目重试保存或创建。
- [x] 验证 CLI 调用路径不依赖 Agent 的原生 MCP 注册；保留现有配置，不先删除可用入口。
- [x] 使用 `company` 上的 Coding Agent，仅按 Skill + CLI 完成指定图表任务。
- [x] 记录任务完成情况、错误恢复、调用次数、输出体积和耗时，不声称未经对照实验验证的性能优势。
- [x] 整理安装、升级、回滚及已知限制；按仓库要求完成最终检查。

实际验收任务：“创建包含中文标签的三节点流程图和 Markdown，保存并重开；原子修改节点标签及 Markdown 状态，再保存、重新打开并验证绑定。”当前服务不支持移动节点的原子操作，因此不虚构该能力；画布拖动已在阶段 3 由用户验收。

阶段 4 交付：[Skill 与 Agent 验收记录](./excalidraw-agent-cli-stage4-acceptance.md)。CLI 0.4.0 和统一 Skill 已安装到 company；隔离 HOME 中确认原生 MCP 注册为 0，实际 OpenGrok 只使用终端/文件读取完成图表闭环。首轮达到 35 轮测试上限后，同会话续接 3 轮只完成报告，没有重复远程写入。独立复核持久化、中文标签、Markdown 和双端绑定通过；27 项测试、167 个断言通过。

- [x] Agent 端到端检查通过
- [x] 用户最终验收通过（用户在 `~/coding/risk` 试用后确认 “look good”）

## 不纳入第一版

- 不重写 MCP 服务端业务逻辑，不为每个工具维护专属子命令。
- 不实现没有服务端保障的幂等键、事务或业务 dry-run。
- 不自动重试可能产生副作用的工具调用。
- 不新增账户系统、管理界面、自动更新守护进程或复杂插件框架。
- 不把“兼容性更新通常无需更新 CLI”表述为任何服务端变化都无需适配。

## 验收记录

| 阶段 | 自动检查 | 用户结论 | 版本/日期/备注 |
|---|---|---|---|
| 0 接口契约 | SDK 调用与 Bun 单文件打包探针通过；本机及 company 均验证 | 已通过（用户：ok. go next） | MCPorter 0.13.13 / Bun 1.3.14；见接口契约 |
| 1 只读发现 | 类型检查、构建、9 项测试及两台机器真实服务发现通过 | 已通过（用户：继续吧） | CLI 0.1.0；company 临时验收入口见上 |
| 2 通用调用 | 类型检查、构建、22 项测试及 company 只读调用通过 | 已通过（用户：go next） | CLI 0.2.0；含响应丢失与输出竞争故障测试 |
| 3 company 与图表闭环 | 25 项测试；正式安装、远程写入/重读和冲突检查通过 | 已通过（用户：is ok. can next） | CLI 0.3.0；详见阶段 3 验收记录 |
| 4 Skill 与 Agent | 27 项测试；无原生 MCP 注册的实际 Agent 闭环与独立复核通过 | 已通过（用户：look good） | CLI 0.4.0；用户试用记录见阶段 4 验收文档 |
