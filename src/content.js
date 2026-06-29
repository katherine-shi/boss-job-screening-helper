const MARKED_CARD_CLASS = "boss-filter-card";
const BADGE_CLASS = "boss-filter-badge";
const SELECTED_CLASS = "boss-filter-selected";

const cardSelectors = [
  ".job-card-wrapper",
  ".job-card-body",
  ".job-primary",
  ".job-list-box li",
  ".rec-job-list .job-card",
  "[class*='job-card']",
  "[class*='job-primary']"
];

const fieldSelectors = {
  title: [".job-name", ".job-title", "[class*='job-name']", "[class*='job-title']"],
  salary: [".salary", ".job-salary", "[class*='salary']"],
  company: [".company-name", "[class*='company-name']"],
  tags: [".tag-list", ".job-info", ".job-area-wrapper", "[class*='tag']", "[class*='job-info']"]
};

let lastCardById = new Map();

const CITY_MAP = {
  "全国": "100010000",
  "北京": "101010100",
  "上海": "101020100",
  "广州": "101280100",
  "深圳": "101280600",
  "杭州": "101210100",
  "成都": "101270100",
  "武汉": "101200100",
  "西安": "101110100",
  "南京": "101190100",
  "苏州": "101190400",
  "天津": "101030100",
  "重庆": "101040100",
  "长沙": "101250100",
  "郑州": "101180100",
  "沈阳": "101070100",
  "青岛": "101120200",
  "合肥": "101220100",
  "厦门": "101230200",
  "福州": "101230100",
  "济南": "101120100",
  "宁波": "101210400",
  "东莞": "101281600",
  "无锡": "101190200",
  "昆明": "101290100",
  "哈尔滨": "101050100",
  "长春": "101060100",
  "大连": "101070200",
  "石家庄": "101090100"
};

function splitTerms(value) {
  return String(value || "")
    .split(/[,，、\n\s]+/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pickText(root, selectors) {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    const text = compactText(el?.textContent);
    if (text) return text;
  }
  return "";
}

function parseSalaryK(text) {
  const normalized = String(text || "").toLowerCase().replace(/\s+/g, "");
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*k?\s*[-至~]\s*(\d+(?:\.\d+)?)\s*k/);
  const single = normalized.match(/(\d+(?:\.\d+)?)\s*k/);

  if (match) {
    return {
      min: Number(match[1]),
      max: Number(match[2])
    };
  }

  if (single) {
    const value = Number(single[1]);
    return { min: value, max: value };
  }

  return null;
}

function makeId(job) {
  const base = job.link || `${job.title}|${job.company}|${job.salary}`;
  let hash = 0;
  for (let index = 0; index < base.length; index += 1) {
    hash = (hash * 31 + base.charCodeAt(index)) >>> 0;
  }
  return `job-${hash.toString(36)}`;
}

function candidateCards() {
  const cards = new Set();

  for (const selector of cardSelectors) {
    document.querySelectorAll(selector).forEach((el) => {
      const text = compactText(el.textContent);
      if (text.length > 12 && /k|薪|经验|学历|公司|岗位|职位|年/i.test(text)) {
        cards.add(el);
      }
    });
  }

  document.querySelectorAll("a[href*='/job_detail/']").forEach((link) => {
    const card = link.closest(cardSelectors.join(",")) || link.closest("li") || link.parentElement;
    if (card && compactText(card.textContent).length > 12) {
      cards.add(card);
    }
  });

  return [...cards].filter((card) => {
    const rect = card.getBoundingClientRect();
    return rect.width > 180 && rect.height > 50;
  });
}

function extractExperience(text) {
  const value = compactText(text);
  const options = ["在校生", "应届生", "1年以内", "1-3年", "3-5年", "5-10年", "10年以上", "不限"];
  return options.find((option) => value.includes(option)) || "";
}

function extractJob(card) {
  const text = compactText(card.textContent);
  const title = pickText(card, fieldSelectors.title) || compactText(card.querySelector("a")?.textContent);
  const salary = pickText(card, fieldSelectors.salary);
  const company = pickText(card, fieldSelectors.company);
  const tags = pickText(card, fieldSelectors.tags);
  const link = card.querySelector("a[href*='/job_detail/']")?.href || "";
  const experience = extractExperience(text);
  const job = {
    title,
    salary,
    salaryRange: parseSalaryK(salary || text),
    company,
    tags,
    experience,
    link,
    text
  };
  job.id = makeId(job);
  return job;
}

