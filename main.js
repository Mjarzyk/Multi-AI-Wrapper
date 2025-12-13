const { app, BrowserWindow, BrowserView, ipcMain, Menu, shell } = require("electron");
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

// Create a BrowserView for a model (if not already created) and load the URL
function ensureView(modelName) {
  if (views[modelName]) return views[modelName];

  const url = MODEL_URLS[modelName];
  if (!url) return null;

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  const wc = view.webContents;

  wc.on("before-input-event", handleShortcut);

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

  wc.on("context-menu", () => {
    const template = [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { type: "separator" },
      { role: "selectAll" }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow });
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
      sandbox: true
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

app.whenReady().then(() => {
  loadSettings();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
