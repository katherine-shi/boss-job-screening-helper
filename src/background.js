function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function injectContentScript(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["src/content.css"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content.js"]
  });
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    const text = String(error?.message || "");
    if (!text.includes("Receiving end does not exist") && !text.includes("Could not establish connection")) {
      throw error;
    }
    await injectContentScript(tabId);
    await wait(500);
    return chrome.tabs.sendMessage(tabId, message);
  }
}

function waitForTabComplete(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab?.status === "complete") finish();
    });
    setTimeout(finish, timeout);
  });
}

async function updateApplicationLog(task, status, reason) {
  const { bossApplicationLog } = await chrome.storage.local.get(["bossApplicationLog"]);
  const applicationLog = bossApplicationLog || {};
  applicationLog[task.id] = {
    status,
    updatedAt: new Date().toISOString(),
    reason
  };
  await chrome.storage.local.set({ bossApplicationLog: applicationLog });
}

async function runStayMode(sourceTabId, tasks) {
  const result = await sendToTab(sourceTabId, {
    type: "BOSS_FILTER_GREET_SELECTED",
    tasks,
    options: { mode: "stay" }
  });

  const results = result?.results || [];
  for (const item of results) {
    const task = tasks.find((candidate) => candidate.id === item.id);
    if (!task) continue;
    await updateApplicationLog(task, item.ok ? "成功" : "失败", item.message || "");
  }
  return results;
}

async function runChatMode(tasks) {
  const results = [];
  for (const task of tasks) {
    if (!task.link) {
      const item = { id: task.id, ok: false, message: "缺少岗位链接" };
      results.push(item);
      await updateApplicationLog(task, "失败", item.message);
      continue;
    }

    try {
      const tab = await chrome.tabs.create({ url: task.link, active: false });
      await waitForTabComplete(tab.id);
      await wait(900);
      const result = await sendToTab(tab.id, {
        type: "BOSS_FILTER_START_CHAT",
        task,
        options: { mode: "chat" }
      });
      const item = { id: task.id, ok: Boolean(result?.ok), message: result?.message || "未能开始沟通" };
      results.push(item);
      await updateApplicationLog(task, item.ok ? "成功" : "失败", item.message);
    } catch (error) {
      const item = { id: task.id, ok: false, message: error?.message || "未能开始沟通" };
      results.push(item);
      await updateApplicationLog(task, "失败", item.message);
    }

    await wait(1800);
  }
  return results;
}

async function runGreetingQueue(message) {
  const tasks = message.tasks || [];
  const mode = message.mode || "stay";
  const results = mode === "chat"
    ? await runChatMode(tasks)
    : await runStayMode(message.sourceTabId, tasks);

  const { bossGreetingQueue } = await chrome.storage.local.get(["bossGreetingQueue"]);
  const queue = bossGreetingQueue || tasks;
  const resultsById = new Map(results.map((item) => [item.id, item]));
  const updatedQueue = queue.map((task) => {
    const item = resultsById.get(task.id);
    if (!item) return task;
    return {
      ...task,
      status: item.ok ? "成功" : "失败",
      message: item.message,
      updatedAt: new Date().toISOString()
    };
  });
  await chrome.storage.local.set({ bossGreetingQueue: updatedQueue });

  return { ok: true, results };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "BOSS_FILTER_RUN_GREETING_QUEUE") {
    runGreetingQueue(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "一键打招呼失败", results: [] }));
    return true;
  }
  return false;
});
