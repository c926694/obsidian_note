# B站材料包

这是一个 B站内容的长期材料包。知识库笔记适合快速阅读；这里保存完整正文/字幕、图片、评论、元数据和证据索引，方便以后追问、核对原文或重新生成笔记。

## 先看哪里

- 想通读原文：图文打开 `indexes/图文全集.md`，视频打开 `indexes/字幕全集.md`。
- 想核对某个观点：查 `indexes/证据索引.jsonl`，里面包含图文/字幕证据和评论证据。
- 想看评论区：打开 `comments/评论全集.md`。
- 想判断笔记是否写得过短或过长：看 `metadata/note_budget.json` 和 `metadata/note_score.json`。
- 想让工具检索或问答：优先使用 `indexes/*.jsonl`。

## 本次覆盖

- 字幕：未归档字幕（no subtitle manifest found）。
- 评论：已归档 8 条评论/回复，其中主评论 7 条，子回复 1 条，生成 8 个评论证据块；B站接口显示约 8 条。
- 元数据：已归档：metadata.json, source.md, run_summary.json, subtitle_probe.json；缺少：opus_raw.json, opus_normalized.json。
- 笔记预算：推荐笔记长度 1,360-1,972 字；互动质量倍率 1.133（播放 3,378，点赞 115，收藏 65，投币 81，评论 8，弹幕 6，分享 10；发布于 2022-07-13，距今 1,537 天）。以核心观点、证据和少量实践建议为主，避免过度扩写。

## 文件说明

- `articles/图文全文.md`：图文正文的 Markdown 版本。
- `articles/图文全文.txt`：图文正文纯文本。
- `images/`：图文图片和图片清单。
- `indexes/图文全集.md`：合并后的完整图文正文。
- `indexes/图文全集.jsonl`：逐图文内容块索引，适合检索和问答。
- `indexes/图文证据索引.md`：按文章结构合并的图文证据块，适合人工核对。
- `indexes/图文证据索引.jsonl`：图文证据块的机器可读版本。
- `subtitles/txt/`：每个分P的纯文本字幕。
- `subtitles/srt/`：每个分P的 SRT 字幕，带时间轴，适合回看定位。
- `subtitles/json/`：B站字幕原始 JSON，适合程序复用。
- `comments/comments_raw.json`：完整评论原始结构。
- `comments/评论全集.md`：适合人工阅读的完整评论。
- `indexes/字幕全集.md`：合并后的完整字幕。
- `indexes/字幕全集.jsonl`：逐字幕片段索引，适合检索和问答。
- `indexes/字幕证据索引.md`：按时间段合并的字幕证据块，适合人工核对。
- `indexes/字幕证据索引.jsonl`：字幕证据块的机器可读版本。
- `indexes/评论全集.jsonl`：逐评论/回复索引。
- `indexes/评论证据索引.jsonl`：评论证据块。
- `indexes/证据索引.jsonl`：图文/字幕证据和评论证据的合并索引。
- `metadata/metadata.json`：B站内容元数据，包括标题、UP、发布时间和互动数据。
- `metadata/note_budget.json`：根据正文/字幕量、证据量和互动质量生成的推荐笔记长度。
- `metadata/note_score.json`：最终笔记与推荐长度的对比结果；如果还没有生成，可忽略。

## 推荐用法

1. 先读知识库里的最终笔记，快速了解结论。
2. 对某个判断不放心时，用笔记里的 `O图文证据ID`、`Pxx@时间段` 或 `C评论ID` 回到 `indexes/证据索引.jsonl` 查原文。
3. 需要更细的追问时，把 `indexes/图文全集.jsonl`、`indexes/字幕全集.jsonl` 和 `indexes/评论全集.jsonl` 当作问答材料。
4. 重新写笔记前先看 `metadata/note_budget.json`：长视频、长图文、高互动内容应该保留更多结构和证据，短内容则避免过度扩写。
