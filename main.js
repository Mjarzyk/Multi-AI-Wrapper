const { app, BrowserWindow, BrowserView, ipcMain, Menu, shell, session } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;

// Map of model -> URL
const MODEL_URLS = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/",
  copilot: "https://copilot.microsoft.com/",
  gemini: "https://gemini.google.com/app",
  perplexity: "https://www.perplexity.ai/"
};

const DEFAULT_MODEL_ORDER = ["chatgpt", "claude", "copilot", "gemini", "perplexity"];

// Dynamic + persisted
let MODEL_ORDER = DEFAULT_MODEL_ORDER.slice();

// Map of model -> BrowserView (created on first use)
const views = {};

// Track which model is currently active
let activeModel = null;

// Track per-model load state for UI
// { [model]: { initialized: boolean, loading: boolean, error: boolean } }
const modelLoadState = Object.create(null);

// --- renderer sync / UI update signal handling ---
let rendererReady = false;
let pendingActiveModel = null;

function notifyActiveModel(modelName) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (!rendererReady) {
    pendingActiveModel = modelName;
    return;
  }

  try {
    mainWindow.webContents.send("active-model-changed", modelName);
  } catch {}
}

function notifyModelLoadState(modelName) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!rendererReady) return;

  const state = modelLoadState[modelName] || { initialized: false, loading: false, error: false };

  try {
    mainWindow.webContents.send("model-load-state-changed", {
      model: modelName,
      initialized: !!state.initialized,
      loading: !!state.loading,
      error: !!state.error
    });
  } catch {}
}

function notifyAllModelLoadStates() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!rendererReady) return;

  try {
    mainWindow.webContents.send("all-model-load-states", modelLoadState);
  } catch {}
}
// --- end ---

// --- persistence ---
function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function sanitizeOrder(order) {
  if (!Array.isArray(order)) return null;

  const known = Object.keys(MODEL_URLS);
  const set = new Set(order);

  if (order.length !== known.length) return null;
  if (set.size !== known.length) return null;

  for (const m of order) {
    if (!MODEL_URLS[m]) return null;
  }

  return order.slice();
}

function loadSettings() {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) return;

    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw);

    const cleaned = sanitizeOrder(data.modelOrder);
    if (cleaned) MODEL_ORDER = cleaned;

    if (data.activeModel && MODEL_URLS[data.activeModel]) {
      activeModel = data.activeModel;
    }
  } catch {
    // ignore broken settings
  }
}

function saveSettings() {
  try {
    const p = settingsPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const data = {
      modelOrder: MODEL_ORDER,
      activeModel: activeModel
    };

    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // ignore write errors
  }
}
// --- end persistence ---

// Helper: which URLs are allowed to stay inside the app?
function isAllowedInApp(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;

    const host = u.host;
    return (
      host === "chatgpt.com" ||
      host === "claude.ai" ||
      host === "copilot.microsoft.com" ||
      host === "gemini.google.com" ||
      host === "www.perplexity.ai"
    );
  } catch {
    return false;
  }
}

function getActiveIndex() {
  const idx = MODEL_ORDER.indexOf(activeModel);
  return idx >= 0 ? idx : 0;
}

function cycleTab(direction) {
  const idx = getActiveIndex();
  const nextIdx = (idx + direction + MODEL_ORDER.length) % MODEL_ORDER.length;
  showView(MODEL_ORDER[nextIdx]);
}

function switchToNumber(n) {
  const idx = n - 1;
  if (idx < 0 || idx >= MODEL_ORDER.length) return;
  showView(MODEL_ORDER[idx]);
}

function handleShortcut(event, input) {
  if (input.type !== "keyDown") return;

  const isMac = process.platform === "darwin";
  const modPressed = isMac ? input.meta : input.control;
  if (!modPressed) return;

  if (input.key === "1") { event.preventDefault(); switchToNumber(1); return; }
  if (input.key === "2") { event.preventDefault(); switchToNumber(2); return; }
  if (input.key === "3") { event.preventDefault(); switchToNumber(3); return; }
  if (input.key === "4") { event.preventDefault(); switchToNumber(4); return; }
  if (input.key === "5") { event.preventDefault(); switchToNumber(5); return; }

  if (input.key === "Tab") {
    event.preventDefault();
    if (input.shift) cycleTab(-1);
    else cycleTab(+1);
    return;
  }
}

function setModelState(modelName, patch) {
  const prev = modelLoadState[modelName] || {};
  modelLoadState[modelName] = {
    initialized: !!prev.initialized,
    loading: typeof patch.loading === "boolean" ? patch.loading : !!prev.loading,
    error: typeof patch.error === "boolean" ? patch.error : !!prev.error
  };
  notifyModelLoadState(modelName);
}

