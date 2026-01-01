const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  switchModel: (modelName) => ipcRenderer.send("switch-model", modelName),

  setModelOrder: (order) => ipcRenderer.send("set-model-order", order),

  refreshActive: (hard = false) => ipcRenderer.send("refresh-active", { hard: !!hard }),

  refreshModel: (modelName, hard = false) =>
    ipcRenderer.send("refresh-model", { modelName, hard: !!hard }),

  stopModel: (modelName) =>
    ipcRenderer.send("stop-model", { modelName }),

  onActiveModelChanged: (callback) => {
    ipcRenderer.on("active-model-changed", (_event, modelName) => callback(modelName));
  },

  onModelOrderChanged: (callback) => {
    ipcRenderer.on("model-order-changed", (_event, order) => callback(order));
  },

  onModelLoadStateChanged: (callback) => {
    ipcRenderer.on("model-load-state-changed", (_event, state) => callback(state));
  },

  onAllModelLoadStates: (callback) => {
    ipcRenderer.on("all-model-load-states", (_event, states) => callback(states));
  }
});
