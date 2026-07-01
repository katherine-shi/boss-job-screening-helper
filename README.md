# BOSS 岗位智能筛选助手

一个用于 BOSS 直聘岗位列表页的 Chrome Extension。它可以根据职位名、城市、工作经验、学历、薪资、排除词和简历内容，对岗位进行抓取、评分、AI 匹配判断，并在插件面板中生成可审核的岗位列表。

## 功能

- API 配置：支持 OpenAI 和 DeepSeek，并提供连接测试。
- 页面筛选同步：将职位名、工作地、工作经验、学历要求和薪资范围同步到 BOSS 页面。
- 岗位抓取：滚动加载 BOSS 岗位列表，并收集设定数量的岗位。
- AI 匹配判断：基于简历、偏好和 JD 文本输出匹配分、通过原因、风险点和招呼语。
- 审核确认：集中展示岗位评分结果，支持勾选要继续沟通的岗位。
- 新标签打开 JD：点击岗位后在后台新标签页打开 JD，不覆盖原 BOSS 页面。
- 结果持久化：插件 popup 关闭后，再次打开会恢复上次审核结果和勾选状态。
- 一键打招呼队列：对勾选岗位生成本地打招呼任务，并批量打开对应 JD 页面。

## 安装到 Chrome

1. 下载或 clone 本项目。
2. 打开 Chrome，进入 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本项目根目录，也就是包含 `manifest.json` 的文件夹。
6. 打开 BOSS 直聘岗位列表页，点击浏览器扩展图标开始使用。

## 使用方式

1. 在 BOSS 直聘打开岗位搜索/岗位列表页。
2. 打开插件面板，填写 API Key，并点击“测试连接”。
3. 填写筛选条件：职位名、工作地、经验、学历、薪资、排除词和简历内容。
4. 插件会尝试将筛选条件同步到 BOSS 页面。
5. 点击“抓取并评分”。
6. 在“审核确认”中查看匹配岗位，勾选想继续沟通的岗位。
7. 点击岗位可打开对应 JD；点击“一键打招呼”可生成本地打招呼队列并批量打开 JD。


## 隐私与安全

- API Key 只保存在本机 Chrome `storage.local` 中。
- 请不要把真实 API Key、简历原文或个人敏感信息提交到 GitHub。
- 插件会在启用 AI 判断时，将岗位信息、简历内容和求职偏好发送给你配置的 AI 服务商。
- 当前版本不会自动替你向 HR 发送消息，仍需要用户确认和操作。

## 项目结构

```text
.
├── manifest.json
├── README.md
└── src
    ├── content.css
    ├── content.js
    ├── popup.css
    ├── popup.html
    └── popup.js
```

## 当前限制

- BOSS 页面结构变化可能导致筛选同步或岗位抓取失效。
- 一键打招呼目前是生成任务和打开 JD，不直接自动发送消息。
- AI 判断质量依赖简历内容、JD 文本完整度和模型返回质量。
- 该项目仅用于个人求职效率辅助，请遵守 BOSS 直聘平台规则。

## 开发检查

可以用下面命令检查 JavaScript 和 manifest 是否可解析：

```bash
node --check src/popup.js
node --check src/content.js
python3 -m json.tool manifest.json
```

## License

This project is licensed for personal and other non-commercial use only.
Commercial use is not permitted without prior written permission. See
[`LICENSE`](./LICENSE) for details.
