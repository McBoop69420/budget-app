const { app, BrowserWindow, ipcMain, shell, screen } = require("electron");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const KEEP_DATED_BACKUPS = 30;

const windowStateFile = () => path.join(app.getPath("userData"), "window-state.json");
const backupDir = () => path.join(app.getPath("userData"), "backups");

function localIsoDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowStateFile(), "utf8"));
  } catch {
    return {};
  }
}

function saveWindowState(window) {
  try {
    const bounds = window.getNormalBounds();
    fs.writeFileSync(windowStateFile(), JSON.stringify({ ...bounds, isMaximized: window.isMaximized() }));
  } catch {
    // Losing window state is not worth interrupting shutdown.
  }
}

// A saved position only makes sense if some part of the window is actually on a
// connected display. RDP sessions and resolution changes leave stale coords that
// park the window entirely off-screen, with no way for the user to reach it.
// Note: Chromium's screen module reports phantom layouts (e.g. the physical
// ultrawide instead of the active RDP display), so we resolve the real layout
// through the Win32/GDI path (monitors.ps1) and only fall back to Chromium.
const monitorRectsPs1 = path.join(__dirname, "monitors.ps1");

function gdiMonitorRects() {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", monitorRectsPs1],
      { timeout: 8000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve(null);
        const rects = [];
        for (const line of String(stdout).split(/\r?\n/)) {
          const parts = line.trim().split(",").map(Number);
          if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
            rects.push({ x: parts[0], y: parts[1], width: parts[2] - parts[0], height: parts[3] - parts[1] });
          }
        }
        resolve(rects.length > 0 ? rects : null);
      }
    );
  });
}

function chromiumMonitorRects() {
  try {
    return screen.getAllDisplays().map(({ bounds }) => bounds);
  } catch {
    return null;
  }
}

function rectIsOnAnyDisplay(x, y, width, height, rects) {
  return rects.some((bounds) => {
    const overlapX = Math.min(x + width, bounds.x + bounds.width) - Math.max(x, bounds.x);
    const overlapY = Math.min(y + height, bounds.y + bounds.height) - Math.max(y, bounds.y);
    return overlapX >= 40 && overlapY >= 40;
  });
}

function centeredOnDisplay(rect, width, height) {
  return {
    x: Math.max(rect.x, Math.round(rect.x + (rect.width - width) / 2)),
    y: Math.max(rect.y, Math.round(rect.y + (rect.height - height) / 2))
  };
}

async function windowPosition(saved, width, height) {
  if (saved.x !== undefined && saved.y !== undefined) {
    const rects = (await gdiMonitorRects()) || chromiumMonitorRects();
    if (rects && rectIsOnAnyDisplay(saved.x, saved.y, width, height, rects)) {
      return { x: saved.x, y: saved.y };
    }
  }
  const rects = (await gdiMonitorRects()) || chromiumMonitorRects();
  const primary = (rects && rects[0]) || { x: 0, y: 0, width: 1920, height: 1080 };
  return centeredOnDisplay(primary, width, height);
}

async function createWindow() {
  const saved = loadWindowState();
  const width = saved.width || 1280;
  const height = saved.height || 820;
  const pos = await windowPosition(saved, width, height);
  const window = new BrowserWindow({
    width,
    height,
    x: pos.x,
    y: pos.y,
    minWidth: 980,
    minHeight: 680,
    title: "BudgetApp",
    backgroundColor: "#f5f6f8",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (saved.isMaximized) window.maximize();
  window.on("close", () => saveWindowState(window));

  window.loadFile(path.join(__dirname, "index.html"));

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("budget:save-backup", async (_event, json) => {
  const dir = backupDir();
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, "budgetapp-latest.json"), json);
  await fs.promises.writeFile(path.join(dir, `budgetapp-${localIsoDate()}.json`), json);
  const dated = (await fs.promises.readdir(dir))
    .filter((name) => /^budgetapp-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();
  await Promise.all(dated.slice(0, -KEEP_DATED_BACKUPS).map((name) => fs.promises.unlink(path.join(dir, name))));
});

ipcMain.handle("budget:open-backups", async () => {
  await fs.promises.mkdir(backupDir(), { recursive: true });
  shell.openPath(backupDir());
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
