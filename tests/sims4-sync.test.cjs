const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const Kin = require("../core.js");
const Sims4Sync = require("../sims4-sync.js");
const Sims4Host = require("../sims4-host.cjs");

function makeSamplePayload() {
  return {
    format: "simline-sync",
    version: 1,
    game: "sims4",
    scope: "relevant",
    exportedAt: "2026-11-14T08:00:00Z",
    saveSlot: { id: "7", name: "3대 가계도" },
    activeHouseholdId: "9001",
    households: [
      {
        id: "9001",
        name: "김씨 본가",
        played: true,
        active: true,
        members: ["1", "2", "3"],
      },
      {
        id: "9002",
        name: "박씨 가구",
        played: false,
        active: false,
        members: ["6", "7", "8"],
      },
    ],
    sims: [
      {
        id: "1",
        firstName: "민수",
        lastName: "김",
        fullName: "김 민수",
        gender: "남성",
        age: "ADULT",
        ageLabel: "성인",
        species: "HUMAN",
        speciesLabel: "인간",
        isPlayed: true,
        isActiveHousehold: true,
        isDead: false,
        isGhost: false,
        isCulled: false,
        householdId: "9001",
        householdName: "김씨 본가",
        occults: ["마법사"],
        traits: ["Genius", "Creative"],
        careers: ["Programmer (7단계)"],
      },
      {
        id: "2",
        firstName: "소연",
        lastName: "이",
        fullName: "이 소연",
        gender: "여성",
        age: "ADULT",
        ageLabel: "성인",
        species: "HUMAN",
        speciesLabel: "인간",
        isPlayed: true,
        isActiveHousehold: true,
        isDead: false,
        isGhost: false,
        isCulled: false,
        householdId: "9001",
        householdName: "김씨 본가",
        occults: [],
        traits: ["Good"],
        careers: [],
      },
      {
        id: "3",
        firstName: "지원",
        lastName: "김",
        fullName: "김 지원",
        gender: "여성",
        age: "CHILD",
        ageLabel: "어린이",
        species: "HUMAN",
        speciesLabel: "인간",
        isPlayed: true,
        isActiveHousehold: true,
        isDead: false,
        isGhost: false,
        isCulled: false,
        householdId: "9001",
        householdName: "김씨 본가",
        occults: [],
        traits: ["Cheerful"],
        careers: [],
      },
      {
        id: "4",
        firstName: "태호",
        lastName: "김",
        fullName: "김 태호",
        gender: "남성",
        age: "YOUNGADULT",
        ageLabel: "청년",
        species: "HUMAN",
        speciesLabel: "인간",
        isPlayed: true,
        isActiveHousehold: false,
        isDead: false,
        isGhost: false,
        isCulled: false,
        householdId: "9001",
        householdName: "김씨 본가",
        occults: [],
        traits: [],
        careers: [],
      },
      {
        id: "5",
        firstName: "영자",
        lastName: "한",
        fullName: "한 영자",
        gender: "여성",
        age: "",
        ageLabel: "",
        species: "HUMAN",
        speciesLabel: "인간",
        isPlayed: false,
        isActiveHousehold: false,
        isDead: true,
        isGhost: false,
        isCulled: true,
        householdId: "",
        householdName: "",
        occults: [],
        traits: [],
        careers: [],
      },
      {
        id: "6",
        firstName: "하나",
        lastName: "박",
        fullName: "박 하나",
        gender: "여성",
        age: "ADULT",
        ageLabel: "성인",
        species: "HUMAN",
        speciesLabel: "인간",
        isPlayed: false,
        isActiveHousehold: false,
        isDead: false,
        isGhost: false,
        isCulled: false,
        householdId: "9002",
        householdName: "박씨 가구",
        occults: [],
        traits: [],
        careers: [],
      },
      {
        id: "7",
        firstName: "미나",
        lastName: "조",
        fullName: "조 미나",
        gender: "여성",
        age: "YOUNGADULT",
        ageLabel: "청년",
        species: "HUMAN",
        speciesLabel: "인간",
        isPlayed: false,
        isActiveHousehold: false,
        isDead: false,
        isGhost: false,
        isCulled: false,
        householdId: "9002",
        householdName: "박씨 가구",
        occults: [],
        traits: [],
        careers: [],
      },
      {
        id: "8",
        firstName: "철수",
        lastName: "강",
        fullName: "강 철수",
        gender: "남성",
        age: "ADULT",
        ageLabel: "성인",
        species: "HUMAN",
        speciesLabel: "인간",
        isPlayed: false,
        isActiveHousehold: false,
        isDead: false,
        isGhost: false,
        isCulled: false,
        householdId: "9002",
        householdName: "박씨 가구",
        occults: [],
        traits: [],
        careers: [],
      },
    ],
    relations: [
      { from: "5", to: "1", type: "parent", parentKind: "biological" },
      { from: "1", to: "2", type: "spouse", label: "배우자" },
      { from: "1", to: "6", type: "former", label: "이혼" },
      { from: "1", to: "3", type: "parent", parentKind: "adoptive" },
      { from: "2", to: "3", type: "parent", parentKind: "adoptive" },
      { from: "1", to: "4", type: "parent", parentKind: "biological" },
      { from: "2", to: "4", type: "parent", parentKind: "biological" },
      { from: "1", to: "7", type: "friend", label: "절친" },
      { from: "7", to: "8", type: "colleague", label: "동료" },
    ],
  };
}

test("parsePayload handles BOM and rejects invalid payloads", () => {
  const payload = makeSamplePayload();
  const parsed = Sims4Sync.parsePayload("\uFEFF" + JSON.stringify(payload));
  assert.equal(parsed.format, "simline-sync");
  assert.equal(parsed.sims.length, 8);
  assert.throws(() => Sims4Sync.parsePayload("{}"), /simline-sync/);
});