// Create a BrowserView for a model (if not already created) and load the URL
function ensureView(modelName) {
  if (views[modelName]) return views[modelName];

  const url = MODEL_URLS[modelName];
  if (!url) return null;

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true
    }
  });

  const wc = view.webContents;

  // initialize state (this is what drives "green dot means preloaded")
  modelLoadState[modelName] = {
    initialized: true,
    loading: true,
    error: false
  };
  notifyModelLoadState(modelName);

  wc.on("before-input-event", handleShortcut);

  // loading indicators
  wc.on("did-start-loading", () => setModelState(modelName, { loading: true, error: false }));
  wc.on("did-stop-loading", () => setModelState(modelName, { loading: false }));
  wc.on("did-fail-load", () => setModelState(modelName, { loading: false, error: true }));
  wc.on("did-fail-provisional-load", () => setModelState(modelName, { loading: false, error: true }));

  wc.loadURL(url);

  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedInApp(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  wc.on("will-navigate", (event, url) => {
    if (!isAllowedInApp(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Right-click context menu WITH spellcheck suggestions
  wc.on("context-menu", (_event, params) => {
    try {
      const template = [];

      // Spellcheck suggestions
      if (params && params.misspelledWord && Array.isArray(params.dictionarySuggestions)) {
        const suggestions = params.dictionarySuggestions.slice(0, 8);

        if (suggestions.length) {
          for (const s of suggestions) {
            template.push({
              label: s,
              click: () => {
                try { wc.replaceMisspelling(s); } catch {}
              }
            });
          }
        } else {
          template.push({ label: "No spelling suggestions", enabled: false });
        }

        template.push({ type: "separator" });

        template.push({
          label: `Add to Dictionary`,
          click: () => {
            try {
              const word = params.misspelledWord;
              if (word) wc.session.addWordToSpellCheckerDictionary(word);
            } catch {}
          }
        });

        template.push({ type: "separator" });
      }

      template.push(
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        { role: "selectAll" }
      );

      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: mainWindow });
    } catch {}
  });

  views[modelName] = view;
  return view;
}

// Show selected BrowserView
function showView(modelName) {
  if (!mainWindow) return;
  if (!MODEL_URLS[modelName]) return;

  const view = ensureView(modelName);
  if (!view) return;

  mainWindow.setBrowserView(view);
  resizeActiveView(view);

  activeModel = modelName;
  saveSettings();

  notifyActiveModel(modelName);
}

// Refresh helpers
function refreshModel(modelName, hard = false) {
  if (!MODEL_URLS[modelName]) return;

  const view = ensureView(modelName);
  if (!view) return;

  const wc = view.webContents;
  if (!wc || wc.isDestroyed()) return;

  try {
    if (hard && typeof wc.reloadIgnoringCache === "function") wc.reloadIgnoringCache();
    else wc.reload();
  } catch {}
}

function refreshActive(hard = false) {
  if (!activeModel) return;
  refreshModel(activeModel, hard);
}

// Stop loading helper (used when clicking spinner)
function stopModel(modelName) {
  const view = views[modelName];
  if (!view) return;

  const wc = view.webContents;
  if (!wc || wc.isDestroyed()) return;

  try { wc.stop(); } catch {}
}

// Resize view to fit under top bar
function resizeActiveView(viewOverride) {
  if (!mainWindow) return;

  const view = viewOverride || mainWindow.getBrowserView();
  if (!view) return;

  const [winWidth, winHeight] = mainWindow.getContentSize();
  const topBarHeight = 48;

  view.setBounds({
    x: 0,
    y: topBarHeight,
    width: winWidth,
    height: winHeight - topBarHeight
  });

  view.setAutoResize({ width: true, height: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Multi-AI Cockpit",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true
    }
  });

  mainWindow.maximize();
  mainWindow.loadFile("index.html");

  mainWindow.webContents.on("did-finish-load", () => {
    rendererReady = true;

    // Send persisted order first so renderer can reorder DOM
    try {
      mainWindow.webContents.send("model-order-changed", MODEL_ORDER);
    } catch {}

    // Send initial load states
    notifyAllModelLoadStates();

    // Then sync active model highlight
    const toSend = pendingActiveModel || activeModel;
    if (toSend) notifyActiveModel(toSend);
    pendingActiveModel = null;
  });

  mainWindow.webContents.on("before-input-event", handleShortcut);

  // Startup: use persisted activeModel if valid, otherwise slot 1
  if (!activeModel || !MODEL_URLS[activeModel]) {
    activeModel = MODEL_ORDER[0] || "chatgpt";
  }

  const initialView = ensureView(activeModel);
  if (initialView) {
    mainWindow.setBrowserView(initialView);
    resizeActiveView(initialView);
  }

  saveSettings();
  notifyActiveModel(activeModel);

  mainWindow.on("resize", () => resizeActiveView());

  mainWindow.on("closed", () => {
    for (const key of Object.keys(views)) {
      const v = views[key];
      if (v && v.webContents && !v.webContents.isDestroyed()) {
        try { v.destroy(); } catch {}
      }
      delete views[key];
    }
    activeModel = null;
    mainWindow = null;
    rendererReady = false;
    pendingActiveModel = null;
  });
}

// Renderer requests tab switch
ipcMain.on("switch-model", (_event, modelName) => {
  if (!MODEL_URLS[modelName]) return;
  if (activeModel === modelName) return;
  showView(modelName);
});

// Renderer tells main the new tab order (after drag reorder)
ipcMain.on("set-model-order", (_event, order) => {
  const cleaned = sanitizeOrder(order);
  if (!cleaned) return;

  MODEL_ORDER = cleaned;
  saveSettings();

  // If activeModel fell out (shouldn't), recover to slot 1
  if (!MODEL_ORDER.includes(activeModel)) {
    activeModel = MODEL_ORDER[0];
    showView(activeModel);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send("model-order-changed", MODEL_ORDER);
    } catch {}
  }
});

// Refresh IPC
ipcMain.on("refresh-active", (_event, payload) => {
  refreshActive(!!(payload && payload.hard));
});

ipcMain.on("refresh-model", (_event, payload) => {
  if (!payload || !payload.modelName) return;
  refreshModel(payload.modelName, !!payload.hard);
});

// Stop IPC (spinner click)
ipcMain.on("stop-model", (_event, payload) => {
  if (!payload || !payload.modelName) return;
  stopModel(payload.modelName);
});

app.whenReady().then(() => {
  // Spellcheck language (English)
  try {
    session.defaultSession.setSpellCheckerLanguages(["en-US"]);
  } catch {}

  loadSettings();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
