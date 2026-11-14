const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parsePayload } = require("./sims4-sync.js");

function findSims4UserDir(electronDocsDir = "") {
  const roots = [
    process.env.SIMLINE_TS4_DIR || "",
    electronDocsDir ? path.join(electronDocsDir, "Electronic Arts", "The Sims 4") : "",
    path.join(os.homedir(), "Documents", "Electronic Arts", "The Sims 4"),
    path.join(os.homedir(), "OneDrive", "Documents", "Electronic Arts", "The Sims 4"),
  ].filter(Boolean);
  for (const dir of roots) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  return roots[0] || path.join(os.homedir(), "Documents", "Electronic Arts", "The Sims 4");
}

function hasModInstalled(modsDir) {
  if (!modsDir || !fs.existsSync(modsDir)) return false;
  const checkDir = (dir, depth) => {
    if (depth > 2) return false;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const ent of entries) {
      if (ent.isFile() && /simline.*\.ts4script$/i.test(ent.name)) return true;
      if (ent.isDirectory() && checkDir(path.join(dir, ent.name), depth + 1)) return true;
    }
    return false;
  };
  return checkDir(modsDir, 0);
}

function detectEnvironment(electronDocsDir = "") {
  const ts4Dir = findSims4UserDir(electronDocsDir);
  const syncDir = path.join(ts4Dir, "SIMLINE_Sync");
  const syncFile = path.join(syncDir, "simline_sims4_sync.json");
  const modsDir = path.join(ts4Dir, "Mods");
  const screenshotsDir = path.join(ts4Dir, "Screenshots");
  let syncExists = false;
  let syncMtimeMs = 0;
  let simCount = 0;
  let relationCount = 0;
  let saveSlotName = "";
  let exportedAt = "";
  if (fs.existsSync(syncFile)) {
    try {
      const st = fs.statSync(syncFile);
      syncExists = st.isFile();
      syncMtimeMs = st.mtimeMs;
      if (syncExists && st.size <= 64 * 1024 * 1024) {
        const parsed = parsePayload(fs.readFileSync(syncFile, "utf8"));
        simCount = parsed.sims.length;
        relationCount = parsed.relations.length;
        saveSlotName = parsed.saveSlot?.name || "";
        exportedAt = parsed.exportedAt || "";
      }
    } catch {
      // Keep status non-fatal if file is still being replaced or malformed
    }
  }
  return {
    ts4Dir,
    ts4Exists: fs.existsSync(ts4Dir),
    syncDir,
    syncFile,
    syncExists,
    syncMtimeMs,
    simCount,
    relationCount,
    saveSlotName,
    exportedAt,
    modsDir,
    modInstalled: hasModInstalled(modsDir),
    screenshotsDir,
    screenshotsExists: fs.existsSync(screenshotsDir),
  };
}

function readSyncFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw Error("심즈 4 동기화 파일(simline_sims4_sync.json)을 찾을 수 없습니다.");
  }
  const st = fs.statSync(filePath);
  if (!st.isFile()) throw Error("동기화 파일 경로가 올바르지 않습니다.");
  if (st.size > 64 * 1024 * 1024) throw Error("64MB 이하의 동기화 파일만 읽을 수 있습니다.");
  const payload = parsePayload(fs.readFileSync(filePath, "utf8"));
  return {
    filePath,
    mtimeMs: st.mtimeMs,
    payload,
  };
}

function listScreenshots(screenshotsDir, nativeImage, limit = 48) {
  if (!screenshotsDir || !fs.existsSync(screenshotsDir)) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(screenshotsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = entries
    .filter((e) => e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name))
    .map((e) => {
      const fullPath = path.join(screenshotsDir, e.name);
      try {
        const st = fs.statSync(fullPath);
        return { name: e.name, path: fullPath, mtimeMs: st.mtimeMs, size: st.size };
      } catch {
        return null;
      }
    })
    .filter((x) => x && x.size <= 25 * 1024 * 1024)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);

  const items = [];
  for (const f of files) {
    try {
      const img = nativeImage.createFromPath(f.path);
      if (img.isEmpty()) continue;
      const sz = img.getSize();
      const thumb = img.resize(sz.width >= sz.height ? { width: 220 } : { height: 220 });
      items.push({
        name: f.name,
        path: f.path,
        mtimeMs: f.mtimeMs,
        width: sz.width,
        height: sz.height,
        previewUrl: `data:image/jpeg;base64,${thumb.toJPEG(82).toString("base64")}`,
      });
    } catch {
      // Skip unreadable images safely
    }
  }
  return items;
}

function createSyncWatcher(syncDir, onChange) {
  let watcher = null;
  let timer = null;
  let closed = false;
  const trigger = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!closed) onChange();
    }, 350);
  };
  const tryStart = () => {
    if (closed || watcher) return true;
    if (!fs.existsSync(syncDir)) return false;
    try {
      watcher = fs.watch(syncDir, (_, filename) => {
        if (!filename || /simline_sims4_sync\.json/i.test(String(filename))) {
          trigger();
        }
      });
      watcher.on("error", () => {
        try {
          watcher?.close();
        } catch {}
        watcher = null;
      });
      return true;
    } catch {
      return false;
    }
  };

  tryStart();
  const pollMissingTimer = setInterval(() => {
    if (closed) return;
    if (!watcher) {
      if (tryStart() && fs.existsSync(path.join(syncDir, "simline_sims4_sync.json"))) {
        trigger();
      }
    }
  }, 4000);
  pollMissingTimer.unref?.();

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      clearInterval(pollMissingTimer);
      try {
        watcher?.close();
      } catch {}
      watcher = null;
    },
  };
}

module.exports = {
  findSims4UserDir,
  hasModInstalled,
  detectEnvironment,
  readSyncFile,
  listScreenshots,
  createSyncWatcher,
};
