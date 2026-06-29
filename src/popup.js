const AI_PROMPT_TEMPLATE = `你是一个谨慎的求职岗位匹配审核助手。请根据候选人的简历、求职偏好和岗位信息，判断这个岗位是否值得优先查看或投递。

输入格式固定为：
<resume>候选人简历全文</resume>
<preferences>城市/薪资/经验年限/排除词等偏好</preferences>
<job_description>岗位 JD 全文</job_description>

请只输出 JSON，不要输出 Markdown。JSON 格式如下：
{
  "score": 0-100,
  "decision": "strong_match" | "possible_match" | "weak_match",
  "reasons": ["最多3条匹配原因"],
  "risks": ["最多3条风险或不匹配点"],
  "suggested_greeting": "如果值得投递，给 HR 的一句简短招呼；否则为空字符串"
}

评分标准：
- 90-100：岗位要求、城市、经验、薪资和简历经历高度匹配
- 75-89：整体匹配，有少量需要人工确认的点
- 60-74：可能匹配，但需要认真看 JD
- 0-59：不建议优先投递

判断要求：
- 不要因为岗位标题相似就给高分，必须看 JD 文本和简历经历
- 城市、薪资、经验是硬性偏好，明显不符要扣分
- 排除词命中时必须明显扣分
- 如果岗位文本太少，要降低置信度并写入 risks
- reasons 和 risks 每条必须引用简历或 JD 中的具体信息，例如技能名、项目名、年限、薪资、城市、学历、行业或数字，禁止空泛表述
- 正确示例："候选人有 3 年 Python 数据分析经验，JD 要求 2 年以上"
- 错误示例："候选人经验与岗位匹配"
- 招呼语必须符合“我叫XXX，熟悉XXX，做过XXX，和这个岗位需求的能力相匹配，期望进一步沟通”的结构
- 招呼语必须优先引用简历里的真实技能、项目或行业经验，不要编造`;

const formIds = [
  "jobKeywords",
  "city",
  "salaryRange",
  "minScore",
  "experience",
  "education",
  "collectLimit",
  "blockedKeywords",
  "resumeText",
  "candidateName",
  "aiProvider",
  "apiKey",
  "aiModel",
  "useAi"
];

const defaults = {
  jobKeywords: "",
  city: "",
  salaryRange: "",
  minScore: "60",
  experience: "",
  education: "",
  collectLimit: "30",
  blockedKeywords: "",
  resumeText: "",
  candidateName: "",
  aiProvider: "openai",
  apiKey: "",
  aiModel: "gpt-4o-mini",
  useAi: false
};

const resultSensitiveFields = [
  "jobKeywords",
  "city",
  "salaryRange",
  "minScore",
  "experience",
  "education",
  "collectLimit",
  "blockedKeywords",
  "resumeText"
];

const els = Object.fromEntries(formIds.map((id) => [id, document.getElementById(id)]));
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const messageEl = document.getElementById("message");
const matchesEl = document.getElementById("matches");
const matchListEl = document.getElementById("matchList");
const greetingFlowEl = document.getElementById("greetingFlow");

let lastJobs = [];
let lastSummary = null;
let selectedJobIdSet = new Set();
let applicationLog = {};
let searchSyncTimer = null;
let isComposingSearch = false;

function getSettings() {
  const settings = Object.fromEntries(
    formIds.map((id) => {
      const el = els[id];
      return [id, el.type === "checkbox" ? el.checked : el.value.trim()];
    })
  );
  settings.minSalary = salaryRangeToMin(settings.salaryRange);
  return settings;
}

