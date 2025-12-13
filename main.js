const { app, BrowserWindow, BrowserView, ipcMain, Menu, shell } = require("electron");
const path = require("path");

let mainWindow;

// Map of model -> URL
const MODEL_URLS = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/",
  copilot: "https://copilot.microsoft.com/",
  gemini: "https://gemini.google.com/app",
  perplexity: "https://www.perplexity.ai/"
};

// Map of model -> BrowserView (created on first use)
const views = {};

// Track which model is currently active
let activeModel = null;

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

// Create a BrowserView for a model (if not already created) and load the URL
function ensureView(modelName) {
  if (views[modelName]) {
    return views[modelName];
  }

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

  // Load the provider URL
  wc.loadURL(url);

  // 1) Intercept NEW windows (target=_blank, window.open)
  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedInApp(url)) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  // 2) Intercept normal navigations inside the same view
  wc.on("will-navigate", (event, url) => {
    if (!isAllowedInApp(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Attach a basic right-click context menu
  wc.on("context-menu", (event, params) => {
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

  const view = ensureView(modelName);
  if (!view) return;

  mainWindow.setBrowserView(view);
  resizeActiveView(view);
  activeModel = modelName;
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

  // Start with maximized window
  mainWindow.maximize();

  // Load UI (top bar and tabs)
  mainWindow.loadFile("index.html");

  // Lazy preload: only create ChatGPT on startup
  activeModel = "chatgpt";
  const initialView = ensureView(activeModel);
  if (initialView) {
    mainWindow.setBrowserView(initialView);
    resizeActiveView(initialView);
  }

  mainWindow.on("resize", () => {
    resizeActiveView();
  });

  mainWindow.on("closed", () => {
    // Clean up BrowserViews safely
    for (const key of Object.keys(views)) {
      const v = views[key];
      if (v && v.webContents && !v.webContents.isDestroyed()) {
        try {
          v.destroy();
        } catch {
          // ignore any cleanup errors
        }
      }
      delete views[key];
    }
    activeModel = null;
    mainWindow = null;
  });
}

// Renderer requests tab switch
ipcMain.on("switch-model", (event, modelName) => {
  if (!MODEL_URLS[modelName]) return;
  if (activeModel === modelName) return; // already active
  showView(modelName);
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
