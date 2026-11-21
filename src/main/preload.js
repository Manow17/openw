const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openw', {
  call: (method, ...args) => ipcRenderer.invoke('api', method, ...args),
  on: (channel, fn) => {
    if (!['state', 'overlay-config', 'media', 'input-status', 'input-state', 'pad-state', 'progress'].includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => fn(payload));
  },
});
