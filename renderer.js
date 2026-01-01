let lastActiveModel = "chatgpt";
let dragSrcBtn = null;

// prevent overwriting persisted order on startup
let haveAppliedOrderFromMain = false;
let orderFallbackTimer = null;

// Track per-model UI state: { initialized: bool, loading: bool, error: bool }
const modelState = Object.create(null);

function injectStyles() {
  if (document.getElementById("multi-ai-style")) return;

  const style = document.createElement("style");
  style.id = "multi-ai-style";
  style.textContent = `
    .multi-ai-tab-active {
      background: #2f6feb !important;
      border-color: #2f6feb !important;
      color: #ffffff !important;
      opacity: 1 !important;
      filter: none !important;
    }
    .multi-ai-tab-active * {
      color: #ffffff !important;
      opacity: 1 !important;
      filter: none !important;
    }

    .multi-ai-tab-dragging {
      opacity: 0.75 !important;
      user-select: none !important;
    }

    .multi-ai-tab-drop-target {
      outline: 2px dashed rgba(255,255,255,0.35);
      outline-offset: 2px;
    }

    button {
      user-select: none;
      -webkit-user-select: none;
    }

    /* Status indicator */
    .multi-ai-tab-status {
      width: 10px;
      height: 10px;
      margin-left: 8px;
      display: inline-block;
      border-radius: 999px;
      opacity: 0.90;
      flex: 0 0 auto;
      cursor: pointer;
    }

    /* Hover affordance (subtle) */
    button:hover .multi-ai-tab-status {
      box-shadow: 0 0 0 3px rgba(255,255,255,0.08);
      opacity: 1;
    }

    @keyframes multiAiSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    .multi-ai-uninit .multi-ai-tab-status { display: none; }

    .multi-ai-loading .multi-ai-tab-status {
      display: inline-block;
      border: 2px solid rgba(255,255,255,0.35);
      border-top-color: rgba(255,255,255,0.95);
      background: transparent;
      animation: multiAiSpin 0.8s linear infinite;
    }

    .multi-ai-error .multi-ai-tab-status {
      display: inline-block;
      background: #ef4444;
      border: 1px solid rgba(0,0,0,0.25);
    }

    .multi-ai-ready .multi-ai-tab-status {
      display: inline-block;
      background: #22c55e;
      border: 1px solid rgba(0,0,0,0.25);
    }
  `;
  document.head.appendChild(style);
}

function getTabButtons() {
  // identity must come from data-model
  return Array.from(document.querySelectorAll("button.tab-button[data-model]"));
}

function buttonModel(btn) {
  return (btn.dataset && btn.dataset.model) ? btn.dataset.model : null;
}

function setActiveTabUI(modelName) {
  lastActiveModel = modelName;
  getTabButtons().forEach((btn) => {
    btn.classList.toggle("multi-ai-tab-active", buttonModel(btn) === modelName);
  });
}

function swapButtons(a, b) {
  if (!a || !b || a === b) return;

  const parent = a.parentNode;
  if (!parent || parent !== b.parentNode) return;

  const aNext = a.nextSibling;
  const bNext = b.nextSibling;

  if (aNext === b) {
    parent.insertBefore(b, a);
    return;
  }
  if (bNext === a) {
    parent.insertBefore(a, b);
    return;
  }

  parent.insertBefore(a, bNext);
  parent.insertBefore(b, aNext);
}

function emitOrderToMain() {
  const order = getTabButtons().map(buttonModel).filter(Boolean);
  window.electronAPI.setModelOrder(order);
}

function clearDropTargets() {
  getTabButtons().forEach((b) => b.classList.remove("multi-ai-tab-drop-target"));
}

function ensureTabWidgets(btn, modelName) {
  if (!btn) return;

  let status = btn.querySelector(".multi-ai-tab-status");
  if (!status) {
    status = document.createElement("span");
    status.className = "multi-ai-tab-status";
    btn.appendChild(status);
  }

  // Wire dot click once
  if (status.dataset.multiAiWired !== "1") {
    status.dataset.multiAiWired = "1";

    status.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const s = modelState[modelName] || { initialized: false, loading: false, error: false };

      // Option B behavior:
      // - spinner (loading) click => stop loading
      // - green/red click => refresh
      // - shift-click => hard refresh (ignore cache)
      if (!s.initialized) return;

      if (s.loading) {
        window.electronAPI.stopModel(modelName);
        return;
      }

      const hard = !!e.shiftKey;
      window.electronAPI.refreshModel(modelName, hard);
    });
  }

  applyModelStateToButton(btn, modelName);
}

