(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Sims4Sync = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const Kin =
    typeof module !== "undefined" && module.exports
      ? require("./core.js")
      : globalThis.Kin;
  const Families =
    typeof module !== "undefined" && module.exports
      ? require("./families.js")
      : globalThis.Families;

  const SYNC_BLOCK_START = "[Sims 4 자동 동기화]";
  const SYNC_BLOCK_END = "[/Sims 4 자동 동기화]";
  const HH_COLORS = [
    "#87add8",
    "#8ebda6",
    "#c8a2da",
    "#d5b779",
    "#e397a5",
    "#8ebbc8",
    "#d48b76",
    "#a893ac",
  ];

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const normalizeName = (s) =>
    String(s || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();

  function hashCode(str) {
    let h = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  function pairKey(a, b, directed) {
    const x = String(a),
      y = String(b);
    if (directed) return x + "->" + y;
    return x < y ? x + ":" + y : y + ":" + x;
  }

  function parsePayload(raw) {
    let data = raw;
    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw.replace(/^\uFEFF/, ""));
      } catch (err) {
        throw Error("심즈 4 동기화 JSON 형식을 읽을 수 없습니다: " + err.message);
      }
    }
    if (
      !data ||
      typeof data !== "object" ||
      data.format !== "simline-sync" ||
      !Array.isArray(data.sims) ||
      !Array.isArray(data.relations)
    ) {
      throw Error(
        "올바른 SIMLINE 심즈 4 동기화 파일(simline-sync)이 아닙니다.",
      );
    }
    return {
      format: data.format,
      version: Number(data.version || 1),
      game: String(data.game || "sims4"),
      scope: String(data.scope || "relevant"),
      exportedAt: String(data.exportedAt || ""),
      saveSlot:
        data.saveSlot && typeof data.saveSlot === "object"
          ? {
              id: String(data.saveSlot.id || ""),
              name: String(data.saveSlot.name || ""),
            }
          : { id: "", name: "" },
      activeHouseholdId: String(data.activeHouseholdId || ""),
      households: Array.isArray(data.households) ? data.households : [],
      sims: data.sims,
      relations: data.relations,
    };
  }

  function buildSubtitle(sim) {
    const parts = [];
    if (sim.isDead) {
      parts.push(sim.isGhost ? "유령" : "고인");
    } else if (sim.ageLabel) {
      parts.push(sim.ageLabel);
    }
    if (Array.isArray(sim.occults) && sim.occults.length) {
      parts.push(sim.occults.join("/"));
    } else if (sim.speciesLabel && sim.species && sim.species !== "HUMAN") {
      parts.push(sim.speciesLabel);
    }
    if (sim.householdName) {
      parts.push(sim.householdName);
    } else if (sim.isCulled) {
      parts.push("가계도 보존");
    }
    return parts.join(" · ");
  }

  function buildSyncNotesBlock(sim, exportedAt) {
    const lines = [SYNC_BLOCK_START];
    const statusParts = [];
    if (sim.ageLabel) statusParts.push(sim.ageLabel);
    if (sim.speciesLabel && sim.species !== "HUMAN")
      statusParts.push(sim.speciesLabel);
    if (Array.isArray(sim.occults) && sim.occults.length)
      statusParts.push(sim.occults.join(", "));
    if (sim.isDead) {
      statusParts.push(
        sim.deathType ? `사망(${sim.deathType})` : "사망",
      );
    }
    if (sim.isCulled) statusParts.push("컬링됨(가계도 보존)");
    if (statusParts.length) lines.push("• 상태: " + statusParts.join(" · "));
    if (sim.householdName) {
      lines.push(
        "• 가구: " +
          sim.householdName +
          (sim.isActiveHousehold
            ? " (현재 활성)"
            : sim.isPlayed
              ? " (플레이)"
              : ""),
      );
    }
    if (Array.isArray(sim.traits) && sim.traits.length) {
      lines.push("• 특성: " + sim.traits.join(", "));
    }
    if (Array.isArray(sim.careers) && sim.careers.length) {
      lines.push("• 직업: " + sim.careers.join(", "));
    }
    if (exportedAt) {
      lines.push("• 동기화: " + exportedAt.replace("T", " ").replace("Z", " UTC"));
    }
    lines.push(SYNC_BLOCK_END);
    return lines.join("\n");
  }

  function mergeNotes(existingNotes, sim, exportedAt, writeSyncBlock) {
    const cur = String(existingNotes || "");
    if (!writeSyncBlock) return cur;
    const block = buildSyncNotesBlock(sim, exportedAt);
    const startIdx = cur.indexOf(SYNC_BLOCK_START);
    const endIdx = cur.indexOf(SYNC_BLOCK_END);
    if (startIdx >= 0 && endIdx >= startIdx) {
      const before = cur.slice(0, startIdx).replace(/\s+$/, "");
      const after = cur.slice(endIdx + SYNC_BLOCK_END.length).replace(/^\s+/, "");
      return [before, block, after].filter(Boolean).join("\n\n");
    }
    if (!cur.trim()) return block;
    return cur.replace(/\s+$/, "") + "\n\n" + block;
  }

  function keepRelationForFilter(rel, simById, filterMode) {
    const t = rel.type;
    if (
      t === "parent" ||
      t === "spouse" ||
      t === "former" ||
      t === "sibling"
    ) {
      return true;
    }
    if (t === "lover" && rel.label === "약혼") return true;
    if (filterMode === "family") return false;
    if (filterMode === "close") {
      if (t === "lover" || t === "rival") return true;
      if (t === "friend") {
        return (
          rel.label === "절친" ||
          rel.label === "좋은 친구" ||
          !!simById.get(rel.from)?.isPlayed ||
          !!simById.get(rel.to)?.isPlayed
        );
      }
      if (t === "colleague") {
        return (
          !!simById.get(rel.from)?.isPlayed ||
          !!simById.get(rel.to)?.isPlayed
        );
      }
      return false;
    }
    return true;
  }

  function selectFilteredDataset(payload, options = {}) {
    const relationFilter = options.relationFilter || "close"; // 'family' | 'close' | 'all'
    const simById = new Map(payload.sims.map((s) => [String(s.id), s]));
    const keptRelations = [];
    const connectedIds = new Set();

    for (const rel of payload.relations) {
      if (
        !rel ||
        !simById.has(String(rel.from)) ||
        !simById.has(String(rel.to)) ||
        String(rel.from) === String(rel.to)
      ) {
        continue;
      }
      if (!Object.hasOwn(Kin.TYPES, rel.type)) continue;
      if (!keepRelationForFilter(rel, simById, relationFilter)) continue;
      keptRelations.push({
        ...rel,
        from: String(rel.from),
        to: String(rel.to),
      });
      connectedIds.add(String(rel.from));
      connectedIds.add(String(rel.to));
    }

    const keptSims = payload.sims.filter((s) => {
      const id = String(s.id);
      if (s.isPlayed || s.isActiveHousehold) return true;
      if (relationFilter === "all") return true;
      return connectedIds.has(id);
    });
    const keptIdSet = new Set(keptSims.map((s) => String(s.id)));

    return {
      sims: keptSims,
      relations: keptRelations.filter(
        (r) => keptIdSet.has(r.from) && keptIdSet.has(r.to),
      ),
      households: payload.households.filter(
        (h) =>
          Array.isArray(h.members) &&
          h.members.some((mid) => keptIdSet.has(String(mid))),
      ),
    };
  }

  function buildPersonMatcher(project, matchByName) {
    const bySimId = new Map();
    const byUniqueName = new Map();
    const nameCounts = new Map();

    for (const p of project.people) {
      const sid =
        p.sims4?.simId ||
        (typeof p.externalId === "string" && p.externalId.startsWith("sims4:")
          ? p.externalId.slice(6)
          : "");
      if (sid) bySimId.set(String(sid), p);
      const nk = normalizeName(p.name);
      if (nk) nameCounts.set(nk, (nameCounts.get(nk) || 0) + 1);
    }

    if (matchByName !== false) {
      for (const p of project.people) {
        const nk = normalizeName(p.name);
        const sid =
          p.sims4?.simId ||
          (typeof p.externalId === "string" && p.externalId.startsWith("sims4:")
            ? p.externalId.slice(6)
            : "");
        if (nk && !sid && nameCounts.get(nk) === 1) {
          byUniqueName.set(nk, p);
        }
      }
    }

    return function match(sim) {
      const sid = String(sim.id);
      if (bySimId.has(sid)) {
        return { person: bySimId.get(sid), matchedBy: "id" };
      }
      const nk = normalizeName(sim.fullName);
      if (nk && byUniqueName.has(nk)) {
        return { person: byUniqueName.get(nk), matchedBy: "name" };
      }
      return { person: null, matchedBy: null };
    };
  }

  function findFreeSpot(occupied, anchor, preferredDx = 0, preferredDy = 0) {
    const startX = (anchor?.x || 0) + preferredDx;
    const startY = (anchor?.y || 0) + preferredDy;
    const isFree = (x, y) => {
      for (const p of occupied) {
        if (Math.abs(p.x - x) < 225 && Math.abs(p.y - y) < 175) return false;
      }
      return true;
    };
    if (isFree(startX, startY)) {
      const spot = { x: Math.round(startX), y: Math.round(startY), pinned: false };
      occupied.push(spot);
      return spot;
    }
    for (let ring = 1; ring <= 14; ring++) {
      for (let i = 0; i < 8 * ring; i++) {
        const angle = (i * Math.PI * 2) / (8 * ring);
        const x = startX + Math.cos(angle) * ring * 255;
        const y = startY + Math.sin(angle) * ring * 195;
        if (isFree(x, y)) {
          const spot = { x: Math.round(x), y: Math.round(y), pinned: false };
          occupied.push(spot);
          return spot;
        }
      }
    }
    const fallback = {
      x: Math.round(startX + occupied.length * 40),
      y: Math.round(startY + occupied.length * 30),
      pinned: false,
    };
    occupied.push(fallback);
    return fallback;
  }

  function applySync(project, rawPayload, options = {}) {
    const payload = parsePayload(rawPayload);
    const dataset = selectFilteredDataset(payload, options);
    const matchByName = options.matchByName !== false;
    const syncNotes = options.syncNotes !== false;
    const syncGroups = options.householdGroups || "played"; // 'played' | 'all' | 'none'

    const next = clone(project);
    Kin.validate(next);
    next.families ||= [];
    next.views ||= {
      network: { positions: {}, viewport: null },
      family: { positions: {}, viewport: null },
      unified: { positions: {}, viewport: null },
    };
    next.views.network ||= { positions: {}, viewport: null };
    next.views.network.positions ||= {};

    const matcher = buildPersonMatcher(next, matchByName);
    const simIdToPersonId = new Map();
    const addedSims = [];
    const updatedSims = [];

    // 1. Household Groups
    const existingGroupsById = new Map(next.groups.map((g) => [g.id, g]));
    const simHhGroupMap = new Map();
    if (syncGroups !== "none") {
      for (const hh of dataset.households) {
        if (!hh || !hh.id || !hh.name) continue;
        if (syncGroups === "played" && !hh.played && !hh.active) continue;
        const gid = "sims4-hh-" + hh.id;
        if (!existingGroupsById.has(gid)) {
          const g = {
            id: gid,
            name: hh.name,
            color: HH_COLORS[hashCode(hh.id) % HH_COLORS.length],
          };
          next.groups.push(g);
          existingGroupsById.set(gid, g);
        } else {
          existingGroupsById.get(gid).name = hh.name;
        }
        simHhGroupMap.set(String(hh.id), gid);
      }
    }

    const buildSims4Meta = (sim, autoSubtitle) => ({
      simId: String(sim.id),
      firstName: sim.firstName || "",
      lastName: sim.lastName || "",
      age: sim.age || "",
      ageLabel: sim.ageLabel || "",
      species: sim.species || "HUMAN",
      isDead: !!sim.isDead,
      isGhost: !!sim.isGhost,
      deathType: sim.deathType || "",
      isCulled: !!sim.isCulled,
      isPlayed: !!sim.isPlayed,
      householdId: sim.householdId || "",
      householdName: sim.householdName || "",
      occults: Array.isArray(sim.occults) ? [...sim.occults] : [],
      traits: Array.isArray(sim.traits) ? [...sim.traits] : [],
      careers: Array.isArray(sim.careers) ? [...sim.careers] : [],
      lastAutoSubtitle: autoSubtitle,
      lastSyncedAt: payload.exportedAt || new Date().toISOString(),
    });

    // 2. Upsert People (never clobbering user photo/crop/positions or non-sync notes!)
    for (const sim of dataset.sims) {
      const sid = String(sim.id);
      const displayName =
        String(sim.fullName || "").trim() ||
        [sim.firstName, sim.lastName].filter(Boolean).join(" ").trim() ||
        "심 " + sid;
      const gender = ["남성", "여성", "미지정"].includes(sim.gender)
        ? sim.gender
        : "미지정";
      const autoSubtitle = buildSubtitle(sim);
      const hhGroupId = sim.householdId
        ? simHhGroupMap.get(String(sim.householdId))
        : null;
      const s4Meta = buildSims4Meta(sim, autoSubtitle);

      const { person, matchedBy } = matcher(sim);
      if (person) {
        simIdToPersonId.set(sid, person.id);
        const prevAutoSub = person.sims4?.lastAutoSubtitle;
        person.name = displayName;
        if (!person.gender || person.gender === "미지정" || gender !== "미지정") {
          person.gender = gender;
        }
        if (!person.subtitle || (prevAutoSub !== undefined && person.subtitle === prevAutoSub)) {
          person.subtitle = autoSubtitle;
        }
        if (hhGroupId) {
          const customGroups = (person.groups || []).filter(
            (gid) => !gid.startsWith("sims4-hh-"),
          );
          person.groups = [...new Set([...customGroups, hhGroupId])];
        }
        person.notes = mergeNotes(person.notes, sim, payload.exportedAt, syncNotes);
        person.externalId = "sims4:" + sid;
        person.sims4 = { ...(person.sims4 || {}), ...s4Meta };
        updatedSims.push({
          personId: person.id,
          simId: sid,
          name: person.name,
          matchedBy,
        });
      } else {
        const pid = "s4p-" + sid;
        simIdToPersonId.set(sid, pid);
        next.people.push({
          id: pid,
          name: displayName,
          subtitle: autoSubtitle,
          gender,
          groups: hhGroupId ? [hhGroupId] : [],
          notes: mergeNotes("", sim, payload.exportedAt, syncNotes),
          photo: "",
          avatar: hashCode(sid) % 8,
          externalId: "sims4:" + sid,
          sims4: s4Meta,
        });
        addedSims.push({
          personId: pid,
          simId: sid,
          name: displayName,
        });
      }
    }

    // 3. Reconstruct Family Units & Relations
    const unionByPair = new Map();
    const parentsOfChild = new Map(); // childPid -> Map<parentPid, parentKind>
    const nonFamilyRels = [];

    const resolvePid = (simId) => simIdToPersonId.get(String(simId)) || null;
    for (const rel of dataset.relations) {
      const fromPid = resolvePid(rel.from);
      const toPid = resolvePid(rel.to);
      if (!fromPid || !toPid || fromPid === toPid) continue;
      if (rel.type === "spouse" || rel.type === "former") {
        const pk = pairKey(fromPid, toPid, false);
        const prev = unionByPair.get(pk);
        // If spouse exists alongside anything else (or active), keep spouse unless explicitly only former
        if (!prev || rel.type === "spouse") {
          unionByPair.set(pk, {
            a: fromPid < toPid ? fromPid : toPid,
            b: fromPid < toPid ? toPid : fromPid,
            union: rel.type,
          });
        }
      } else if (rel.type === "parent") {
        if (!parentsOfChild.has(toPid)) parentsOfChild.set(toPid, new Map());
        const pmap = parentsOfChild.get(toPid);
        const kind =
          rel.parentKind === "adoptive"
            ? "adoptive"
            : rel.parentKind === "guardian"
              ? "guardian"
              : "biological";
        if (!pmap.has(fromPid) || kind === "adoptive") {
          pmap.set(fromPid, kind);
        }
      } else {
        nonFamilyRels.push({ ...rel, fromPid, toPid });
      }
    }

    // Group children under parent pairs/singles
    const familyUnitsMap = new Map(); // famId -> unit spec
    const childCoveredParents = new Set(); // to avoid duplicate direct parent edges
    for (const [childPid, pmap] of parentsOfChild.entries()) {
      const sortedParents = [...pmap.keys()].sort().slice(0, 2);
      if (!sortedParents.length) continue;
      const pk =
        sortedParents.length === 2
          ? pairKey(sortedParents[0], sortedParents[1], false)
          : "single:" + sortedParents[0];
      const famId = "s4fam:" + pk;
      const unionInfo =
        sortedParents.length === 2 ? unionByPair.get(pk) : null;
      let unit = familyUnitsMap.get(famId);
      if (!unit) {
        unit = {
          id: famId,
          parents: sortedParents,
          union: unionInfo ? unionInfo.union : "none",
          children: [],
          edgeKinds: new Map(), // 'parent->child' => kind
        };
        familyUnitsMap.set(famId, unit);
      }
      if (!unit.children.includes(childPid)) unit.children.push(childPid);
      for (const pPid of sortedParents) {
        unit.edgeKinds.set(pPid + "->" + childPid, pmap.get(pPid));
        childCoveredParents.add(pPid + "->" + childPid);
      }
    }

    // Ensure childless married / divorced couples also become family units
    for (const [pk, u] of unionByPair.entries()) {
      const famId = "s4fam:" + pk;
      if (!familyUnitsMap.has(famId)) {
        familyUnitsMap.set(famId, {
          id: famId,
          parents: [u.a, u.b],
          union: u.union,
          children: [],
          edgeKinds: new Map(),
        });
      }
    }

    const personName = (pid) =>
      next.people.find((p) => p.id === pid)?.name || pid;
    const prevFamIds = new Set(
      (next.families || []).map((f) => f.id),
    );
    let newFamilies = 0;
    let updatedFamilies = 0;

    for (const unit of familyUnitsMap.values()) {
      const kinds = [...unit.edgeKinds.values()];
      const defaultKind = kinds.length
        ? kinds.every((k) => k === "adoptive")
          ? "adoptive"
          : "biological"
        : "biological";
      const parentKinds = {};
      for (const [edgeKey, kind] of unit.edgeKinds.entries()) {
        if (kind !== defaultKind) {
          const [pPid, cPid] = edgeKey.split("->");
          const rowId = [
            "family",
            unit.id,
            "parent",
            pPid,
            cPid,
          ]
            .map(encodeURIComponent)
            .join(":");
          parentKinds[rowId] = kind;
        }
      }
      const births = unit.children.length
        ? [
            {
              id: "s4b:" + unit.id,
              date: "",
              children: unit.children,
            },
          ]
        : [];
      const famObj = {
        id: unit.id,
        name: unit.parents.map(personName).join(" · ") + " 가족",
        parents: unit.parents,
        union: unit.union,
        parentKind: defaultKind,
        start: "",
        end: "",
        births,
        ...(Object.keys(parentKinds).length ? { parentKinds } : {}),
      };
      if (prevFamIds.has(unit.id)) updatedFamilies++;
      else newFamilies++;
      Families.save(next, famObj);
    }

    // Remove stale s4rel entries before re-adding cleanly, while checking existing manual relations
    const prevManualRels = next.relations.filter(
      (r) => typeof r.id === "string" && !r.id.startsWith("s4rel:"),
    );
    const existingManualKeys = new Set(
      prevManualRels.map(
        (r) =>
          r.type +
          ":" +
          pairKey(r.from, r.to, !!Kin.TYPES[r.type]?.directed),
      ),
    );

    // Precompute sibling pairs already implied inside synced/existing family units
    const siblingPairsInFamilies = new Set();
    for (const f of next.families || []) {
      const kids = (f.births || []).flatMap((b) => b.children || []);
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          siblingPairsInFamilies.add(pairKey(kids[i], kids[j], false));
        }
      }
    }

    const oldS4RelIds = new Set(
      next.relations
        .filter((r) => typeof r.id === "string" && r.id.startsWith("s4rel:"))
        .map((r) => r.id),
    );
    next.relations = prevManualRels;

    const addedRelIds = new Set();
    let newRelations = 0;
    for (const rel of nonFamilyRels) {
      const isDirected = !!Kin.TYPES[rel.type]?.directed;
      const pk = pairKey(rel.fromPid, rel.toPid, isDirected);
      if (rel.type === "sibling" && siblingPairsInFamilies.has(pk)) {
        continue; // Already structurally modeled via shared family parents!
      }
      if (existingManualKeys.has(rel.type + ":" + pk)) {
        continue;
      }
      const rid = "s4rel:" + rel.type + ":" + pk;
      if (addedRelIds.has(rid)) continue;
      addedRelIds.add(rid);
      if (!oldS4RelIds.has(rid)) newRelations++;
      next.relations.push({
        id: rid,
        from: isDirected || rel.fromPid < rel.toPid ? rel.fromPid : rel.toPid,
        to: isDirected || rel.fromPid < rel.toPid ? rel.toPid : rel.fromPid,
        type: rel.type,
        label: rel.label || "",
        notes: "",
      });
    }

    // Handle extra parents if a child had >2 parents in weird mods (fallback direct parent rel)
    for (const [childPid, pmap] of parentsOfChild.entries()) {
      for (const [pPid, kind] of pmap.entries()) {
        if (childCoveredParents.has(pPid + "->" + childPid)) continue;
        const pk = pairKey(pPid, childPid, true);
        if (existingManualKeys.has("parent:" + pk)) continue;
        const rid = "s4rel:parent:" + pk;
        if (addedRelIds.has(rid)) continue;
        addedRelIds.add(rid);
        next.relations.push({
          id: rid,
          from: pPid,
          to: childPid,
          type: "parent",
          parentKind: kind,
          label: "",
          notes: "",
        });
      }
    }

    // 4. Position ONLY newly added cards cleanly near connected relatives (keep existing card positions intact!)
    const posMap = next.views.network.positions;
    const occupied = Object.values(posMap).map((p) => ({ x: p.x, y: p.y }));
    const adj = new Map();
    for (const r of next.relations) {
      if (!adj.has(r.from)) adj.set(r.from, []);
      if (!adj.has(r.to)) adj.set(r.to, []);
      adj.get(r.from).push({ other: r.to, rel: r, dir: "out" });
      adj.get(r.to).push({ other: r.from, rel: r, dir: "in" });
    }
    for (const item of addedSims) {
      const pid = item.personId;
      if (posMap[pid]) continue;
      let anchor = null;
      let dx = 280;
      let dy = 0;
      for (const edge of adj.get(pid) || []) {
        if (posMap[edge.other]) {
          anchor = posMap[edge.other];
          if (edge.rel.type === "parent") {
            dx = 0;
            dy = edge.dir === "in" ? 215 : -215; // child below parent, parent above child
          } else if (edge.rel.type === "spouse" || edge.rel.type === "former") {
            dx = 265;
            dy = 0;
          } else {
            dx = 265;
            dy = 120;
          }
          break;
        }
      }
      posMap[pid] = findFreeSpot(occupied, anchor, dx, dy);
    }

    if (!next.focus && next.people.length) {
      const activeSim = dataset.sims.find((s) => s.isActiveHousehold || s.isPlayed);
      next.focus =
        (activeSim && simIdToPersonId.get(String(activeSim.id))) ||
        next.people[0].id;
    }

    next.revision = Number(next.revision || 0) + 1;
    Kin.validate(next);

    return {
      project: next,
      summary: {
        totalInFile: payload.sims.length,
        includedSims: dataset.sims.length,
        newSims: addedSims.length,
        updatedSims: updatedSims.length,
        matchedByName: updatedSims.filter((u) => u.matchedBy === "name").length,
        newFamilies,
        updatedFamilies,
        newRelations,
        saveSlotName: payload.saveSlot.name || "",
        saveSlotId: payload.saveSlot.id || "",
        exportedAt: payload.exportedAt || "",
        scope: payload.scope || "relevant",
      },
      addedSims,
      updatedSims,
    };
  }

  function previewSync(project, rawPayload, options = {}) {
    const res = applySync(project, rawPayload, options);
    return {
      summary: res.summary,
      addedSims: res.addedSims,
      updatedSims: res.updatedSims,
    };
  }

  return {
    SYNC_BLOCK_START,
    SYNC_BLOCK_END,
    parsePayload,
    buildSubtitle,
    buildSyncNotesBlock,
    mergeNotes,
    previewSync,
    applySync,
  };
});