test("applySync builds valid families, preserves bio+adoptive parentKinds, and filters scope cleanly", () => {
  const empty = Kin.emptyProject("테스트 족보");
  const payload = makeSamplePayload();

  // Family-only mode excludes Mina (friend) & Cheolsu (NPC colleague), keeps 6 family sims
  const famPreview = Sims4Sync.previewSync(empty, payload, {
    relationFilter: "family",
  });
  assert.equal(famPreview.summary.newSims, 6);
  assert.equal(empty.people.length, 0); // preview did not mutate

  const res = Sims4Sync.applySync(empty, payload, { relationFilter: "close" });
  assert.equal(res.summary.newSims, 7); // Minsoo, Soyeon, Jiwon, Taeho, Youngja, Hana, Mina (excludes NPC-to-NPC Cheolsu)
  Kin.validate(res.project);

  // Mixed biological (Taeho) & adoptive (Jiwon) under couple (1, 2) inside valid family unit
  const coupleFam = res.project.families.find(
    (f) => f.parents.includes("s4p-1") && f.parents.includes("s4p-2"),
  );
  assert.ok(coupleFam);
  assert.equal(coupleFam.union, "spouse");
  const adoptiveEdge = res.project.relations.find(
    (r) => r.from === "s4p-1" && r.to === "s4p-3" && r.type === "parent",
  );
  const bioEdge = res.project.relations.find(
    (r) => r.from === "s4p-1" && r.to === "s4p-4" && r.type === "parent",
  );
  assert.equal(adoptiveEdge.parentKind, "adoptive");
  assert.equal(bioEdge.parentKind, "biological");

  // Ex-spouse Hana is linked via former family unit
  assert.ok(
    res.project.relations.some(
      (r) =>
        r.type === "former" &&
        ((r.from === "s4p-1" && r.to === "s4p-6") ||
          (r.from === "s4p-6" && r.to === "s4p-1")),
    ),
  );
});

test("applySync preserves user photo, position, manual notes, custom subtitle, and prevents duplicates on resync", () => {
  const base = Kin.emptyProject("유저 커스텀 족보");
  base.people.push({
    id: "custom-minsoo",
    name: "김 민수",
    subtitle: "내가 직접 적은 별명",
    gender: "남성",
    groups: [],
    notes: "1대 창업주 메모 (절대 지우면 안 됨)",
    photo: "asset-hash-123",
    avatar: 2,
    crop: { x: 10, y: -5, zoom: 1.4 },
  });
  base.views.network.positions["custom-minsoo"] = { x: 420, y: -180, pinned: true };

  const first = Sims4Sync.applySync(base, makeSamplePayload());
  assert.equal(first.summary.matchedByName, 1);
  const minsoo = first.project.people.find((p) => p.id === "custom-minsoo");
  assert.equal(minsoo.photo, "asset-hash-123");
  assert.deepEqual(minsoo.crop, { x: 10, y: -5, zoom: 1.4 });
  assert.deepEqual(first.project.views.network.positions["custom-minsoo"], {
    x: 420,
    y: -180,
    pinned: true,
  });
  assert.equal(minsoo.subtitle, "내가 직접 적은 별명");
  assert.ok(minsoo.notes.includes("1대 창업주 메모 (절대 지우면 안 됨)"));
  assert.ok(minsoo.notes.includes(Sims4Sync.SYNC_BLOCK_START));
  assert.equal(minsoo.externalId, "sims4:1");

  // Second sync: Minsoo renamed/aged up in game, custom note above block remains intact!
  const p2 = makeSamplePayload();
  p2.sims[0].age = "ELDER";
  p2.sims[0].ageLabel = "노년";
  p2.sims[0].careers = ["Tech Guru (10단계)"];
  const second = Sims4Sync.applySync(first.project, p2);
  assert.equal(second.summary.newSims, 0);
  const minsoo2 = second.project.people.find((p) => p.id === "custom-minsoo");
  assert.ok(minsoo2.notes.includes("1대 창업주 메모 (절대 지우면 안 됨)"));
  assert.ok(minsoo2.notes.includes("Tech Guru (10단계)"));
  assert.equal(
    minsoo2.notes.split(Sims4Sync.SYNC_BLOCK_START).length - 1,
    1,
  );
});

test("sims4-host detects mod and sync file inside fake Sims 4 directory", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "simline-host-"));
  const oldEnv = process.env.SIMLINE_TS4_DIR;
  try {
    const ts4 = path.join(tmp, "Electronic Arts", "The Sims 4");
    const mods = path.join(ts4, "Mods", "Subfolder");
    const syncDir = path.join(ts4, "SIMLINE_Sync");
    fs.mkdirSync(mods, { recursive: true });
    fs.mkdirSync(syncDir, { recursive: true });
    fs.writeFileSync(path.join(mods, "SIMLINE_Sims4_Sync.ts4script"), "zip");
    const syncFile = path.join(syncDir, "simline_sims4_sync.json");
    fs.writeFileSync(syncFile, JSON.stringify(makeSamplePayload()));

    process.env.SIMLINE_TS4_DIR = ts4;
    const env = Sims4Host.detectEnvironment(tmp);
    assert.equal(env.ts4Exists, true);
    assert.equal(env.modInstalled, true);
    assert.equal(env.syncExists, true);
    assert.equal(env.simCount, 8);
    assert.equal(env.saveSlotName, "3대 가계도");

    const loaded = Sims4Host.readSyncFile(syncFile);
    assert.equal(loaded.payload.sims.length, 8);
  } finally {
    if (oldEnv === undefined) delete process.env.SIMLINE_TS4_DIR;
    else process.env.SIMLINE_TS4_DIR = oldEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