function applyModelStateToButton(btn, modelName) {
  const s = modelState[modelName] || {
    initialized: false,
    loading: false,
    error: false
  };

  btn.classList.remove("multi-ai-uninit", "multi-ai-loading", "multi-ai-error", "multi-ai-ready");

  // Tooltip updates based on state
  const status = btn.querySelector(".multi-ai-tab-status");
  if (status) {
    if (!s.initialized) status.title = "";
    else if (s.loading) status.title = "Stop loading";
    else if (s.error) status.title = "Reload (Shift = hard reload)";
    else status.title = "Reload (Shift = hard reload)";
  }

  if (!s.initialized) {
    btn.classList.add("multi-ai-uninit");
    return;
  }

  if (s.loading) btn.classList.add("multi-ai-loading");
  else if (s.error) btn.classList.add("multi-ai-error");
  else btn.classList.add("multi-ai-ready");
}

function updateModelState(modelName, state) {
  if (!modelName) return;

  const prev = modelState[modelName] || {};
  modelState[modelName] = {
    initialized: !!(state && (state.initialized ?? prev.initialized)),
    loading: !!(state && state.loading),
    error: !!(state && state.error)
  };

  getTabButtons().forEach((btn) => {
    if (buttonModel(btn) === modelName) {
      ensureTabWidgets(btn, modelName);
    }
  });
}

function wireTabsOnce() {
  const buttons = getTabButtons();

  buttons.forEach((btn) => {
    const modelName = buttonModel(btn);
    if (!modelName) return;

    if (btn.dataset.multiAiWired === "1") {
      ensureTabWidgets(btn, modelName);
      return;
    }
    btn.dataset.multiAiWired = "1";

    btn.setAttribute("draggable", "true");
    ensureTabWidgets(btn, modelName);

    // CLICK: switch model
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.electronAPI.switchModel(modelName);
      setActiveTabUI(modelName);
    });

    // DRAG START
    btn.addEventListener("dragstart", (e) => {
      dragSrcBtn = btn;
      btn.classList.add("multi-ai-tab-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", modelName);
    });

    // DRAG OVER
    btn.addEventListener("dragover", (e) => {
      if (!dragSrcBtn || dragSrcBtn === btn) return;
      e.preventDefault();
      clearDropTargets();
      btn.classList.add("multi-ai-tab-drop-target");
      e.dataTransfer.dropEffect = "move";
    });

    // DRAG LEAVE
    btn.addEventListener("dragleave", () => {
      btn.classList.remove("multi-ai-tab-drop-target");
    });

    // DROP
    btn.addEventListener("drop", (e) => {
      e.preventDefault();
      btn.classList.remove("multi-ai-tab-drop-target");

      if (!dragSrcBtn || dragSrcBtn === btn) return;

      swapButtons(dragSrcBtn, btn);
      emitOrderToMain();
      setActiveTabUI(lastActiveModel);
    });

    // DRAG END
    btn.addEventListener("dragend", () => {
      btn.classList.remove("multi-ai-tab-dragging");
      clearDropTargets();
      dragSrcBtn = null;
    });
  });
}

// MAIN -> renderer sync
window.electronAPI.onActiveModelChanged((modelName) => {
  setActiveTabUI(modelName);
});

// MAIN -> renderer persisted order
window.electronAPI.onModelOrderChanged((order) => {
  if (!Array.isArray(order)) return;

  haveAppliedOrderFromMain = true;
  if (orderFallbackTimer) {
    clearTimeout(orderFallbackTimer);
    orderFallbackTimer = null;
  }

  const buttons = getTabButtons();
  if (!buttons.length) return;

  const parent = buttons[0].parentNode;
  if (!parent) return;

  const map = new Map(buttons.map((b) => [buttonModel(b), b]));

  order.forEach((model) => {
    const btn = map.get(model);
    if (btn) parent.appendChild(btn);
  });

  wireTabsOnce();
  setActiveTabUI(lastActiveModel);
});

// MAIN -> per-model loading/error state
window.electronAPI.onModelLoadStateChanged((state) => {
  if (!state || !state.model) return;
  updateModelState(state.model, state);
});

// MAIN -> initial state dump
window.electronAPI.onAllModelLoadStates((states) => {
  if (!states || typeof states !== "object") return;
  for (const [model, st] of Object.entries(states)) {
    updateModelState(model, st || {});
  }
});

function wireGlobalRefresh() {
  const btn = document.getElementById("refresh-active");
  if (!btn) return;

  if (btn.dataset.multiAiWired === "1") return;
  btn.dataset.multiAiWired = "1";

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const hard = !!e.shiftKey;
    window.electronAPI.refreshActive(hard);
  });
}

window.addEventListener("DOMContentLoaded", () => {
  injectStyles();
  wireTabsOnce();
  wireGlobalRefresh();
  setActiveTabUI(lastActiveModel);

  // don't overwrite saved order on startup
  orderFallbackTimer = setTimeout(() => {
    if (!haveAppliedOrderFromMain) emitOrderToMain();
  }, 800);
});
