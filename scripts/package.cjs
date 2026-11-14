const fs = require("node:fs");
const path = require("node:path");

function resolveElectronRuntime(root) {
  try {
    return { dir: path.dirname(require("electron")), fromFallback: false };
  } catch {
    const candidates = [
      process.env.SIMLINE_RUNTIME_DIR || "",
      "C:\\Users\\czion\\Desktop\\SIMLINE",
    ].filter(Boolean);
    for (const dir of candidates) {
      if (
        fs.existsSync(path.join(dir, "SIMLINE.exe")) ||
        fs.existsSync(path.join(dir, "electron.exe"))
      ) {
        return { dir, fromFallback: true };
      }
    }
    throw Error(
      "Electron runtime not found. Install dependencies or set SIMLINE_RUNTIME_DIR.",
    );
  }
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const shortVer = String(pkg.version || "2.3.0")
    .split(".")
    .slice(0, 2)
    .join(".");
  const out = path.join(root, "dist", `SIMLINE-${shortVer}-win32-x64`);
  const appDir = path.join(out, "resources", "app");

  if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const { dir: runtime } = resolveElectronRuntime(root);
  const skipRuntimeNames = new Set([
    "electron.exe",
    "SIMLINE.exe",
    "resources",
    "사용안내.txt",
    "예제-F1-F7.simline",
    "그림판-세-인물.simline",
    "SIMLINE_Sims4_Sync.ts4script",
  ]);
  for (const entry of fs.readdirSync(runtime, { withFileTypes: true })) {
    if (entry.name === "resources") {
      fs.mkdirSync(path.join(out, "resources"), { recursive: true });
      continue;
    }
    if (skipRuntimeNames.has(entry.name)) continue;
    fs.cpSync(path.join(runtime, entry.name), path.join(out, entry.name), {
      recursive: true,
    });
  }

  fs.mkdirSync(appDir, { recursive: true });
  for (const file of [
    "families.js",
    "unified.js",
    "family-ui.js",
    "editor.js",
    "editor.css",
    "family.css",
    "main.cjs",
    "preload.cjs",
    "store.cjs",
    "core.js",
    "sims4-sync.js",
    "sims4-host.cjs",
    "worker.js",
    "app.js",
    "index.html",
    "style.css",
  ]) {
    fs.copyFileSync(path.join(root, file), path.join(appDir, file));
  }

  fs.cpSync(path.join(root, "assets"), path.join(appDir, "assets"), {
    recursive: true,
  });

  const localSqlJs = path.join(root, "node_modules", "sql.js");
  const fallbackSqlJs = path.join(
    runtime,
    "resources",
    "app",
    "node_modules",
    "sql.js",
  );
  const sqlJsSrc = fs.existsSync(localSqlJs) ? localSqlJs : fallbackSqlJs;
  if (!fs.existsSync(sqlJsSrc)) {
    throw Error("sql.js module not found.");
  }
  fs.cpSync(sqlJsSrc, path.join(appDir, "node_modules", "sql.js"), {
    recursive: true,
  });

  const appPkg = { ...pkg };
  delete appPkg.devDependencies;
  delete appPkg.scripts;
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify(appPkg, null, 2),
  );

  fs.copyFileSync(
    path.join(root, "사용안내.txt"),
    path.join(out, "사용안내.txt"),
  );

  const builtMod = path.join(root, "dist", "SIMLINE_Sims4_Sync.ts4script");
  if (fs.existsSync(builtMod)) {
    fs.copyFileSync(builtMod, path.join(out, "SIMLINE_Sims4_Sync.ts4script"));
  }

  const sample = require("../families.js").fixture(require("../core.js"));
  fs.writeFileSync(
    path.join(out, "예제-F1-F7.simline"),
    JSON.stringify({ format: "inyeon", version: 2, project: sample, assets: {} }),
  );
  const sketch = structuredClone(sample);
  sketch.id = require("node:crypto").randomUUID();
  sketch.name = "세 인물의 통합 가계도";
  sketch.description = "P1·P2의 자녀 P3와 P1·P3의 배우자 관계";
  sketch.mode = "unified";
  sketch.people = sketch.people.slice(0, 3);
  sketch.families = sketch.families.slice(0, 2);
  sketch.families[1].births = [];
  sketch.relations = sketch.families.flatMap(require("../families.js").facts);
  fs.writeFileSync(
    path.join(out, "그림판-세-인물.simline"),
    JSON.stringify({ format: "inyeon", version: 2, project: sketch, assets: {} }),
  );

  const rawExe = fs.existsSync(path.join(runtime, "electron.exe"))
    ? path.join(runtime, "electron.exe")
    : path.join(runtime, "SIMLINE.exe");
  let packagedExeWritten = false;
  try {
    const RE = await import("resedit");
    const exe = RE.NtExecutable.from(fs.readFileSync(rawExe), {
      ignoreCert: true,
    });
    const res = RE.NtExecutableResource.from(exe);
    const icons = RE.Data.IconFile.from(
      fs.readFileSync(path.join(root, "assets/icon.ico")),
    );
    for (const group of RE.Resource.IconGroupEntry.fromEntries(res.entries)) {
      RE.Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        group.id,
        group.lang,
        icons.icons.map((i) => i.data),
      );
    }
    const [maj = 2, min = 3, pat = 0] = pkg.version.split(".").map(Number);
    for (const vi of RE.Resource.VersionInfo.fromEntries(res.entries)) {
      vi.setFileVersion(maj, min, pat, 0, 1033);
      vi.setProductVersion(maj, min, pat, 0, 1033);
      vi.setStringValues(
        { lang: 1033, codepage: 1200 },
        {
          FileDescription: "인연 · 인물 관계도 (Sims 4 연동)",
          ProductName: "SIMLINE 인연",
          CompanyName: "Inyeon",
          OriginalFilename: "SIMLINE.exe",
          InternalName: "SIMLINE",
          LegalCopyright: "Inyeon 2026",
        },
      );
      vi.outputToResourceEntries(res.entries);
    }
    res.outputResource(exe);
    fs.writeFileSync(path.join(out, "SIMLINE.exe"), Buffer.from(exe.generate()));
    packagedExeWritten = true;
  } catch {
    // resedit unavailable: runtime SIMLINE.exe already carries resources & icon
  }
  if (!packagedExeWritten) {
    fs.copyFileSync(rawExe, path.join(out, "SIMLINE.exe"));
  }
  console.log("Packaged:", path.join(out, "SIMLINE.exe"));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