function scoreJob(job, settings) {
  const titleTerms = splitTerms(settings.jobKeywords);
  const blockedTerms = splitTerms(settings.blockedKeywords);
  const resumeTerms = splitTerms(settings.resumeText);
  const city = String(settings.city || "").trim().toLowerCase();
  const minSalary = Number(settings.minSalary || 0);
  const experience = String(settings.experience || "").trim();
  const education = String(settings.education || "").trim();
  const haystack = `${job.title} ${job.salary} ${job.company} ${job.tags} ${job.experience} ${job.text}`.toLowerCase();
  const reasons = [];
  const risks = [];
  let score = 0;

  if (titleTerms.length === 0) {
    score += 15;
  } else {
    const hits = titleTerms.filter((term) => haystack.includes(term));
    if (hits.length > 0) {
      score += Math.min(30, 16 + hits.length * 7);
      reasons.push(`岗位关键词：${hits.slice(0, 3).join("、")}`);
    } else {
      risks.push("岗位关键词未命中");
    }
  }

  if (city) {
    if (haystack.includes(city)) {
      score += 18;
      reasons.push(`城市匹配：${settings.city}`);
    } else {
      risks.push(`城市可能不匹配：${settings.city}`);
    }
  } else {
    score += 8;
  }

  if (experience) {
    if (haystack.includes(experience) || !job.experience) {
      score += 12;
      reasons.push(`经验匹配：${experience}`);
    } else {
      risks.push(`经验可能不匹配：${experience}`);
    }
  } else {
    score += 8;
  }

  if (education) {
    if (haystack.includes(education) || education === "学历不限") {
      score += 8;
      reasons.push(`学历匹配：${education}`);
    } else {
      risks.push(`学历可能不匹配：${education}`);
    }
  } else {
    score += 5;
  }

  if (minSalary > 0) {
    if (job.salaryRange?.min >= minSalary || job.salaryRange?.max >= minSalary) {
      score += 18;
      reasons.push(`薪资达到 ${minSalary}K+`);
    } else if (job.salaryRange) {
      risks.push(`薪资低于 ${minSalary}K`);
    } else {
      risks.push("未识别到薪资");
    }
  } else {
    score += 8;
  }

  if (resumeTerms.length > 0) {
    const hits = resumeTerms.filter((term) => haystack.includes(term));
    if (hits.length > 0) {
      score += Math.min(24, hits.length * 4);
      reasons.push(`简历关键词：${hits.slice(0, 4).join("、")}`);
    } else {
      risks.push("简历关键词未命中");
    }
  }

  const blockedHits = blockedTerms.filter((term) => haystack.includes(term));
  if (blockedHits.length > 0) {
    score -= 35;
    risks.push(`包含排除词：${blockedHits.slice(0, 3).join("、")}`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    finalScore: score,
    reasons: reasons.length ? reasons : ["信息较少，建议人工查看"],
    risks
  };
}

function clearMarks() {
  document.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => badge.remove());
  document.querySelectorAll(`.${MARKED_CARD_CLASS}`).forEach((card) => {
    card.classList.remove(MARKED_CARD_CLASS, SELECTED_CLASS);
    card.removeAttribute("data-boss-filter-level");
  });
}

function levelForScore(score, minScore) {
  if (score >= Math.max(75, minScore)) return "high";
  if (score >= minScore) return "medium";
  return "low";
}

