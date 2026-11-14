const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const initSqlJs = require("sql.js");
const Kin = require("./core.js");
class Store {
  async open(directory, seed = true) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, "inyeon.sqlite");
    this.SQL = await initSqlJs({
      locateFile: (f) => path.join(path.dirname(require.resolve("sql.js")), f),
    });
    let bytes = fs.existsSync(this.file)
      ? fs.readFileSync(this.file)
      : undefined;
    try {
      this.db = new this.SQL.Database(bytes);
      this.db.exec("PRAGMA integrity_check");
    } catch (e) {
      if (fs.existsSync(this.file + ".previous")) {
        this.db = new this.SQL.Database(
          fs.readFileSync(this.file + ".previous"),
        );
        this.recovered = true;
      } else throw e;
    }
    this.db.run(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,document TEXT NOT NULL,updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history(seq INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,stack TEXT NOT NULL,document TEXT NOT NULL,label TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,data TEXT NOT NULL,thumb TEXT NOT NULL,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    if (seed && !this.list().length) this.create(Kin.demo());
    this.persist();
    return this;
  }
  rows(sql, args = []) {
    const s = this.db.prepare(sql);
    try {
      s.bind(args);
      const out = [];
      while (s.step()) out.push(s.getAsObject());
      return out;
    } finally {
      s.free();
    }
  }
  atomic(file, bytes) {
    const temp = file + ".tmp";
    const fd = fs.openSync(temp, "w");
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
  }
  persist() {
    if (fs.existsSync(this.file) && !this.recovered)
      this.atomic(this.file + ".previous", fs.readFileSync(this.file));
    this.atomic(this.file, Buffer.from(this.db.export()));
    this.recovered = false;
  }
  mutate(fn) {
    const before = this.db.export();
    try {
      this.db.run("BEGIN");
      const v = fn();
      this.db.run("COMMIT");
      this.persist();
      return v;
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {}
      this.db.close();
      this.db = new this.SQL.Database(before);
      this.db.run("PRAGMA foreign_keys=ON");
      throw e;
    }
  }
  list() {
    return this.rows(
      "SELECT id,name,updated,document FROM projects ORDER BY updated DESC",
    ).map((r) => {
      const p = JSON.parse(r.document);
      return {
        id: r.id,
        name: r.name,
        updated: r.updated,
        people: p.people.length,
        relations: p.relations.length,
      };
    });
  }
  current() {
    const r = this.rows("SELECT value FROM meta WHERE key='current'")[0];
    return r?.value;
  }
  setCurrent(id) {
    this.mutate(() =>
      this.db.run("INSERT OR REPLACE INTO meta VALUES('current',?)", [id]),
    );
  }
  get(id) {
    const r = this.rows("SELECT document FROM projects WHERE id=?", [id])[0];
    if (!r) throw Error("프로젝트를 찾을 수 없습니다.");
    return JSON.parse(r.document);
  }
  assetsFor(p, full = false) {
    const ids = new Set();
    function collect(n) {
      if (n.photo) ids.add(n.photo);
      for (const a of n.mergedProfiles || []) collect(a);
    }
    p.people.forEach(collect);
    const result = {};
    for (const id of ids) {
      const r = this.rows("SELECT * FROM assets WHERE id=?", [id])[0];
      if (r)
        result[id] = full
          ? { data: r.data, thumb: r.thumb, name: r.name }
          : r.thumb;
    }
    return result;
  }
  load(id) {
    const p = this.get(id);
    return {
      project: p,
      assets: this.assetsFor(p),
      history: this.historyInfo(id),
    };
  }
  historyInfo(id) {
    return {
      undo:
        this.rows(
          "SELECT label FROM history WHERE project_id=? AND stack='undo' ORDER BY seq DESC LIMIT 1",
          [id],
        )[0]?.label || null,
      redo:
        this.rows(
          "SELECT label FROM history WHERE project_id=? AND stack='redo' ORDER BY seq DESC LIMIT 1",
          [id],
        )[0]?.label || null,
    };
  }
  checkAssets(p) {
    for (const n of p.people)
      if (
        n.photo &&
        !this.rows("SELECT id FROM assets WHERE id=?", [n.photo]).length
      )
        throw Error("인물 사진이 누락되었습니다.");
  }
  create(p) {
    Kin.validate(p);
    this.checkAssets(p);
    this.mutate(() => {
      this.db.run("INSERT INTO projects VALUES(?,?,?,?)", [
        p.id,
        p.name,
        JSON.stringify(p),
        new Date().toISOString(),
      ]);
      this.db.run("INSERT OR REPLACE INTO meta VALUES('current',?)", [p.id]);
    });
    return this.load(p.id);
  }
  save(p, label = "편집", history = true) {
    Kin.validate(p);
    this.checkAssets(p);
    const old = this.get(p.id);
    p = Kin.clone(p);
    p.revision = (old.revision || 0) + 1;
    this.mutate(() => {
      if (history) {
        this.db.run(
          "INSERT INTO history(project_id,stack,document,label) VALUES(?,'undo',?,?)",
          [p.id, JSON.stringify(old), label],
        );
        this.db.run("DELETE FROM history WHERE project_id=? AND stack='redo'", [
          p.id,
        ]);
        this.db.run(
          "DELETE FROM history WHERE project_id=? AND stack='undo' AND seq NOT IN (SELECT seq FROM history WHERE project_id=? AND stack='undo' ORDER BY seq DESC LIMIT 60)",
          [p.id, p.id],
        );
      }
      this.db.run(
        "UPDATE projects SET name=?,document=?,updated=? WHERE id=?",
        [p.name, JSON.stringify(p), new Date().toISOString(), p.id],
      );
    });
    return { revision: p.revision, history: this.historyInfo(p.id) };
  }
  travel(id, direction) {
    const current = this.get(id),
      r = this.rows(
        "SELECT * FROM history WHERE project_id=? AND stack=? ORDER BY seq DESC LIMIT 1",
        [id, direction],
      )[0];
    if (!r) return this.load(id);
    const p = JSON.parse(r.document);
    p.revision = (current.revision || 0) + 1;
    this.mutate(() => {
      this.db.run(
        "INSERT INTO history(project_id,stack,document,label) VALUES(?,?,?,?)",
        [
          id,
          direction === "undo" ? "redo" : "undo",
          JSON.stringify(current),
          r.label,
        ],
      );
      this.db.run("DELETE FROM history WHERE seq=?", [r.seq]);
      this.db.run(
        "UPDATE projects SET name=?,document=?,updated=? WHERE id=?",
        [p.name, JSON.stringify(p), new Date().toISOString(), id],
      );
    });
    return this.load(id);
  }
  addAsset(data, thumb, name) {
    if (!validImage(data) || !validImage(thumb))
      throw Error("지원하지 않는 이미지입니다.");
    const id = crypto.createHash("sha256").update(data).digest("hex");
    this.mutate(() =>
      this.db.run("INSERT OR IGNORE INTO assets VALUES(?,?,?,?)", [
        id,
        data,
        thumb,
        String(name),
      ]),
    );
    return { id, data: thumb };
  }
  bundle(id) {
    const p = this.get(id);
    return {
      format: "inyeon",
      version: 2,
      exportedAt: new Date().toISOString(),
      project: p,
      assets: this.assetsFor(p, true),
    };
  }
  importBundle(bundle) {
    if (
      !bundle ||
      bundle.format !== "inyeon" ||
      ![1, 2].includes(bundle.version)
    )
      throw Error("인연 프로젝트 파일이 아닙니다.");
    const p = Kin.clone(bundle.project);
    Kin.validate(p);
    p.id = Kin.id();
    p.name += " · 가져옴";
    p.revision = 0;
    const assets = bundle.assets || {};
    for (const [key, value] of Object.entries(assets))
      if (
        !/^[a-f0-9]{64}$/.test(key) ||
        !value ||
        !validImage(value.data) ||
        !validImage(value.thumb) ||
        crypto.createHash("sha256").update(value.data).digest("hex") !== key
      )
        throw Error("이미지 데이터가 손상되었습니다.");
    for (const n of p.people)
      if (n.photo && !assets[n.photo])
        throw Error("백업에서 인물 사진을 찾을 수 없습니다.");
    this.mutate(() => {
      for (const [key, v] of Object.entries(assets))
        this.db.run("INSERT OR IGNORE INTO assets VALUES(?,?,?,?)", [
          key,
          v.data,
          v.thumb,
          String(v.name || "image"),
        ]);
      this.db.run("INSERT INTO projects VALUES(?,?,?,?)", [
        p.id,
        p.name,
        JSON.stringify(p),
        new Date().toISOString(),
      ]);
      this.db.run("INSERT OR REPLACE INTO meta VALUES('current',?)", [p.id]);
    });
    return this.load(p.id);
  }
  remove(id) {
    this.mutate(() => this.db.run("DELETE FROM projects WHERE id=?", [id]));
  }
}
function validImage(s) {
  return (
    typeof s === "string" &&
    s.length < 60 * 1024 * 1024 &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s)
  );
}
module.exports = { Store, validImage };
