const GistSync = (() => {
  const CFG_KEY = "quiz_gist_sync_cfg_v1";
  const FILE_NAME = "teacher-quiz-backup.json";

  function loadCfg() {
    try {
      return JSON.parse(localStorage.getItem(CFG_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveCfg(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  }

  function formCfg() {
    return {
      token: document.getElementById("gistToken").value.trim(),
      gistId: document.getElementById("gistId").value.trim(),
      rememberToken: document.getElementById("rememberGistToken").checked,
    };
  }

  function persistFormCfg() {
    const cfg = formCfg();
    saveCfg({
      gistId: cfg.gistId,
      token: cfg.rememberToken ? cfg.token : "",
      rememberToken: cfg.rememberToken,
    });
    return cfg;
  }

  function applyCfgToForm() {
    const cfg = loadCfg();
    document.getElementById("gistId").value = cfg.gistId || "";
    document.getElementById("gistToken").value = cfg.token || "";
    document.getElementById("rememberGistToken").checked = !!cfg.rememberToken;
  }

  function setStatus(text) {
    document.getElementById("gistStatus").textContent = text;
  }

  function assertReady(cfg, needsExistingGist = true) {
    if (!cfg.token) throw new Error("请先填写 GitHub Token。");
    if (needsExistingGist && !cfg.gistId) throw new Error("请先填写 Gist ID，或直接点“同步一次”自动创建。");
  }

  function authHeaders(token) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async function requestJson(url, options) {
    const res = await fetch(url, options);
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }
    if (!res.ok) {
      const message = data?.message || `${res.status} ${res.statusText}`;
      throw new Error(`GitHub 请求失败：${message}`);
    }
    return data;
  }

  function refreshUiAfterRestore() {
    if (typeof refreshHeatAfterStatsChange === "function") refreshHeatAfterStatsChange();
    if (typeof renderSessionStatus === "function") renderSessionStatus();
    if (typeof renderWrongList === "function") renderWrongList();
    if (typeof renderWrongHeatStrip === "function") renderWrongHeatStrip();
  }

  async function createGist(cfg, backup) {
    const gist = await requestJson("https://api.github.com/gists", {
      method: "POST",
      headers: authHeaders(cfg.token),
      body: JSON.stringify({
        description: "教师教育理论刷题离线版同步数据",
        public: false,
        files: {
          [FILE_NAME]: {
            content: JSON.stringify(backup, null, 2),
          },
        },
      }),
    });
    document.getElementById("gistId").value = gist.id;
    saveCfg({
      gistId: gist.id,
      token: cfg.rememberToken ? cfg.token : "",
      rememberToken: cfg.rememberToken,
    });
    return gist;
  }

  async function readGistBackup(cfg) {
    assertReady(cfg);
    const gist = await requestJson(`https://api.github.com/gists/${encodeURIComponent(cfg.gistId)}`, {
      method: "GET",
      headers: authHeaders(cfg.token),
    });
    const file = gist.files?.[FILE_NAME];
    if (!file?.content) throw new Error(`这个 Gist 里没有 ${FILE_NAME}。`);
    return QuizBackup.validate(JSON.parse(file.content));
  }

  async function writeGistBackup(cfg, backup) {
    assertReady(cfg);
    return requestJson(`https://api.github.com/gists/${encodeURIComponent(cfg.gistId)}`, {
      method: "PATCH",
      headers: authHeaders(cfg.token),
      body: JSON.stringify({
        files: {
          [FILE_NAME]: {
            content: JSON.stringify(backup, null, 2),
          },
        },
      }),
    });
  }

  async function pull() {
    const cfg = persistFormCfg();
    assertReady(cfg);
    setStatus("正在下载云端记录...");
    const remote = await readGistBackup(cfg);
    const merged = QuizBackup.restore(localStorage, remote);
    refreshUiAfterRestore();
    setStatus(`下载并合并成功：${QuizBackup.summary(merged)}`);
  }

  async function push() {
    const cfg = persistFormCfg();
    assertReady(cfg);
    setStatus("正在上传本机记录...");
    const backup = QuizBackup.capture(localStorage);
    await writeGistBackup(cfg, backup);
    setStatus(`上传成功：${QuizBackup.summary(backup)}`);
  }

  async function sync() {
    const cfg = persistFormCfg();
    assertReady(cfg, false);
    setStatus("正在同步...");
    let merged;
    if (cfg.gistId) {
      const remote = await readGistBackup(cfg);
      merged = QuizBackup.restore(localStorage, remote);
      refreshUiAfterRestore();
    } else {
      merged = QuizBackup.capture(localStorage);
      await createGist(cfg, merged);
      setStatus(`已创建私密 Gist 并上传：${QuizBackup.summary(merged)}`);
      return;
    }
    const latest = QuizBackup.capture(localStorage);
    await writeGistBackup({...cfg, gistId: document.getElementById("gistId").value.trim()}, latest);
    setStatus(`同步完成：${QuizBackup.summary(latest)}`);
  }

  function bind() {
    applyCfgToForm();
    document.getElementById("btnSaveGistCfg").addEventListener("click", () => {
      persistFormCfg();
      setStatus("同步设置已保存到本机。");
    });
    document.getElementById("btnPullGist").addEventListener("click", () => run(pull));
    document.getElementById("btnPushGist").addEventListener("click", () => run(push));
    document.getElementById("btnSyncGist").addEventListener("click", () => run(sync));
  }

  async function run(fn) {
    const buttons = ["btnSaveGistCfg", "btnPullGist", "btnPushGist", "btnSyncGist"]
      .map(id => document.getElementById(id));
    buttons.forEach(button => { button.disabled = true; });
    try {
      await fn();
    } catch (error) {
      setStatus(error.message || String(error));
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  return {bind, pull, push, sync};
})();

if (typeof document !== "undefined") {
  GistSync.bind();
}
