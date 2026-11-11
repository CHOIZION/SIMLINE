const fs = require("node:fs"),
  path = require("node:path");
(async () => {
  const root = path.resolve(__dirname, ".."),
    out = path.join(root, "dist", "SIMLINE-2.2-win32-x64"),
    appDir = path.join(out, "resources", "app");
  fs.mkdirSync(out, { recursive: true });
  const runtime = path.dirname(require("electron"));
  for (const entry of fs.readdirSync(runtime, { withFileTypes: true })) {
    if (entry.name === "resources") {
      fs.mkdirSync(path.join(out, "resources"), { recursive: true });
      continue;
    }
    if (entry.name === "electron.exe") continue;
    const target = path.join(out, entry.name);
    fs.cpSync(path.join(runtime, entry.name), target, { recursive: true });
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
    "worker.js",
    "app.js",
    "index.html",
    "style.css",
  ])
    fs.copyFileSync(path.join(root, file), path.join(appDir, file));
  fs.cpSync(path.join(root, "assets"), path.join(appDir, "assets"), {
    recursive: true,
  });
  fs.cpSync(
    path.join(root, "node_modules", "sql.js"),
    path.join(appDir, "node_modules", "sql.js"),
    { recursive: true },
  );
  const pkg = require("../package.json");
  delete pkg.devDependencies;
  delete pkg.scripts;
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify(pkg, null, 2),
  );
  fs.copyFileSync(
    path.join(root, "사용안내.txt"),
    path.join(out, "사용안내.txt"),
  );
  const sample=require("../families.js").fixture(require("../core.js"));
  fs.writeFileSync(path.join(out,"예제-F1-F7.simline"),JSON.stringify({format:"inyeon",version:2,project:sample,assets:{}}));
  const sketch = structuredClone(sample);
  sketch.id = require("node:crypto").randomUUID();
  sketch.name = "세 인물의 통합 가계도";
  sketch.description = "P1·P2의 자녀 P3와 P1·P3의 배우자 관계";
  sketch.mode = "unified"; sketch.people = sketch.people.slice(0,3);
  sketch.families = sketch.families.slice(0,2);
  sketch.families[1].births = [];
  sketch.relations = sketch.families.flatMap(require("../families.js").facts);
  fs.writeFileSync(path.join(out,"그림판-세-인물.simline"),JSON.stringify({format:"inyeon",version:2,project:sketch,assets:{}}));
  const RE = await import("resedit"),
    exe = RE.NtExecutable.from(
      fs.readFileSync(path.join(runtime, "electron.exe")),
      { ignoreCert: true },
    ),
    res = RE.NtExecutableResource.from(exe);
  const icons = RE.Data.IconFile.from(
      fs.readFileSync(path.join(root, "assets/icon.ico")),
    ),
    groups = RE.Resource.IconGroupEntry.fromEntries(res.entries);
  for (const group of groups)
    RE.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      group.id,
      group.lang,
      icons.icons.map((i) => i.data),
    );
  for (const vi of RE.Resource.VersionInfo.fromEntries(res.entries)) {
    vi.setFileVersion(2, 2, 0, 0, 1033);
    vi.setProductVersion(2, 2, 0, 0, 1033);
    vi.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        FileDescription: "인연 · 인물 관계도",
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
  console.log("Packaged:", path.join(out, "SIMLINE.exe"));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
