# 图表任务工作流

先 `describe` 本次要用的工具。本文记录流程和易错点，不复制完整 schema。

## 创建、保存、重新打开

1. `list_remote_files` 查重，选择明确的 `.excalidraw` 文件名。验收使用新文件，不改已有工作图。
2. 本次首次调用 `create_view` 前读取 `read_me`，遵守当次字体、元素和绑定说明。
3. 规划少量节点和稳定唯一 ID。容器优先用 `label` 简写；箭头使用双端 binding，由服务端建立反向引用。
4. 创建请求通常含 `elements` 字段，它是 **JSON 数组的字符串**，不是数组本身。根请求仍是 JSON object。使用代码序列化两层 JSON，避免手工转义。
5. `create_view` 后记录 checkpoint 和 warnings。警告应检查，不把保存成功当作布局成功。
6. `save_remote_file` 新建文件，记录返回的远程 revision。
7. `open_remote_file` 重新打开，确认 revision、元素和正文。之后基于重新打开的 checkpoint 工作。

例如仅演示请求的编码方式（元素内容要根据 `read_me` 生成）：

```python
import json
from pathlib import Path
request = {"elements": json.dumps(elements, ensure_ascii=False)}
Path("create-request.json").write_text(json.dumps(request, ensure_ascii=False))
```

然后通过 `excalidraw-agent-cli call create_view --input create-request.json` 执行业务请求。此脚本不创建或修改 `.excalidraw` 文件。

## 原子编辑

1. 在当前 checkpoint 上调用 `query_scene_graph`（或相应选择工具）。
2. 使用返回的 **场景 revision** 作为原子编辑的 `expectedRevision`，不是远程文件 revision。
3. 节点/边预期值应从当前查询读取 `id`、`version`、`versionNonce`，不能凭记忆填写。
4. `apply_scene_operations` 成功后记录新 checkpoint/revision，检查直接变更和派生 diff。
5. 再查询，确认标签、连线方向、两端 binding 及反向引用。必要时 `read_checkpoint` 核对几何字段。
6. 用文件的最新 **远程 revision** 保存，再次打开核对。

原子工具缺少移动节点操作时，不直接改 x/y 来声称验证了原生拖动绑定。当前实现可以改标签并检查服务端几何刷新；画布用户负责实际拖动验收。

## Markdown Frame

1. `create_markdown_frame` 可以追加到当前 checkpoint；创建后读取实际返回形状。当前服务返回 `frame.id` 和 `frame.elementVersion`，不是顶层 `frameId`。
2. 编辑前 `get_markdown_frame`，取当前 frame 版本；请求字段名称以 `describe update_markdown_frame` 为准。
3. 小范围唯一文本变更使用 `find_replace`，新章节使用 `append`，整体替换才用 `replace`。
4. 成功后保存新 checkpoint 和 frame 版本，再读取确认正文；需要长期保存时仍调用 `save_remote_file`。
5. 不直接构造 HTML、`iframe.customData` 或修改远程存储文件。不要承诺完整 GFM、复杂表格或任意 HTML 支持。

## 冲突与未知结果

- 文件 revision 冲突：重新 `open_remote_file`，合并/重放意图，用新 revision 保存。
- 元素版本冲突：重新查场景/Markdown，再重放最小操作。
- 保存超时：先 list/open 检查 revision 和实际内容，不能假定未保存，也不要马上再次创建。
- 查询得到内容尚未改变，仍不一定证明超时的写操作已经终止；无法确定时报告状态未知。
- 检查点过期：从持久化文件重新打开，不靠旧 ID 重画整个图。
- `resultFile` 指向本地完整调用结果，可读取 JSON；不要为获取结果重复副作用。

## 交付检查

至少核对：保存返回 revision、重新打开内容一致、两端绑定存在、Markdown 版本和正文匹配、warnings 已处理或报告。视觉和拖动未检查则标明未检查。

保存本次账本即可，不需要输出整份场景或完整工具 schema。报告中明确区分 checkpoint、场景 revision 和远程文件 revision，避免用户用错值继续编辑。
