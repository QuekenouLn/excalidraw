# 单元素原子编辑：实际问题与验收

## 实际会话证据

通过 `ssh company` 读取会话 `01a1201d-ba34-77d4-8854-c65528a870ce`。以下时间为会话 UTC 时间，行号为原始 JSONL 行号。

- 第 140 行，10:25:02：用户明确要求只动 Workspace，保留手动样式。
- 第 150–159 行：新增普通 StrategyHelper 卡片后，5 个既有外部箭头标签的 x/y 改变。尝试通过 app-only `save_checkpoint` 恢复失败，返回 `PROTOCOL_ERROR`，不能当成成功。
- 第 166–169 行：改 AskRisk 标签又影响了绑定箭头标签。Agent 随后转用 Markdown Frame，牺牲了普通卡片样式。
- 第 209–252 行：为把 Markdown 换回卡片，重复搜索工具、尝试失败恢复并探索浏览器 React 内部对象；最后仍未保存替换。
- 第 253–264 行，10:46:50–10:49:19：用户再次要求只改一张卡。第 259 行明确输出 5 个无关标签改变，Agent 仍在第 260 行保存了这一结果。

这些调用结果证明范围失控和反复换方案；不能把阶段间隔全算作服务执行时间。那次补策略卡的首次交付从 10:25:02 到 10:31:34 约 6 分 31 秒，最后单卡片替换从 10:46:50 到 10:49:19 约 2 分 29 秒。CLI 调用往往不到一秒。

## 修复

`create_view` 在恢复 checkpoint、转换新元素并合并后，又调用 `convertElementsForStorage` 转换整个场景。完整原生元素分支仍会重新居中绑定文字，因而覆盖用户调整过的箭头标签坐标。移除合并后的全图转换，只转换新增元素。

新增 `edit_scene_element`：

- 按 ID、场景 revision 和元素 version/versionNonce 编辑。
- `changes` 支持节点位置、尺寸、样式和箭头线头；`text` 修改绑定标签。
- `replaceWithCard` 将一个未绑定的 Markdown Frame 转为普通卡片。保留目标 ID、位置、尺寸、分组及层级；可按 `styleFrom` 复制参考卡片样式与字号。
- 默认只允许目标及其绑定文字变化。派生变化超出范围时，失败且不创建 checkpoint；只有显式 `allowedElementIds` 中的额外元素允许变化。
- `apply_scene_operations` 也支持 `allowedElementIds`，可限制批量操作及箭头类型修改的影响范围。
- 返回 affected IDs 和字段 diff。Agent 使用 `select_scene_elements` 按目标查询；不要求把整图放进模型上下文。服务内部仍读取 / 保存完整 checkpoint，尚未实现存储层的单元素 I/O。

CLI 0.4.0 动态发现服务工具，无需更换 CLI 可执行文件。技能改为按 ID 查询、编辑、保存和按 ID 验证；已使用技能安装器更新 company 的 Agent / Claude / OpenGrok 入口。

## 测试与构建

实际修改前的卡片、参考样式卡和 5 条外部箭头及标签提取为 `integrations/excalidraw-mcp/tests/fixtures/company-single-card.json`。没有复制完整会话或业务凭据。

专项协议测试覆盖：实际 Markdown 卡片替换、恢复场景后新增卡片、单线头修改、单标签修改、单节点样式、连线派生影响拒绝与显式授权、批量操作范围、版本冲突、禁止修改受保护字段、文本放不下拒绝。逐字段核对无关元素，范围失败时验证 `saveDerived` 未调用。

- `bun test integrations/excalidraw-mcp/tests`：74 通过，0 失败，609 个断言。
- `yarn test:typecheck`：通过。
- MCP `tsc --project tsconfig.server.json --noEmit`：通过。
- `npm run build`（MCP）：通过，包含前端 / 服务端类型检查、Vite 和 Bun 生产打包。
- `yarn test:update --exclude '.worktrees/**'`：执行完成，但未全绿；147 个测试文件中 23 失败、124 通过，测试计数 21 失败、1904 通过、47 跳过、1 todo，另有 10 个错误。包含根项目 UI / geometry 断言和 Bun 测试被 Vitest 收集的问题；本次没有修复这些失败，不能声称全量通过。该命令改写的无关测试和快照已恢复。

标准 `docker compose build excalidraw-mcp` 卡在重复下载 Yarn 依赖，已停止。使用上述成功的本地生产 dist，按照原 Dockerfile 的生产运行阶段（`node:22-bookworm-slim`，`/app`，`PORT=3001`，`node dist/index.js`）制作镜像，再运行：

```bash
docker compose up -d --no-build --no-deps --force-recreate excalidraw-mcp
```

未启动额外服务或监听端口。代码提交：MCP 子模块 `aaf5778`。发布镜像 ID：`sha256:9b2f7ce6b8f5b92c3d35001ed460f4e5dcaa7b139445c476705170ae2b7d925d`。

## company 命令行验收

使用现有端点，从提取的实际图元素创建独立测试场景，按 ID 选择目标，执行卡片替换和线头更新，保存到新的验收文件，再重新打开并查询目标。

- 卡片影响：`markdown_b0661b773012472cae` 与其新绑定文字，仅这两个 ID。
- 线头影响：`spaced-ortho-web-http`，仅这一个 ID。
- 12 个非目标元素查询投影保持一致；坐标逐字段不变由上述实际数据协议测试验证。
- 验收文件：`single-element-acceptance-20261009T110552.excalidraw`。
- 远程 revision：`c2fc03473acd9f008abd2e3bb44ed90eca7c4a0d037c4897c8d6bc51d2a5e38e`。
- 重新打开 checkpoint：`f0258152772c459890`。
- 原架构图未在本次验收中修改；未做真实画布视觉或拖动验收。
- `docker compose ps excalidraw-mcp`：healthy，现有 `3002:3001` 映射。

company 保留的原始在线结果：`/tmp/excalidraw-single-element-skill/acceptance-result.json`；实时工具 schema：同目录 `live-schema.json`。
