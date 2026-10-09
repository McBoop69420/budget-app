const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("budgetBridge", {
  saveBackup: (json) => ipcRenderer.invoke("budget:save-backup", json),
  openBackupFolder: () => ipcRenderer.invoke("budget:open-backups")
});
