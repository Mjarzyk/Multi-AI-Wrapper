const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  switchModel: (modelName) => ipcRenderer.send("switch-model", modelName),

  setModelOrder: (order) => ipcRenderer.send("set-model-order", order),

  onActiveModelChanged: (callback) => {
    ipcRenderer.on("active-model-changed", (_event, modelName) => callback(modelName));
  },

  onModelOrderChanged: (callback) => {
    ipcRenderer.on("model-order-changed", (_event, order) => callback(order));
  }
});
