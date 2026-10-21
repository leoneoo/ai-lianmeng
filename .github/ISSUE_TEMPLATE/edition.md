---
name: 投稿一期
about: 提交一期 AI联盟 内容
title: "[edition] "
labels: ["edition"]
---

把空字符串换成真实内容后再提交。`id` 和 `published_at` 必须是同一天的 06:00、12:00、18:00 或 22:00（+08:00）。空字段不会通过校验，Issue 会保持打开并收到错误说明。`impact`、`points`、`tag` 可以整段删掉；旧条目没有它们也能通过校验。

```json
{
  "id": "2026-10-21-2200",
  "published_at": "2026-10-21T22:00:00+08:00",
  "headline": "",
  "sections": {
    "x_daily": [
      {
        "title": "",
        "summary": "",
        "source_url": "",
        "time": "",
        "handle": "@",
        "impact": "对读者意味着什么。不需要时删掉这个字段",
        "points": ["要点一", "要点二"],
        "tag": "自报"
      }
    ],
    "zh_topics": [],
    "oss_agent": [],
    "tech": [],
    "iot": []
  }
}
```