function salaryRangeToMin(value) {
  const map = {
    "3K以下": 0,
    "3-5K": 3,
    "5-10K": 5,
    "10-20K": 10,
    "20-50K": 20,
    "50K以上": 50
  };
  return map[value] || "";
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setMessage(text = "", tone = "error") {
  messageEl.textContent = text;
  messageEl.dataset.tone = tone;
  messageEl.hidden = !text;
}

function aiConfig(settings) {
  if (settings.aiProvider === "deepseek") {
    return {
      baseUrl: "https://api.deepseek.com",
      model: settings.aiModel || "deepseek-chat",
      label: "DeepSeek"
    };
  }
  return {
    baseUrl: "https://api.openai.com/v1",
    model: settings.aiModel || "gpt-4o-mini",
    label: "OpenAI"
  };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error("没有找到当前标签页。");
  }

  if (!tab.url || !tab.url.includes("zhipin.com")) {
    throw new Error("请先打开 BOSS 直聘页面。");
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    const text = String(error?.message || "");
    if (!text.includes("Receiving end does not exist") && !text.includes("Could not establish connection")) {
      throw error;
    }
    await injectContentScript(tab.id);
    await wait(350);
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

async function injectContentScript(tabId) {
  if (!chrome.scripting?.executeScript) {
    throw new Error("当前扩展缺少 scripting 权限，请重新加载扩展后刷新 BOSS 页面。");
  }
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["src/content.css"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content.js"]
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveSettings() {
  await chrome.storage.local.set({ bossFilterSettings: getSettings() });
}

async function restoreSettings() {
  const { bossFilterSettings, bossApplicationLog, bossLastReview } = await chrome.storage.local.get([
    "bossFilterSettings",
    "bossApplicationLog",
    "bossLastReview"
  ]);
  const settings = { ...defaults, ...(bossFilterSettings || {}) };
  applicationLog = bossApplicationLog || {};
  for (const id of formIds) {
    if (!els[id]) continue;
    if (els[id].type === "checkbox") {
      els[id].checked = Boolean(settings[id]);
    } else {
      els[id].value = settings[id] ?? defaults[id];
    }
  }
  renderLogStats();
  if (bossLastReview?.jobs?.length) {
    lastJobs = bossLastReview.jobs;
    lastSummary = bossLastReview.summary || summarizeJobs(lastJobs, settings);
    selectedJobIdSet = Array.isArray(bossLastReview.selectedJobIds)
      ? new Set(bossLastReview.selectedJobIds)
      : new Set(lastJobs.filter((job) => Number(job.finalScore ?? job.score ?? 0) >= Number(settings.minScore || 60)).map((job) => job.id));
    renderSummary(lastSummary);
    renderMatches(lastJobs, settings);
    setStatus("已恢复");
    setMessage(`已恢复上次审核结果：${lastJobs.length} 个岗位。`, "info");
  }
}

function renderSummary(result) {
  summaryEl.hidden = false;
  document.getElementById("totalCount").textContent = result.total ?? 0;
  document.getElementById("matchCount").textContent = result.matches ?? 0;
  document.getElementById("avgScore").textContent = result.averageScore ?? 0;
}

function normalizeAiResult(value) {
  const score = Number(value?.score);
  return {
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    decision: value?.decision || "possible_match",
    reasons: Array.isArray(value?.reasons) ? value.reasons.slice(0, 3) : [],
    risks: Array.isArray(value?.risks) ? value.risks.slice(0, 3) : [],
    suggestedGreeting: value?.suggested_greeting || ""
  };
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI 没有返回 JSON。");
    return JSON.parse(match[0]);
  }
}

function buildAiMessages(settings, job) {
  const preferences = [
    `候选人姓名：${settings.candidateName || "未填写"}`,
    `岗位关键词：${settings.jobKeywords || "不限"}`,
    `城市：${settings.city || "不限"}`,
    `薪资范围：${settings.salaryRange || "不限"}`,
    `经验年限：${settings.experience || "不限"}`,
    `学历要求：${settings.education || "不限"}`,
    `排除词：${settings.blockedKeywords || "无"}`
  ].join("\n");
  const jobDescription = [
    `岗位名称：${job.title || "未知"}`,
    `公司：${job.company || "未知"}`,
    `薪资：${job.salary || "未知"}`,
    `经验：${job.experience || "未知"}`,
    `标签：${job.tags || "无"}`,
    `JD文本：${job.text || "无"}`
  ].join("\n");

  return [
    {
      role: "system",
      content: AI_PROMPT_TEMPLATE
    },
    {
      role: "user",
      content: `<resume>\n${settings.resumeText || ""}\n</resume>\n\n<preferences>\n${preferences}\n</preferences>\n\n<job_description>\n${jobDescription}\n</job_description>`
    }
  ];
}

async function scoreWithAi(settings, job) {
  const config = aiConfig(settings);
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: buildAiMessages(settings, job),
      temperature: 0.1,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI 调用失败：${response.status} ${detail.slice(0, 120)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return normalizeAiResult(extractJson(content));
}

async function testAiConnection(settings) {
  if (!settings.apiKey) throw new Error("请先填写 API Key。");
  const config = aiConfig(settings);
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: "只输出 JSON。" },
        { role: "user", content: "请返回 {\"ok\":true}" }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`连接失败：${response.status} ${detail.slice(0, 160)}`);
  }
  return response.json();
}

async function enrichWithAi(settings, jobs) {
  if (!settings.useAi) return jobs;
  if (!settings.apiKey) throw new Error("启用 AI 前请先填写 API Key。");
  if (!settings.resumeText) throw new Error("启用 AI 前请先粘贴简历内容。");

  const config = aiConfig(settings);
  const enriched = [];
  for (let index = 0; index < jobs.length; index += 1) {
    setStatus(`${config.label} ${index + 1}/${jobs.length}`);
    const job = jobs[index];
    const ai = await scoreWithAi(settings, job);
    enriched.push({
      ...job,
      finalScore: ai.score,
      scoreSource: config.label,
      ai
    });
  }
  return enriched;
}

function summarizeJobs(jobs, settings) {
  const minScore = Number(settings.minScore || 60);
  const scores = jobs.map((job) => Number(job.finalScore ?? job.score ?? 0));
  const matches = scores.filter((score) => score >= minScore).length;
  const averageScore = scores.length
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : 0;
  return {
    total: jobs.length,
    matches,
    averageScore
  };
}

function renderMatches(jobs, settings) {
  const minScore = Number(settings.minScore || 60);
  const sortedJobs = [...jobs].sort((a, b) => Number(b.finalScore ?? b.score ?? 0) - Number(a.finalScore ?? a.score ?? 0));

  matchesEl.hidden = sortedJobs.length === 0;
  greetingFlowEl.hidden = sortedJobs.length === 0;
  matchListEl.innerHTML = "";

  for (const job of sortedJobs) {
    const score = Number(job.finalScore ?? job.score ?? 0);
    const isMatch = score >= minScore;
    const source = job.scoreSource || "规则";
    const reasons = job.ai?.reasons?.length ? job.ai.reasons : job.reasons;
    const risks = job.ai?.risks?.length ? job.ai.risks : job.risks;
    const primaryNotes = isMatch
      ? (reasons?.length ? reasons : risks?.map((risk) => `需确认：${risk}`))
      : (risks?.length ? risks.map((risk) => `不通过原因：${risk}`) : reasons?.map((reason) => `仅供参考：${reason}`));
    const greeting = greetingForJob(job, reasons);
    const status = applicationLog[job.id]?.status || "待确认";
    const isChecked = selectedJobIdSet.has(job.id);
    const item = document.createElement("article");
    item.className = `match-item${isMatch ? "" : " skip"}`;
    item.tabIndex = 0;
    item.dataset.jobId = job.id;
    item.innerHTML = `
      <input type="checkbox" aria-label="选择岗位" ${isChecked ? "checked" : ""} />
      <div>
        <div class="match-title">${escapeHtml(job.title || "未识别岗位名")}</div>
        <div class="match-meta">${escapeHtml([job.salary, job.company, job.experience].filter(Boolean).join(" · "))}</div>
        <div class="match-reason">${escapeHtml((primaryNotes || ["信息较少，建议人工查看"]).slice(0, 3).join("；"))}</div>
        ${isMatch ? `<div class="match-greeting">${escapeHtml(greeting)}</div>` : ""}
        ${isMatch ? `<div class="match-tools">
          <button type="button" class="secondary" data-action="copy-greeting">复制招呼语</button>
          <span class="match-status">状态：${escapeHtml(status)}</span>
        </div>` : ""}
      </div>
      <div class="match-score">${score}<span>${escapeHtml(source)} · ${isMatch ? "匹配" : "跳过"}</span></div>
    `;
    item.addEventListener("click", (event) => {
      if (event.target?.tagName === "INPUT") {
        updateSelectedFromDom();
        persistReviewState();
        return;
      }
      if (event.target?.dataset?.action === "copy-greeting") {
        navigator.clipboard.writeText(greeting);
        setMessage("招呼语已复制。按流程：先手动发送图片，再发送招呼语。", "info");
        return;
      }
      openJob(job);
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openJob(job);
    });
    matchListEl.appendChild(item);
  }
  renderLogStats();
}

function updateSelectedFromDom() {
  selectedJobIdSet = new Set(selectedJobIds());
}

async function persistReviewState() {
  if (!lastJobs.length) return;
  await chrome.storage.local.set({
    bossLastReview: {
      jobs: lastJobs,
      summary: lastSummary || summarizeJobs(lastJobs, getSettings()),
      selectedJobIds: [...selectedJobIdSet],
      savedAt: new Date().toISOString()
    }
  });
}

async function resetResults(message = "搜索结果已重置。") {
  lastJobs = [];
  lastSummary = null;
  selectedJobIdSet = new Set();
  summaryEl.hidden = true;
  matchesEl.hidden = true;
  greetingFlowEl.hidden = true;
  matchListEl.innerHTML = "";
  await chrome.storage.local.remove(["bossLastReview", "bossGreetingQueue"]);
  setStatus("待筛选");
  setMessage(message, "info");
}

async function clearStaleResultsOnCriteriaChange() {
  if (!lastJobs.length) return;
  await resetResults("筛选条件已变化，已清空上一次搜索结果。");
}

function greetingForJob(job, reasons = []) {
  if (job.ai?.suggestedGreeting) return job.ai.suggestedGreeting;
  const settings = getSettings();
  const name = settings.candidateName || "XXX";
  const reasonText = (reasons || []).join("，");
  const skills = reasonText.match(/(?:岗位关键词|简历关键词)：([^，；]+)/)?.[1] || job.title || "相关方向";
  const projectHint = job.company ? `${job.company}相关岗位要求` : "相关项目和业务需求";
  return `您好，我叫${name}，熟悉${skills}，做过${projectHint}相关工作，和这个岗位需求的能力相匹配，期望进一步沟通。`;
}

function selectedJobIds() {
  return [...matchListEl.querySelectorAll(".match-item")]
    .filter((item) => item.querySelector("input[type='checkbox']")?.checked)
    .map((item) => item.dataset.jobId);
}

async function updateApplicationStatus(status) {
  const ids = selectedJobIds();
  if (ids.length === 0) {
    setMessage("请先勾选要记录的岗位。", "info");
    return;
  }
  for (const id of ids) {
    applicationLog[id] = {
      status,
      updatedAt: new Date().toISOString()
    };
  }
  await chrome.storage.local.set({ bossApplicationLog: applicationLog });
  renderMatches(lastJobs, getSettings());
  setMessage(`已记录 ${ids.length} 个岗位为：${status}。`, "info");
}

function renderLogStats() {
  const values = Object.values(applicationLog);
  document.getElementById("sentCount").textContent = values.filter((item) => item.status === "成功").length;
  document.getElementById("skippedCount").textContent = values.filter((item) => item.status === "跳过").length;
  document.getElementById("failedCount").textContent = values.filter((item) => item.status === "失败").length;
}

async function openJob(job) {
  if (job.link) {
    await chrome.tabs.create({ url: job.link, active: false });
    return;
  }
  await sendToActiveTab({ type: "BOSS_FILTER_OPEN_JOB", jobId: job.id });
}

async function greetSelectedJobs() {
  updateSelectedFromDom();
  const selectedJobs = lastJobs.filter((job) => selectedJobIdSet.has(job.id));
  if (!selectedJobs.length) {
    setMessage("请先勾选要打招呼的岗位。", "info");
    return;
  }

  const tasks = selectedJobs.map((job) => {
    const reasons = job.ai?.reasons?.length ? job.ai.reasons : job.reasons;
    return {
      id: job.id,
      title: job.title,
      company: job.company,
      link: job.link,
      greeting: greetingForJob(job, reasons),
      status: "待处理",
      createdAt: new Date().toISOString()
    };
  });

  await chrome.storage.local.set({ bossGreetingQueue: tasks });
  await persistReviewState();

  let opened = 0;
  for (const task of tasks) {
    if (!task.link) continue;
    await chrome.tabs.create({ url: task.link, active: false });
    opened += 1;
  }

  greetingFlowEl.hidden = false;
  setStatus("已建队列");
  setMessage(`已生成 ${tasks.length} 个打招呼任务，并在后台打开 ${opened} 个 JD 标签页。`, "info");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function syncSearchFilters() {
  try {
    setMessage();
    setStatus("同步中");
    await saveSettings();
    const result = await sendToActiveTab({
      type: "BOSS_FILTER_APPLY_SEARCH",
      settings: getSettings()
    });
    if (result?.ok === false) throw new Error(result.message || "同步失败。");
    setStatus("已同步");
    setMessage(result?.message || "已把职位名/城市同步到 BOSS 页面。", "info");
  } catch (error) {
    setStatus("出错");
    setMessage(error?.message || "同步职位名/城市失败，请确认当前是 BOSS 岗位列表页。");
    console.error(error);
  }
}

function scheduleSearchSync() {
  if (isComposingSearch) return;
  clearTimeout(searchSyncTimer);
  searchSyncTimer = setTimeout(syncSearchFilters, 900);
}

async function applySinglePageFilter(kind) {
  const value = els[kind]?.value?.trim() || els[kind]?.selectedOptions?.[0]?.textContent?.trim();
  if (!value) return;
  try {
    await saveSettings();
    setStatus("同步中");
    const result = await sendToActiveTab({
      type: "BOSS_FILTER_APPLY_SINGLE",
      kind,
      value
    });
    setStatus(result?.ok ? "已同步" : "未命中");
    setMessage(result?.message || "已尝试同步到 BOSS 页面。", result?.ok ? "info" : "error");
  } catch (error) {
    setStatus("出错");
    setMessage(error?.message || "同步页面筛选失败，请确认当前是 BOSS 岗位列表页。");
    console.error(error);
  }
}

document.getElementById("scanBtn").addEventListener("click", async () => {
  try {
    setMessage();
    setStatus("抓取中");
    await saveSettings();
    await chrome.storage.local.remove(["bossLastReview", "bossGreetingQueue"]);
    lastJobs = [];
    lastSummary = null;
    selectedJobIdSet = new Set();
    summaryEl.hidden = true;
    matchesEl.hidden = true;
    greetingFlowEl.hidden = true;
    matchListEl.innerHTML = "";
    const settings = getSettings();
    setMessage("正在抓取当前页面岗位列表...", "info");
    const result = await sendToActiveTab({
      type: "BOSS_FILTER_SCAN",
      settings
    });
    if (result?.error) throw new Error(result.error);
    setMessage(`已抓取 ${result?.jobs?.length || 0} 个岗位，开始评分...`, "info");
    const jobs = await enrichWithAi(settings, result?.jobs || []);
    lastJobs = jobs;
    lastSummary = summarizeJobs(jobs, settings);
    selectedJobIdSet = new Set(
      jobs
        .filter((job) => Number(job.finalScore ?? job.score ?? 0) >= Number(settings.minScore || 60))
        .map((job) => job.id)
    );
    renderSummary(lastSummary);
    renderMatches(jobs, settings);
    await persistReviewState();
    setStatus("已完成");
    const source = settings.useAi ? aiConfig(settings).label : "本地规则";
    setMessage(`已使用${source}判断 ${jobs.length} 个岗位。`, "info");
  } catch (error) {
    setStatus("出错");
    summaryEl.hidden = true;
    matchesEl.hidden = true;
    greetingFlowEl.hidden = true;
    setMessage(error?.message || "筛选失败，请刷新 BOSS 页面后重试。");
    console.error(error);
  }
});

document.getElementById("resetResultsBtn").addEventListener("click", () => {
  resetResults();
});

document.getElementById("copyPromptBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(AI_PROMPT_TEMPLATE);
  setMessage("AI 判断 prompt 已复制。", "info");
});

document.getElementById("greetSelectedBtn").addEventListener("click", greetSelectedJobs);

document.getElementById("testAiBtn").addEventListener("click", async () => {
  try {
    setMessage();
    setStatus("测试中");
    await saveSettings();
    await testAiConnection(getSettings());
    els.useAi.checked = true;
    await saveSettings();
    setStatus("连接成功");
    setMessage("AI 连接测试成功，已自动启用 AI 判断。", "info");
  } catch (error) {
    setStatus("连接失败");
    setMessage(error?.message || "AI 连接测试失败。");
    console.error(error);
  }
});

els.aiProvider.addEventListener("change", () => {
  if (els.aiProvider.value === "deepseek" && (!els.aiModel.value || els.aiModel.value === "gpt-4o-mini")) {
    els.aiModel.value = "deepseek-chat";
  }
  if (els.aiProvider.value === "openai" && (!els.aiModel.value || els.aiModel.value.startsWith("deepseek-"))) {
    els.aiModel.value = "gpt-4o-mini";
  }
  saveSettings();
});

document.getElementById("markSentBtn").addEventListener("click", () => updateApplicationStatus("成功"));
document.getElementById("markSkippedBtn").addEventListener("click", () => updateApplicationStatus("跳过"));
document.getElementById("markFailedBtn").addEventListener("click", () => updateApplicationStatus("失败"));
document.getElementById("resetLogBtn").addEventListener("click", async () => {
  applicationLog = {};
  await chrome.storage.local.set({ bossApplicationLog: applicationLog });
  renderMatches(lastJobs, getSettings());
  setMessage("投递记录已清空。", "info");
});

for (const id of formIds) {
  els[id].addEventListener("change", saveSettings);
}

for (const id of resultSensitiveFields) {
  els[id].addEventListener("change", clearStaleResultsOnCriteriaChange);
}

["experience", "education", "salaryRange"].forEach((id) => {
  els[id].addEventListener("change", () => applySinglePageFilter(id));
});

["jobKeywords", "city"].forEach((id) => {
  els[id].addEventListener("compositionstart", () => {
    isComposingSearch = true;
  });
  els[id].addEventListener("compositionend", () => {
    isComposingSearch = false;
    scheduleSearchSync();
  });
  els[id].addEventListener("input", scheduleSearchSync);
  els[id].addEventListener("input", clearStaleResultsOnCriteriaChange);
  els[id].addEventListener("change", syncSearchFilters);
  els[id].addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      clearTimeout(searchSyncTimer);
      syncSearchFilters();
    }
  });
});

restoreSettings();
