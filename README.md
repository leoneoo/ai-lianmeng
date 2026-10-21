# AI联盟

免费中文 AI 新闻站，内容整理自 X 上的公开帖子。线上地址：[https://leoneoo.github.io/ai-lianmeng/](https://leoneoo.github.io/ai-lianmeng/)。

每天四期，时间是新加坡（`Asia/Singapore`，全年 UTC+8）：**06:00、12:00、18:00、22:00**。一期必填两个栏目：「AI 日报」「中文博主」。还可以带三个可选栏目：「开源与 Agent 技术」「科技与数码」「万物互联」。`sections.en_topics` 已停用，可以省略；旧期刊里的条目仍会显示在 AI 日报中。站点在没有期刊时只显示空状态，不会放示例新闻。

## 仓库结构

```text
data/index.json                         期刊索引，新的在前
data/2026/10/2026-10-21-2200.json       单期正文，按年/月归档
schema/edition.schema.json              单期 JSON Schema
schema/index.schema.json                索引 JSON Schema
examples/sample-edition.json            校验用示例，不会发布
scripts/ingest.mjs                      从 Issue 收录期刊
scripts/edition.mjs                     校验、落盘、更新索引
scripts/build.mjs                       组装静态站点到 _site/
js/ css/ *.html                         站点本身
.github/workflows/site.yml              收录、测试、部署
.github/ISSUE_TEMPLATE/edition.md       投稿模板
```

每一期单独一个 git 提交，提交说明固定为 `edition: 2026-10-21 22:00`。提交历史就是归档。

## 期刊 JSON

机器可读的约定在 [`schema/edition.schema.json`](schema/edition.schema.json)。摄取脚本按同一套规则校验，并且会拒绝不真实的日期、带账号密码的链接，以及控制字符。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | `YYYY-MM-DD-HHMM`。时段只能是 `0600`、`1200`、`1800`、`2200` |
| `published_at` | 是 | 与 `id` 同一时刻，必须是 `+08:00`，例如 `2026-10-21T22:00:00+08:00` |
| `headline` | 否 | 首页大标题，1 到 120 字。不要传空字符串，不需要就删掉这个字段 |
| `sections.x_daily` | 是 | 「AI 日报」，数组，可以是 `[]`，最多 40 条 |
| `sections.zh_topics` | 是 | 「中文博主」 |
| `sections.en_topics` | 否 | 已停用。可以整段省略。旧条目仍有效，页面并入 `x_daily` 显示 |
| `sections.oss_agent` | 否 | 「开源与 Agent 技术」。导航名为「开源与 Agent」。不需要时省略整个键 |
| `sections.tech` | 否 | 「科技与数码」 |
| `sections.iot` | 否 | 「万物互联」 |

每条记录：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 单行标题，1 到 200 字 |
| `summary` | 是 | 中文摘要，1 到 2000 字 |
| `source_url` | 是 | 原始帖子或文章，仅 `https` |
| `time` | 是 | 来源时间，ISO 8601 且带 `+08:00` |
| `handle` | 否 | X 账号，例如 `@AnthropicAI`。不要带空字符串 |
| `impact` | 否 | 「影响」一句话，1 到 400 字。不需要就删掉这个字段 |
| `points` | 否 | 短要点数组，最多 8 条，每条 1 到 120 字 |
| `tag` | 否 | 短标签，1 到 16 字，例如「传闻」或「自报」 |

`x_daily`、`zh_topics` 两个键都必须出现。`en_topics`、`oss_agent`、`tech`、`iot` 可以整段省略；旧期刊没有可选栏目也能通过校验。不要增加别的字段。文件会写到 `data/年/月/id.json`，例如 `data/2026/10/2026-10-21-2200.json`。索引里的 `counts` 会带上这些栏目的条数；旧索引如果少了可选栏目的计数，按 0 条理解。`counts.en_topics` 仍会写入，页面不单独展示这一栏。

索引 [`data/index.json`](data/index.json) 的结构见 [`schema/index.schema.json`](schema/index.schema.json)。`editions` 按 `published_at` 从新到旧。这个文件由脚本维护。

下面这段是格式示例，标题里带有「示例」，**不要原样投稿**。可运行的副本在 [`examples/sample-edition.json`](examples/sample-edition.json)。

```json
{
  "id": "2026-10-21-2200",
  "published_at": "2026-10-21T22:00:00+08:00",
  "headline": "【示例】仅供校验，不是已发布新闻",
  "sections": {
    "x_daily": [
      {
        "title": "【示例】实验室动态",
        "summary": "这是一条示例摘要，用来确认摄取脚本能写入期刊文件。请勿把本文件当作新闻发布。",
        "source_url": "https://example.com/ai-lianmeng/sample-x",
        "time": "2026-10-21T21:12:00+08:00",
        "handle": "@example",
        "impact": "示例影响：说明这条消息会怎样改变读者的下一步。",
        "points": ["摄取脚本会保留影响、要点和标签", "没有这些字段的旧条目仍然有效"],
        "tag": "自报"
      }
    ],
    "zh_topics": [
      {
        "title": "【示例】中文博主",
        "summary": "示例中文摘要，说明这一栏会展示中文博主。",
        "source_url": "https://example.com/ai-lianmeng/sample-zh",
        "time": "2026-10-21T18:05:00+08:00",
        "handle": "@example_zh"
      }
    ],
    "en_topics": [
      {
        "title": "【示例】并入 AI 日报的旧英文条目",
        "summary": "sections.en_topics 已停用。这条仍能通过校验，并会显示在 AI 日报里。",
        "source_url": "https://example.com/ai-lianmeng/sample-en",
        "time": "2026-10-21T16:40:00+08:00"
      }
    ],
    "oss_agent": [
      {
        "title": "【示例】开源与 Agent 技术",
        "summary": "示例摘要，说明这一栏会展示开源项目和 Agent 技术。",
        "source_url": "https://example.com/ai-lianmeng/sample-oss",
        "time": "2026-10-21T15:20:00+08:00",
        "handle": "@example_oss"
      }
    ],
    "tech": [
      {
        "title": "【示例】科技与数码",
        "summary": "示例摘要，说明这一栏会展示科技与数码选题。",
        "source_url": "https://example.com/ai-lianmeng/sample-tech",
        "time": "2026-10-21T14:05:00+08:00"
      }
    ],
    "iot": [
      {
        "title": "【示例】万物互联",
        "summary": "示例摘要，说明这一栏会展示万物互联选题。",
        "source_url": "https://example.com/ai-lianmeng/sample-iot",
        "time": "2026-10-21T13:40:00+08:00",
        "handle": "@example_iot"
      }
    ]
  }
}
```

## 用 Issue 投稿

外部助手不能推送 git，也不使用令牌。它用仓库所有者的账号开 Issue，工作流再把正文写成归档。

只处理**未关闭**、且作者是**仓库所有者**的 Issue。其他人即使套用同样的标题也会被忽略，也不会收到回复。

标题以 `[edition]` 开头（大小写不敏感）。也可以只打上 `edition` 标签。建议标题写成：

```text
[edition] 2026-10-21 22:00
```

标题只是给人看的。期号以正文 JSON 的 `id` 为准。

正文里放**一个** `json` 代码块，前后可以有说明文字：

````markdown
请收录这一期。

```json
{ "id": "2026-10-21-2200", "published_at": "2026-10-21T22:00:00+08:00", "sections": { "x_daily": [], "zh_topics": [], "oss_agent": [], "tech": [], "iot": [] } }
```
````

仓库里的「投稿一期」模板会放一份空字段草稿。空字段过不了校验。

结果：

- 校验通过：写入对应日期文件，更新 `data/index.json`，单独提交，在 Issue 里留言，然后关闭。
- 内容与归档完全相同：不重复提交，留言后关闭。
- JSON 不合法或不符合 schema：把错误写在 Issue 里，**保持打开**。改完正文再保存，会再检查一次。
- 同一轮最多收录 20 期，其余留到下一次运行。

编辑已打开 Issue 的正文，或重新打开已关闭的 Issue，都会再次触发。

## 工作流

文件：`.github/workflows/site.yml`，名称 **Site**。

| 触发 | 作用 |
| --- | --- |
| `issues`：`opened`、`edited`、`reopened` | 标题以 `[edition]` 开头，或带 `edition` 标签时，立刻收录 |
| `schedule`：`0 22,4,10,14 * * *` | 四个出刊时点再扫一遍仍打开的期刊 Issue，防止当时漏跑 |
| `workflow_dispatch` | 手动再跑。勾选「没有新期刊时也部署网站」可以只重新发布 |
| `push` 到 `main` | 跑测试并部署站点。用来发布页面改动 |
| `pull_request` | 只跑测试和构建，不部署 |

收录任务使用 `GITHUB_TOKEN`，权限是 `contents: write` 和 `issues: write`。部署任务权限是 `contents: read`、`pages: write`、`id-token: write`。

`concurrency` 按工作流分组。`main` 上的收录和部署排队，不中途取消，避免两期同时写 `data/` 或后完成的旧部署盖住新站点。Pull request 的检查互相取消过期的一轮。

用 `GITHUB_TOKEN` 推上去的提交**不会**再触发别的工作流。所以收录成功后，同一次运行里的 deploy 任务会检出刚推上去的那次提交，再构建并部署。不要指望另开一个只监听 `push` 的工作流。

部署用官方动作：`actions/configure-pages@v6`、`actions/upload-pages-artifact@v5`、`actions/deploy-pages@v5`。产物是 `_site/`。

### 新加坡时间与 UTC

新加坡没有夏令时，下面的对照全年有效。GitHub 的 cron 用 UTC，高峰时可能晚几分钟到更久。真正的入口是开 Issue；cron 是补漏。

| 新加坡 | UTC | cron 小时 |
| --- | --- | --- |
| 06:00 | 前一天 22:00 | 22 |
| 12:00 | 04:00 | 4 |
| 18:00 | 10:00 | 10 |
| 22:00 | 14:00 | 14 |

合在一起是 `0 22,4,10,14 * * *`。

## 页面

纯静态。首页读 `data/index.json`，再取最新一期：头条、栏目卡片和侧栏。顶栏是「首页 / AI 日报 / 中文博主 / 开源与 Agent / 科技数码 / 万物互联 / 往期」。栏目页地址是 `index.html?section=`，键名是 `x_daily`、`zh_topics`、`oss_agent`、`tech`、`iot`。`?section=en_topics` 会打开 AI 日报。没有条目的栏目不会在首页铺一块空区域。摘要、要点和影响在栏目页、期刊页和搜索结果里全文显示。单条永久链接是 `edition.html?id=期号#item-栏目-序号`，例如 `edition.html?id=2026-10-21-2200#item-x_daily-0`。宽屏内容区最多约 1440px。顶栏可以搜索标题、摘要、影响、要点、标签和账号，结果地址是 `index.html?q=`。往期页按日期浏览。默认深色，可以切到浅色。

项目页的根路径是 `/ai-lianmeng/`。页面里的样式、脚本和数据都用相对地址，这样本地和 GitHub Pages 都能打开。

## 本地检查

需要 Node.js 22 或更新版本。没有运行时依赖。

```bash
npm test
npm run build
python3 -m http.server -d _site 8080
```

浏览器打开 `http://127.0.0.1:8080/`。要模拟项目页子路径，可以把 `_site` 放到一个叫 `ai-lianmeng` 的目录里再从上一层启动服务。

只校验示例、不写入本仓库：

```bash
node scripts/ingest.mjs --file examples/sample-edition.json --root /tmp/ai-lianmeng-preview
```

## 合并之后要做的事

Issue 定时任务和 `issues` 触发只认默认分支。这个工作流要先进入 `main` 才会开始收期刊。

1. 把本变更合并到 `main`。
2. 打开仓库 **Settings → Pages → Build and deployment**，Source 选 **GitHub Actions**。没打开的话，`configure-pages` 会失败，日志里会说明 Pages 尚未启用。
3. 如果组织把 Actions 的 `GITHUB_TOKEN` 限制成只读，到 **Settings → Actions → General → Workflow permissions** 允许读写。否则期刊提交推不上去。
4. 如果 `main` 有分支保护并且要求评审，需要允许 `github-actions[bot]` 直接推送，否则收录提交会被拒绝。
5. `edition` 标签可选。标题以 `[edition]` 开头就够了。模板里写了这个标签；标签不存在时，GitHub 会忽略它，Issue 仍然可以开。
6. 第一次部署会自动建立名为 `github-pages` 的环境。如果环境要求人工批准，部署会停在那里等批准。

合并并打开 Pages 之后，用所有者账号开一条 `[edition]` Issue，站点就会出现第一期。
