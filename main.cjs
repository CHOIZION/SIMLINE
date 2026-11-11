const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  nativeImage,
  shell,
  Menu,
} = require("electron");
const path = require("node:path"),
  fs = require("node:fs");
const { Store } = require("./store.cjs");
const Kin = require("./core.js");
const Families = require("./families.js");
if (process.env.INYEON_DATA) app.setPath("userData", process.env.INYEON_DATA);
const sourceQA = !app.isPackaged;
app.setName(sourceQA ? "SIMLINE QA" : "SIMLINE");
if (!process.env.INYEON_DATA)
  app.setPath("userData", path.join(app.getPath("appData"), sourceQA ? "SIMLINE-QA" : "SIMLINE-2.1"));
let win,
  store,
  closing = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    try {
      const dataDir = app.getPath("userData");
      const legacyFile = ["SIMLINE","Inyeon"].map(name=>path.join(app.getPath("appData"),name,"inyeon.sqlite")).find(file=>fs.existsSync(file));
      const databaseFile = path.join(dataDir, "inyeon.sqlite");
      if (
        !sourceQA && !process.env.INYEON_DATA &&
        !fs.existsSync(databaseFile) &&
        legacyFile
      ) {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.copyFileSync(legacyFile, databaseFile, fs.constants.COPYFILE_EXCL);
      }
      store = await new Store().open(dataDir, false);
      if (
        !store.rows("SELECT value FROM meta WHERE key='family-edition'").length
      ) {
        {
          const p=Kin.emptyProject("연결 연습");
          p.mode="unified";
          p.people=["1번","2번","3번"].map((name,i)=>({id:Kin.id(),name,gender:"미지정",groups:[],notes:"",photo:"",subtitle:"",avatar:i}));
          p.focus=p.people[0].id;p.ui={dimUnrelated:false};
          const places=[[0,0],[408,0],[204,224]];
          for(const [i,n] of p.people.entries()){
            const [x,y]=places[i];p.views.unified.positions[n.id]={x,y,pinned:false};
            p.views.network.positions[n.id]={x,y,pinned:false};
          }
          store.create(p);
        }
        store.mutate(() =>
          store.db.run("INSERT INTO meta VALUES('family-edition','2')"),
        );
      }
      if(!store.rows("SELECT value FROM meta WHERE key='unified-edition'").length){
        const list=store.list(), current=store.current();
        const id=list.some(p=>p.id===current)?current:list[0].id;
        const p=store.get(id);p.mode="unified";p.views.unified ||= {positions:{},viewport:null};
        store.save(p,"통합 가계도 열기",false);
        store.mutate(()=>store.db.run("INSERT INTO meta VALUES('unified-edition','2.1')"));
      }
      Menu.setApplicationMenu(null);
      win = new BrowserWindow({
        width: 1536,
        height: 970,
        minWidth: 1080,
        minHeight: 700,
        title: "인연 · 인물 관계도",
        backgroundColor: "#111416",
        icon: path.join(__dirname, "assets", "icon.png"),
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      win.on("close", (e) => {
        if (!closing) {
          e.preventDefault();
          win.webContents.send("request-close");
        }
      });
      await win.loadFile(path.join(__dirname, "index.html"));
    } catch (e) {
      dialog.showErrorBox(
        "인연을 열 수 없습니다",
        e.message + "\n데이터 위치: " + app.getPath("userData"),
      );
      app.exit(1);
    }
  });
  app.on("window-all-closed", () => app.quit());
}
function handle(name, fn) {
  ipcMain.handle(name, async (_, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      console.error(name, e);
      return { ok: false, error: e.message };
    }
  });
}
handle("bootstrap", () => {
  const list = store.list(),
    id = store.current();
  return {
    sourceQA,
    projects: list,
    ...store.load(list.some((p) => p.id === id) ? id : list[0].id),
    dataPath: app.getPath("userData"),
    version: app.getVersion(),
  };
});
handle("list", () => store.list());
handle("load", (id) => {
  store.setCurrent(id);
  return store.load(id);
});
handle("create", (name, demo) => {
  const p =
    demo === "families"
      ? Families.fixture(Kin)
      : demo
        ? Kin.demo()
        : Kin.emptyProject(String(name || "새로운 이야기").slice(0, 100));
  if (demo) p.name = name || p.name;
  if(!demo || demo==="families")p.mode="unified";
  return store.create(p);
});
handle("save", (p, label, history) => store.save(p, label, history));
handle("undo", (id) => store.travel(id, "undo"));
handle("redo", (id) => store.travel(id, "redo"));
handle("delete-project", (id) => {
  if (store.list().length < 2)
    throw Error("마지막 프로젝트는 삭제할 수 없습니다.");
  store.remove(id);
  return store.load(store.list()[0].id);
});
handle("image", async () => {
  const result = await dialog.showOpenDialog(win, {
    title: "인물 사진 선택",
    properties: ["openFile"],
    filters: [{ name: "사진", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  if (result.canceled) return null;
  const file = result.filePaths[0];
  if (fs.statSync(file).size > 25 * 1024 * 1024)
    throw Error("25MB 이하의 이미지를 선택해 주세요.");
  const bytes = fs.readFileSync(file),
    img = nativeImage.createFromBuffer(bytes);
  if (img.isEmpty()) throw Error("이미지를 읽을 수 없습니다.");
  const size = img.getSize();
  if (size.width * size.height > 100000000)
    throw Error("이미지 해상도가 너무 큽니다.");
  const mime = /\.png$/i.test(file)
    ? "png"
    : /\.webp$/i.test(file)
      ? "webp"
      : "jpeg";
  const thumb = img
    .resize(size.width >= size.height ? { width: 640 } : { height: 640 })
    .toPNG();
  return store.addAsset(
    `data:image/${mime};base64,${bytes.toString("base64")}`,
    `data:image/png;base64,${thumb.toString("base64")}`,
    path.basename(file),
  );
});
handle("export-project", async (id) => {
  const p = store.get(id),
    r = await dialog.showSaveDialog(win, {
      title: "프로젝트 백업 / 내보내기",
      defaultPath: p.name.replace(/[<>:"/\\|?*]/g, "_") + ".simline",
      filters: [{ name: "인연 프로젝트 (사진 포함)", extensions: ["simline"] }],
    });
  if (r.canceled) return null;
  store.atomic(r.filePath, JSON.stringify(store.bundle(id)));
  return r.filePath;
});
handle("import-project", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "프로젝트 가져오기 / 백업 복원",
    properties: ["openFile"],
    filters: [
      { name: "인연 프로젝트", extensions: ["simline", "inyeon", "json"] },
    ],
  });
  if (r.canceled) return null;
  if (fs.statSync(r.filePaths[0]).size > 512 * 1024 * 1024)
    throw Error("512MB 이하의 프로젝트를 가져올 수 있습니다.");
  return store.importBundle(
    JSON.parse(fs.readFileSync(r.filePaths[0], "utf8")),
  );
});
handle("export-image", async (name, format, data) => {
  if (!["png", "svg"].includes(format))
    throw Error("지원하지 않는 형식입니다.");
  const r = await dialog.showSaveDialog(win, {
    title: "관계도 이미지 내보내기",
    defaultPath: name.replace(/[<>:"/\\|?*]/g, "_") + "." + format,
    filters: [{ name: format.toUpperCase() + " 이미지", extensions: [format] }],
  });
  if (r.canceled) return null;
  const bytes =
    format === "png"
      ? Buffer.from(data.replace(/^data:image\/png;base64,/, ""), "base64")
      : data;
  store.atomic(r.filePath, bytes);
  return r.filePath;
});
handle("reload-source", () => {
  if(!sourceQA)throw Error("소스 QA에서만 사용할 수 있습니다.");
  setTimeout(()=>{if(win&&!win.isDestroyed())win.webContents.reloadIgnoringCache();},70);
});
handle("data-folder", () => shell.openPath(app.getPath("userData")));
handle("close", () => {
  closing = true;
  win.close();
});