function addBadge(card, job, settings) {
  const minScore = Number(settings.minScore || 60);
  const score = Number(job.finalScore ?? job.score ?? 0);
  const level = levelForScore(score, minScore);
  const badge = document.createElement("div");
  const title = score >= minScore ? "推荐查看" : "暂不优先";
  const reasons = job.ai?.reasons?.length ? job.ai.reasons : job.reasons;
  const risks = job.ai?.risks?.length ? job.ai.risks : job.risks;
  const detail = [...(reasons || []), ...(risks || []).map((risk) => `注意：${risk}`)]
    .slice(0, 3)
    .join("；");

  card.classList.add(MARKED_CARD_CLASS);
  card.dataset.bossFilterLevel = level;
  badge.className = BADGE_CLASS;
  badge.dataset.bossFilterLevel = level;
  badge.innerHTML = `<strong>${title} ${score}分</strong><span>${escapeHtml(detail)}</span>`;
  card.appendChild(badge);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getScrollContainer() {
  const candidates = [
    document.querySelector(".job-list-container"),
    document.querySelector(".job-list-box"),
    document.querySelector(".search-job-result"),
    ...document.querySelectorAll("[class*='job-list']"),
    document.scrollingElement,
    document.documentElement,
    document.body
  ].filter(Boolean);
  return candidates.find((el) => el.scrollHeight > el.clientHeight + 20) || document.scrollingElement;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectJobs(settings) {
  clearMarks();
  lastCardById = new Map();

  const limit = Math.max(1, Math.min(100, Number(settings.collectLimit || 30)));
  const jobsById = new Map();
  let staleRounds = 0;
  let loop = 0;

  await scrollToLoadMoreJobs();

  while (jobsById.size < limit && staleRounds < 6 && loop < 50) {
    loop += 1;
    const before = jobsById.size;
    for (const card of candidateCards()) {
      const job = extractJob(card);
      const scored = { ...job, ...scoreJob(job, settings) };
      if (!jobsById.has(scored.id)) {
        jobsById.set(scored.id, scored);
      }
      lastCardById.set(scored.id, card);
      if (jobsById.size >= limit) break;
    }

    staleRounds = jobsById.size === before ? staleRounds + 1 : 0;
    if (jobsById.size >= limit) break;

    await scrollJobListToBottom();
  }

  const jobs = [...jobsById.values()].slice(0, limit);
  return jobs;
}

async function scrollJobListToBottom() {
  await scrollToLoadMoreJobs(1);
}

async function scrollToLoadMoreJobs(rounds = 5) {
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
  const listContainers = [
    document.querySelector(".job-list-box"),
    document.querySelector(".search-job-result"),
    document.querySelector(".job-list-container"),
    ...document.querySelectorAll("[class*='job-list']")
  ].filter(Boolean);

  for (let index = 0; index < rounds; index += 1) {
    const currentScroll = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const targetScroll = currentScroll + viewportHeight * 0.8;

    window.scrollTo({
      top: targetScroll,
      behavior: "smooth"
    });

    for (const container of listContainers) {
      if (container.scrollHeight > container.clientHeight) {
        container.scrollTo({
          top: Math.min(container.scrollTop + viewportHeight * 0.8, container.scrollHeight),
          behavior: "smooth"
        });
        container.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
    }

    await wait(1500);
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

  for (const container of listContainers) {
    if (container.scrollHeight > container.clientHeight) {
      container.scrollTo({ top: 0, behavior: "smooth" });
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
  }

  await wait(800);
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight + 240;
}

function clickElement(el) {
  if (!el) return false;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  el.click();
  return true;
}

function normalizeOptionText(value) {
  return compactText(value)
    .replace(/\s+/g, "")
    .replace(/[－–—~至]/g, "-")
    .toLowerCase();
}

function isClickableCandidate(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function normalizeCity(value) {
  return String(value || "")
    .split(/[\/、,，\s]+/)[0]
    .replace(/[市省]$/g, "")
    .trim();
}

function buildBossSearchUrl(settings) {
  const city = normalizeCity(settings.city) || "全国";
  const cityCode = CITY_MAP[city] || CITY_MAP["全国"];
  const keyword = splitTerms(settings.jobKeywords).join(" ");
  const params = new URLSearchParams({
    query: keyword,
    city: cityCode
  });
  return {
    url: `https://www.zhipin.com/web/geek/jobs?${params.toString()}`,
    city,
    cityFound: Boolean(CITY_MAP[city])
  };
}

function filterOptionTexts(kind, value) {
  if (!value) return [];
  if (kind === "experience") {
    const map = {
      "在校生": ["在校/应届", "在校生", "应届生"],
      "应届生": ["应届生", "在校/应届"],
      "1年以内": ["1年以内"],
      "1-3年": ["1-3年"],
      "3-5年": ["3-5年"],
      "5-10年": ["5-10年"],
      "10年以上": ["10年以上"]
    };
    return map[value] || [value];
  }
  if (kind === "education") {
    if (value === "中专" || value === "中技") return ["中专/中技", value];
    return value === "学历不限" ? ["学历不限", "不限"] : [value];
  }
  if (kind === "salaryRange") {
    return value === "薪资不限" ? ["薪资不限", "不限"] : [value];
  }
  return [value];
}

function bossFilterWords(kind) {
  if (kind === "experience") return ["经验", "工作年限"];
  if (kind === "education") return ["学历", "教育"];
  if (kind === "salaryRange") return ["薪资", "薪资待遇"];
  return [kind];
}

function findBossFilterButton(kind) {
  const words = bossFilterWords(kind);
  return Array.from(document.querySelectorAll('.filter-select-box, .filter-item, [class*="filter"], button, div'))
    .find((el) => words.some((word) => el.textContent?.includes(word))) || null;
}

function findBossFilterOption(optionTexts) {
  const options = document.querySelectorAll('.filter-select-dropdown li, .dropdown-item, [class*="option"], li');
  for (const option of options) {
    const text = option.textContent || "";
    if (optionTexts.some((target) => text.includes(target))) {
      return option;
    }
  }

  const normalizedTargets = optionTexts.map(normalizeOptionText).filter(Boolean);
  for (const option of options) {
    const normalized = normalizeOptionText(option.textContent);
    if (normalizedTargets.some((target) => normalized.includes(target))) {
      return option;
    }
  }
  return null;
}

async function applyDropdownFilter(kind, value) {
  if (!value) return false;
  const optionTexts = filterOptionTexts(kind, value);
  const filterBtn = findBossFilterButton(kind);
  if (!filterBtn) return false;

  filterBtn.click();
  await wait(500);

  const option = findBossFilterOption(optionTexts);
  if (!option) return false;

  option.click();
  await wait(1000);
  return true;
}

async function applyPendingBossFilters() {
  const raw = sessionStorage.getItem("bossFilterPending");
  if (!raw) return;
  let pending;
  try {
    pending = JSON.parse(raw);
  } catch (_error) {
    sessionStorage.removeItem("bossFilterPending");
    return;
  }

  const targetKinds = [
    ["experience", pending.experience, "工作经验"],
    ["education", pending.education, "学历"],
    ["salaryRange", pending.salaryRange, "薪资"]
  ].filter(([, value]) => Boolean(value));
  const done = new Set(pending.done || []);
  const actions = [];

  for (let round = 0; round < 8; round += 1) {
    for (const [kind, value, label] of targetKinds) {
      if (done.has(kind)) continue;
      if (await applyDropdownFilter(kind, value)) {
        done.add(kind);
        actions.push(label);
      }
    }
    if (done.size >= targetKinds.length) break;
    await wait(900);
  }

  if (done.size >= targetKinds.length || targetKinds.length === 0) {
    sessionStorage.removeItem("bossFilterPending");
  } else {
    sessionStorage.setItem("bossFilterPending", JSON.stringify({ ...pending, done: [...done] }));
  }
  return actions;
}

async function applyPageFilters(settings) {
  const search = buildBossSearchUrl(settings);
  const pending = {
    experience: settings.experience || "",
    education: settings.education || "",
    salaryRange: settings.salaryRange || ""
  };
  sessionStorage.setItem("bossFilterPending", JSON.stringify(pending));

  if (location.href !== search.url) {
    setTimeout(() => {
      location.assign(search.url);
    }, 50);
    return {
      ok: true,
      message: `已打开 BOSS 搜索页：${splitTerms(settings.jobKeywords).join(" ") || "全部岗位"} / ${search.city}${search.cityFound ? "" : "（未识别，按全国）"}。页面加载后会自动尝试设置经验、学历和薪资。`
    };
  }

  const actions = await applyPendingBossFilters();

  return {
    ok: true,
    message: actions?.length
      ? `已在当前 BOSS 搜索页设置：${actions.join("、")}。`
      : "已在当前 BOSS 搜索页尝试设置经验、学历和薪资；如果仍未命中，请展开 BOSS 页面筛选项后再点一次。"
  };
}

async function switchCityBySearch(cityName, keyword = "") {
  const searchInput = document.querySelector(".search-input")
    || document.querySelector('input[placeholder*="搜索"]')
    || document.querySelector(".ipt-search")
    || document.querySelector("input[name='query']");

  if (!searchInput) return false;

  searchInput.value = `${keyword || ""} ${cityName || ""}`.trim();
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(500);

  const searchBtn = document.querySelector(".search-btn")
    || document.querySelector(".btn-search")
    || document.querySelector('button[type="submit"]');

  if (searchBtn) {
    searchBtn.click();
  } else {
    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  }

  await wait(3000);
  return true;
}

async function switchCity(cityName, keyword = "") {
  const city = normalizeCity(cityName);
  if (!city) return false;

  try {
    const citySelector = document.querySelector(".city-label")
      || document.querySelector('[class*="city"]')
      || document.querySelector(".filter-city");

    if (!citySelector) {
      return switchCityBySearch(city, keyword);
    }

    citySelector.click();
    await wait(1000);

    const cityInput = document.querySelector(".city-search input")
      || document.querySelector(".filter-city-search input");

    if (cityInput) {
      cityInput.value = city;
      cityInput.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(1000);
    }

    const cityItems = document.querySelectorAll('.city-item, .filter-city-item, [class*="city-list"] li');
    for (const item of cityItems) {
      if (item.textContent?.includes(city)) {
        item.click();
        await wait(2000);
        return true;
      }
    }

    return switchCityBySearch(city, keyword);
  } catch (_error) {
    return switchCityBySearch(city, keyword);
  }
}

async function applyKeywordSearch(keyword) {
  const query = splitTerms(keyword).join(" ");
  if (!query) return true;

  const searchInput = document.querySelector(".search-input")
    || document.querySelector('input[placeholder*="搜索"]')
    || document.querySelector(".ipt-search")
    || document.querySelector("input[name='query']");

  if (!searchInput) return false;

  searchInput.value = query;
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(500);

  const searchBtn = document.querySelector(".search-btn")
    || document.querySelector(".btn-search")
    || document.querySelector('button[type="submit"]');

  if (searchBtn) {
    searchBtn.click();
  } else {
    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  }

  await wait(2000);
  return true;
}

async function applySearchFilters(settings) {
  const keyword = splitTerms(settings.jobKeywords).join(" ");
  const city = normalizeCity(settings.city);
  const actions = [];

  if (city) {
    if (await switchCity(city, keyword)) {
      actions.push(`城市：${city}`);
    }
  }

  if (keyword) {
    if (await applyKeywordSearch(keyword)) {
      actions.push(`职位：${keyword}`);
    }
  }

  const pending = {
    experience: settings.experience || "",
    education: settings.education || "",
    salaryRange: settings.salaryRange || ""
  };
  sessionStorage.setItem("bossFilterPending", JSON.stringify(pending));
  setTimeout(() => {
    applyPendingBossFilters();
  }, 1200);

  return {
    ok: actions.length > 0,
    message: actions.length
      ? `已按 BOSS 页面交互同步：${actions.join("、")}。`
      : "没有找到 BOSS 城市选择器或搜索框，请确认当前是岗位列表页。"
  };
}

async function applySingleBossFilter(kind, value) {
  const labelMap = {
    experience: "工作经验",
    education: "学历",
    salaryRange: "薪资"
  };
  const ok = await applyDropdownFilter(kind, value);
  return {
    ok,
    message: ok
      ? `已同步 ${labelMap[kind] || "筛选项"}：${value}。`
      : `没有在当前 BOSS 页面找到 ${labelMap[kind] || "筛选项"}：${value}，请展开筛选栏后再选一次。`
  };
}

setTimeout(() => {
  applyPendingBossFilters();
}, 1200);

function openJob(jobId) {
  const card = lastCardById.get(jobId);
  if (!card) return { ok: false };
  card.classList.add(SELECTED_CLASS);
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  const link = card.querySelector("a[href*='/job_detail/']");
  if (link) link.click();
  return { ok: true };
}

function summarize(jobs, settings) {
  const minScore = Number(settings.minScore || 60);
  const scores = jobs.map((job) => Number(job.finalScore ?? job.score ?? 0));
  return {
    total: jobs.length,
    matches: scores.filter((score) => score >= minScore).length,
    averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
    jobs
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "BOSS_FILTER_SCAN") {
    collectJobs(message.settings || {})
      .then((jobs) => sendResponse(summarize(jobs, message.settings || {})))
      .catch((error) => sendResponse({ error: error?.message || "抓取岗位失败", jobs: [] }));
    return true;
  }

  if (message?.type === "BOSS_FILTER_APPLY_PAGE_FILTERS") {
    applyPageFilters(message.settings || {})
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "同步页面筛选失败" }));
    return true;
  }

  if (message?.type === "BOSS_FILTER_APPLY_SEARCH") {
    applySearchFilters(message.settings || {})
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "同步职位名/城市失败" }));
    return true;
  }

  if (message?.type === "BOSS_FILTER_APPLY_SINGLE") {
    applySingleBossFilter(message.kind, message.value)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "同步页面筛选失败" }));
    return true;
  }

  if (message?.type === "BOSS_FILTER_OPEN_JOB") {
    sendResponse(openJob(message.jobId));
    return true;
  }

  if (message?.type === "BOSS_FILTER_CLEAR") {
    clearMarks();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
