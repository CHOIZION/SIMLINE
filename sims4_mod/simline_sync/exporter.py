import datetime
import re
import time

from . import paths

AGE_LABELS = {
    'BABY': '신생아',
    'INFANT': '영아',
    'TODDLER': '유아',
    'CHILD': '어린이',
    'TEEN': '청소년',
    'YOUNGADULT': '청년',
    'ADULT': '성인',
    'ELDER': '노년',
}

SPECIES_LABELS = {
    'HUMAN': '인간',
    'DOG': '강아지',
    'CAT': '고양이',
    'FOX': '여우',
    'HORSE': '말',
}

OCCULT_LABELS = {
    'ALIEN': '외계인',
    'VAMPIRE': '뱀파이어',
    'MERMAID': '인어',
    'WITCH': '마법사',
    'WEREWOLF': '늑대인간',
    'FAIRY': '요정',
}

SOCIAL_BIT_PRIORITY = {
    'spouse': 100,
    'former': 95,
    'fiance': 85,
    'lover': 80,
    'rival': 50,
    'friend': 40,
    'colleague': 30,
}


def _safe_call(obj, attr, *args, default=None):
    try:
        fn = getattr(obj, attr, None)
        if callable(fn):
            return fn(*args)
    except Exception:
        pass
    return default


def _safe_attr(obj, attr, default=None):
    try:
        return getattr(obj, attr, default)
    except Exception:
        return default


def _enum_name(val):
    if val is None:
        return ''
    name = getattr(val, 'name', None)
    if name:
        return str(name)
    return str(val)


def _clean_tuning_name(obj, prefixes):
    if obj is None:
        return ''
    raw = getattr(obj, '__name__', None) or str(obj)
    for prefix in prefixes:
        if raw.startswith(prefix):
            raw = raw[len(prefix):]
            break
    raw = re.sub(r'^_+', '', raw)
    return raw.replace('_', ' ').strip()


def _gender_label(gender_val):
    name = _enum_name(gender_val).upper()
    if 'FEMALE' in name or gender_val == 8192:
        return '여성'
    if 'MALE' in name or gender_val == 4096:
        return '남성'
    return '미지정'


def _extract_occults(sim_info, occult_enum):
    out = []
    tracker = _safe_attr(sim_info, 'occult_tracker')
    if tracker is None or occult_enum is None:
        return out
    types_val = _safe_attr(tracker, 'occult_types')
    if not types_val:
        return out
    try:
        int_val = int(types_val)
    except Exception:
        return out
    for key, label in OCCULT_LABELS.items():
        flag = getattr(occult_enum, key, None)
        if flag is not None:
            try:
                if int_val & int(flag):
                    out.append(label)
            except Exception:
                pass
    return out


def _extract_traits(sim_info):
    traits = []
    seen = set()
    tracker = _safe_attr(sim_info, 'trait_tracker')
    if tracker is None:
        return traits

    sources = []
    p_traits = _safe_attr(tracker, 'personality_traits')
    if p_traits:
        sources.extend(p_traits)
    eq_traits = _safe_attr(tracker, 'equipped_traits')
    if eq_traits:
        for tr in eq_traits:
            if _safe_attr(tr, 'is_personality_trait', False):
                sources.append(tr)

    for tr in sources:
        name = _clean_tuning_name(tr, ('trait_Toddler_', 'trait_Infant_', 'trait_', 'Trait_'))
        if name and name not in seen:
            seen.add(name)
            traits.append(name)
    return traits


def _extract_careers(sim_info):
    out = []
    tracker = _safe_attr(sim_info, 'career_tracker')
    if tracker is None:
        return out
    careers = _safe_attr(tracker, 'careers')
    if not isinstance(careers, dict):
        return out
    for career in careers.values():
        tuning = _safe_attr(career, 'current_track_tuning') or career
        name = _clean_tuning_name(tuning, ('career_Adult_', 'career_Teen_', 'career_Child_', 'career_', 'Career_'))
        level = _safe_attr(career, 'user_level')
        if name:
            if level is not None:
                out.append('{} ({}단계)'.format(name, level))
            else:
                out.append(name)
    return out


def _classify_relbit(bit, ft_service):
    if bit is None:
        return None, None
    divorced_bit = _safe_attr(ft_service, 'DIVORCED_SPOUSE_RELATIONSHIP_BIT') if ft_service else None
    dead_spouse_bit = _safe_attr(ft_service, 'DEAD_SPOUSE_RELATIONSHIP_BIT') if ft_service else None
    if divorced_bit is not None and bit == divorced_bit:
        return 'former', '이혼'
    if dead_spouse_bit is not None and bit == dead_spouse_bit:
        return 'spouse', '사별'

    raw = (getattr(bit, '__name__', None) or str(bit)).lower()
    if any(tok in raw for tok in ('divorced', 'ex_spouse', 'ex-spouse', 'exspouse')):
        return 'former', '이혼'
    if 'dead_spouse' in raw or 'dead-spouse' in raw:
        return 'spouse', '사별'
    if ('spouse' in raw or re.search(r'(^|[^a-z])married($|[^a-z])', raw)) and 'child' not in raw and 'pibl' not in raw and 'grand' not in raw and 'unmarried' not in raw:
        return 'spouse', '배우자'
    if any(tok in raw for tok in ('engaged', 'fiance')):
        return 'fiance', '약혼'
    if any(tok in raw for tok in ('significant_other', 'significant-other', 'steady', 'sweetheart', 'girlfriend', 'boyfriend', 'soulmate', 'romanticcombo_lovers')):
        return 'lover', '연인'
    if any(tok in raw for tok in ('arch_enemy', 'nemesis', 'despised', 'enemy', 'rival')):
        return 'rival', '원수' if 'enemy' in raw or 'nemesis' in raw or 'despised' in raw else '라이벌'
    if any(tok in raw for tok in ('best_friend', 'best-friend', 'bestfriend')) or re.search(r'(^|[^a-z])bff($|[^a-z])', raw):
        return 'friend', '절친'
    if any(tok in raw for tok in ('good_friend', 'good-friend', 'goodfriend')):
        return 'friend', '좋은 친구'
    if re.search(r'(^|[^a-z])friend($|[^a-z])', raw) and 'unfriend' not in raw:
        return 'friend', '친구'
    if any(tok in raw for tok in ('coworker', 'colleague', 'business_partner', 'classmate')):
        return 'colleague', '동료'
    return None, None


def _ensure_sim_entry(sims_map, sim_id):
    sid = str(sim_id)
    entry = sims_map.get(sid)
    if entry is None:
        entry = {
            'id': sid,
            'firstName': '',
            'lastName': '',
            'fullName': '',
            'gender': '미지정',
            'age': '',
            'ageLabel': '',
            'species': 'HUMAN',
            'speciesLabel': '인간',
            'isPlayed': False,
            'isActiveHousehold': False,
            'isDead': False,
            'isGhost': False,
            'deathType': '',
            'isCulled': False,
            'householdId': '',
            'householdName': '',
            'occults': [],
            'traits': [],
            'careers': [],
            'parents': [],
            'spouses': [],
            'formerSpouses': [],
            'partners': [],
            'siblings': [],
        }
        sims_map[sid] = entry
    return entry


def _add_unique_parent(entry, parent_id, kind, role):
    pid = str(parent_id)
    if pid == entry['id']:
        return
    for existing in entry['parents']:
        if existing['id'] == pid:
            if kind == 'adoptive':
                existing['kind'] = 'adoptive'
            if role in ('mother', 'father') and existing.get('role') in ('', 'parent'):
                existing['role'] = role
            return
    entry['parents'].append({'id': pid, 'kind': kind, 'role': role or 'parent'})


def _add_unique_id(lst, val):
    s = str(val)
    if s and s not in lst:
        lst.append(s)


def export_world(scope='relevant', output_path=None):
    import services

    try:
        from family_tree.family_tree_enums import FamilyRelationBitFlags
    except Exception:
        FamilyRelationBitFlags = None
    try:
        from sims.genealogy_tracker import FamilyRelationshipIndex
    except Exception:
        FamilyRelationshipIndex = None
    try:
        from sims.occult.occult_enums import OccultType
    except Exception:
        OccultType = None

    scope = (scope or 'relevant').strip().lower()
    if scope not in ('relevant', 'family', 'all'):
        scope = 'relevant'

    sim_info_manager = _safe_call(services, 'sim_info_manager')
    household_manager = _safe_call(services, 'household_manager')
    ft_service = _safe_call(services, 'family_tree_service')
    rel_service = _safe_call(services, 'relationship_service')
    persistence_service = _safe_call(services, 'get_persistence_service')
    active_hh = _safe_call(services, 'active_household')
    active_hh_id = str(_safe_attr(active_hh, 'id', '') or '')

    save_slot = {'id': '', 'name': ''}
    if persistence_service is not None:
        slot_pb = _safe_call(persistence_service, 'get_save_slot_proto_buff')
        if slot_pb is not None:
            sid_val = _safe_attr(slot_pb, 'slot_id')
            if sid_val is not None:
                save_slot['id'] = str(sid_val)
            sname = _safe_attr(slot_pb, 'slot_name')
            if sname:
                save_slot['name'] = str(sname)

    households_map = {}
    if household_manager is not None:
        hh_iter = _safe_call(household_manager, 'get_all')
        if hh_iter is None:
            if hasattr(household_manager, 'values'):
                hh_iter = household_manager.values()
            elif hasattr(household_manager, '__iter__') and not isinstance(household_manager, dict):
                hh_iter = household_manager
            else:
                hh_iter = []
        for hh in hh_iter:
            hh_id = str(_safe_attr(hh, 'id', '') or '')
            if not hh_id:
                continue
            members = []
            hh_sims = None
            gen_fn = _safe_attr(hh, 'sim_info_gen')
            if callable(gen_fn):
                try:
                    hh_sims = list(gen_fn())
                except Exception:
                    hh_sims = None
            if hh_sims is None:
                try:
                    hh_sims = list(hh)
                except Exception:
                    hh_sims = _safe_attr(hh, '_sim_infos') or []
            for m in hh_sims:
                mid = _safe_attr(m, 'sim_id') or _safe_attr(m, 'id')
                if mid:
                    members.append(str(mid))
            households_map[hh_id] = {
                'id': hh_id,
                'name': str(_safe_attr(hh, 'name', '') or ''),
                'played': bool(_safe_attr(hh, 'is_played_household', False)),
                'active': hh_id == active_hh_id,
                'members': members,
            }

    sims_map = {}
    sim_infos_by_id = {}
    if sim_info_manager is not None:
        all_infos = _safe_call(sim_info_manager, 'get_all')
        if all_infos is None:
            if hasattr(sim_info_manager, 'values'):
                all_infos = sim_info_manager.values()
            elif hasattr(sim_info_manager, '__iter__') and not isinstance(sim_info_manager, dict):
                all_infos = sim_info_manager
            else:
                all_infos = []
        for sim_info in all_infos:
            raw_id = _safe_attr(sim_info, 'sim_id') or _safe_attr(sim_info, 'id')
            if not raw_id:
                continue
            sid = str(raw_id)
            sim_infos_by_id[sid] = sim_info
            entry = _ensure_sim_entry(sims_map, sid)
            first = str(_safe_attr(sim_info, 'first_name', '') or '').strip()
            last = str(_safe_attr(sim_info, 'last_name', '') or '').strip()
            entry['firstName'] = first
            entry['lastName'] = last
            entry['fullName'] = ' '.join(p for p in (first, last) if p) or str(_safe_attr(sim_info, 'full_name', '') or sid)
            entry['gender'] = _gender_label(_safe_attr(sim_info, 'gender'))

            age_code = _enum_name(_safe_attr(sim_info, 'age')).upper()
            entry['age'] = age_code
            entry['ageLabel'] = AGE_LABELS.get(age_code, age_code)

            sp_code = _enum_name(_safe_attr(sim_info, 'species')).upper()
            entry['species'] = sp_code or 'HUMAN'
            entry['speciesLabel'] = SPECIES_LABELS.get(sp_code, sp_code or '인간')

            hh = _safe_attr(sim_info, 'household')
            hh_id = str(_safe_attr(hh, 'id', '') or '') if hh else ''
            entry['householdId'] = hh_id
            entry['householdName'] = str(_safe_attr(hh, 'name', '') or '') if hh else ''
            entry['isPlayed'] = bool(_safe_attr(sim_info, 'is_player_sim', False) or (hh and _safe_attr(hh, 'is_played_household', False)))
            entry['isActiveHousehold'] = bool(hh_id and hh_id == active_hh_id)

            is_ghost = bool(_safe_attr(sim_info, 'is_ghost', False))
            death_type_val = _safe_attr(sim_info, 'death_type')
            death_type_name = _enum_name(death_type_val)
            is_dead = is_ghost or (bool(death_type_val) and death_type_name.upper() != 'NONE')
            entry['isGhost'] = is_ghost
            entry['isDead'] = is_dead
            entry['deathType'] = '' if death_type_name.upper() == 'NONE' else death_type_name

            entry['occults'] = _extract_occults(sim_info, OccultType)
            entry['traits'] = _extract_traits(sim_info)
            entry['careers'] = _extract_careers(sim_info)

            # Fallback parent & partner info directly on SimInfo / GenealogyTracker
            spouse_id = _safe_attr(sim_info, 'spouse_sim_id')
            if spouse_id:
                _add_unique_id(entry['spouses'], spouse_id)
            fiance_id = _safe_attr(sim_info, 'fiance_sim_id')
            if fiance_id:
                if not any(p['id'] == str(fiance_id) for p in entry['partners']):
                    entry['partners'].append({'id': str(fiance_id), 'status': 'fiance'})
            for st_id in (_safe_attr(sim_info, 'steady_sim_ids') or ()):
                st_str = str(st_id)
                if st_str and not any(p['id'] == st_str for p in entry['partners']):
                    entry['partners'].append({'id': st_str, 'status': 'lover'})

            genealogy = _safe_attr(sim_info, 'genealogy')
            if genealogy is not None:
                mother_id = _safe_call(genealogy, 'get_parent_relation', FamilyRelationshipIndex.MOTHER, True) if FamilyRelationshipIndex else None
                father_id = _safe_call(genealogy, 'get_parent_relation', FamilyRelationshipIndex.FATHER, True) if FamilyRelationshipIndex else None
                if mother_id:
                    _add_unique_parent(entry, mother_id, 'biological', 'mother')
                if father_id:
                    _add_unique_parent(entry, father_id, 'biological', 'father')
                if not mother_id and not father_id:
                    for pid in (_safe_call(genealogy, 'get_parent_sim_ids') or ()):
                        if pid:
                            _add_unique_parent(entry, pid, 'biological', 'parent')

    # Merge FamilyTreeGraph nodes (includes culled ancestors and adoption/spouse flags!)
    ft_graph = _safe_attr(ft_service, 'family_tree_graph') if ft_service else None
    ft_nodes = _safe_attr(ft_graph, 'nodes') if ft_graph else None
    if isinstance(ft_nodes, dict):
        for raw_id, node in ft_nodes.items():
            sid = str(raw_id)
            entry = _ensure_sim_entry(sims_map, sid)
            if not entry['firstName']:
                entry['firstName'] = str(_safe_attr(node, 'first_name', '') or '').strip()
            if not entry['lastName']:
                entry['lastName'] = str(_safe_attr(node, 'last_name', '') or '').strip()
            if not entry['fullName'] or entry['fullName'] == sid:
                full = ' '.join(p for p in (entry['firstName'], entry['lastName']) if p)
                if full:
                    entry['fullName'] = full
            if entry['gender'] == '미지정':
                entry['gender'] = _gender_label(_safe_attr(node, 'gender'))
            if bool(_safe_attr(node, 'is_culled', False)):
                entry['isCulled'] = True
                if sid not in sim_infos_by_id:
                    entry['isDead'] = True

            for edge in (_safe_call(node, 'get_parents_edges') or ()):
                parent_id = _safe_attr(edge, 'target_sim_id')
                if not parent_id:
                    continue
                is_adopted = False
                if FamilyRelationBitFlags is not None:
                    is_adopted = bool(_safe_call(edge, 'has_relation', FamilyRelationBitFlags.ADOPTED))
                parent_role = 'parent'
                if str(parent_id) in sims_map:
                    pg = sims_map[str(parent_id)]['gender']
                    if pg == '여성':
                        parent_role = 'mother'
                    elif pg == '남성':
                        parent_role = 'father'
                _add_unique_parent(entry, parent_id, 'adoptive' if is_adopted else 'biological', parent_role)

            for edge in (_safe_call(node, 'get_partner_edges') or ()):
                target_id = _safe_attr(edge, 'target_sim_id')
                if not target_id or str(target_id) == sid:
                    continue
                if FamilyRelationBitFlags is not None:
                    if _safe_call(edge, 'has_relation', FamilyRelationBitFlags.SPOUSE):
                        _add_unique_id(entry['spouses'], target_id)
                    elif _safe_call(edge, 'has_relation', FamilyRelationBitFlags.FIANCE):
                        if not any(p['id'] == str(target_id) for p in entry['partners']):
                            entry['partners'].append({'id': str(target_id), 'status': 'fiance'})
                    elif _safe_call(edge, 'has_relation', FamilyRelationBitFlags.STEADY):
                        if not any(p['id'] == str(target_id) for p in entry['partners']):
                            entry['partners'].append({'id': str(target_id), 'status': 'lover'})

    # Build deduplicated relationship records
    relation_map = {}  # key: (a, b, type) -> record

    def put_relation(src_id, dst_id, rel_type, parent_kind=None, label=None, bit_names=None):
        a = str(src_id)
        b = str(dst_id)
        if not a or not b or a == b:
            return
        if rel_type != 'parent' and a > b:
            a, b = b, a
        key = (a, b, rel_type)
        rec = relation_map.get(key)
        if rec is None:
            rec = {'from': a, 'to': b, 'type': rel_type}
            if parent_kind:
                rec['parentKind'] = parent_kind
            if label:
                rec['label'] = label
            if bit_names:
                rec['bits'] = list(bit_names)
            relation_map[key] = rec
        else:
            if parent_kind == 'adoptive':
                rec['parentKind'] = 'adoptive'
            if label and not rec.get('label'):
                rec['label'] = label
            if bit_names:
                existing = set(rec.get('bits') or ())
                for bn in bit_names:
                    if bn not in existing:
                        existing.add(bn)
                rec['bits'] = sorted(existing)

    # 1) Add family tree parents, spouses, partners
    for sid, entry in sims_map.items():
        for p in entry['parents']:
            put_relation(p['id'], sid, 'parent', parent_kind=p.get('kind', 'biological'))
        for sp_id in entry['spouses']:
            if sp_id in sims_map:
                put_relation(sid, sp_id, 'spouse', label='배우자')
        for pt in entry['partners']:
            pid = pt['id']
            if pid in sims_map:
                put_relation(sid, pid, 'lover', label='약혼' if pt.get('status') == 'fiance' else '연인')

    # 2) Compute siblings from shared parents + GenealogyTracker fallback
    children_by_parent = {}
    for sid, entry in sims_map.items():
        for p in entry['parents']:
            children_by_parent.setdefault(p['id'], set()).add(sid)
    for pid, kids in children_by_parent.items():
        sorted_kids = sorted(kids)
        for i in range(len(sorted_kids)):
            for j in range(i + 1, len(sorted_kids)):
                k1, k2 = sorted_kids[i], sorted_kids[j]
                _add_unique_id(sims_map[k1]['siblings'], k2)
                _add_unique_id(sims_map[k2]['siblings'], k1)
                put_relation(k1, k2, 'sibling')
    for sid, sim_info in sim_infos_by_id.items():
        genealogy = _safe_attr(sim_info, 'genealogy')
        if genealogy is not None:
            for sib_id in (_safe_call(genealogy, 'get_siblings_sim_ids_gen') or ()):
                sib_str = str(sib_id)
                if sib_str in sims_map and sib_str != sid:
                    _add_unique_id(sims_map[sid]['siblings'], sib_str)
                    put_relation(sid, sib_str, 'sibling')

    # 3) Inspect RelationshipService for divorced/romantic/social bits
    if rel_service is not None:
        try:
            all_rels = list(rel_service)
        except Exception:
            all_rels = []
        for rel in all_rels:
            id_a = str(_safe_attr(rel, 'sim_id_a', '') or '')
            id_b = str(_safe_attr(rel, 'sim_id_b', '') or '')
            if not id_a or not id_b or id_a == id_b:
                continue
            if id_a not in sims_map or id_b not in sims_map:
                continue
            bits = []
            for getter_id in (_safe_attr(rel, 'sim_id_a'), _safe_attr(rel, 'sim_id_b')):
                b_list = _safe_call(rel, 'get_bits', getter_id)
                if b_list:
                    bits.extend(b_list)
            best_kind = None
            best_label = None
            best_prio = -1
            raw_bit_names = []
            for b in bits:
                bname = getattr(b, '__name__', None) or str(b)
                kind, label = _classify_relbit(b, ft_service)
                if kind:
                    raw_bit_names.append(bname)
                    prio = SOCIAL_BIT_PRIORITY.get(kind, 10)
                    if prio > best_prio:
                        best_prio = prio
                        best_kind = kind
                        best_label = label
            if best_kind:
                if best_kind == 'fiance':
                    mapped_type = 'lover'
                elif best_kind == 'former':
                    mapped_type = 'former'
                    _add_unique_id(sims_map[id_a]['formerSpouses'], id_b)
                    _add_unique_id(sims_map[id_b]['formerSpouses'], id_a)
                    spouse_key = (min(id_a, id_b), max(id_a, id_b), 'spouse')
                    relation_map.pop(spouse_key, None)
                else:
                    mapped_type = best_kind
                put_relation(id_a, id_b, mapped_type, label=best_label, bit_names=raw_bit_names)

    # 4) Also check archived family relbits (e.g. culled former/dead spouses)
    for sid, sim_info in sim_infos_by_id.items():
        genealogy = _safe_attr(sim_info, 'genealogy')
        if genealogy is not None and hasattr(genealogy, 'archived_relationship_bits_gen'):
            try:
                for target_id, bit_obj, _ts in genealogy.archived_relationship_bits_gen():
                    tid = str(target_id)
                    if tid in sims_map and tid != sid:
                        kind, label = _classify_relbit(bit_obj, ft_service)
                        if kind in ('spouse', 'former'):
                            if kind == 'former':
                                _add_unique_id(sims_map[sid]['formerSpouses'], tid)
                                relation_map.pop((min(sid, tid), max(sid, tid), 'spouse'), None)
                            put_relation(sid, tid, kind, label=label, bit_names=[getattr(bit_obj, '__name__', 'archived')])
            except Exception:
                pass

    # Scope selection
    if scope == 'all':
        included_ids = set(sims_map.keys())
    else:
        from collections import deque
        family_adj = {}
        social_adj = {}
        for r in relation_map.values():
            a, b, rtype = r['from'], r['to'], r['type']
            if rtype in ('parent', 'spouse', 'former', 'sibling') or (rtype == 'lover' and r.get('label') == '약혼'):
                family_adj.setdefault(a, set()).add(b)
                family_adj.setdefault(b, set()).add(a)
            else:
                social_adj.setdefault(a, set()).add(b)
                social_adj.setdefault(b, set()).add(a)

        seeds = {sid for sid, s in sims_map.items() if s['isPlayed'] or s['isActiveHousehold']}
        if not seeds and active_hh_id and active_hh_id in households_map:
            seeds.update(households_map[active_hh_id]['members'])
        if not seeds:
            included_ids = set(sims_map.keys())
        else:
            included_ids = set(seeds)
            queue = deque(seeds)
            while queue:
                cur = queue.popleft()
                for nxt in family_adj.get(cur, ()):
                    if nxt not in included_ids:
                        included_ids.add(nxt)
                        queue.append(nxt)
            if scope == 'relevant':
                base_family = set(included_ids)
                for fid in base_family:
                    for nxt in social_adj.get(fid, ()):
                        included_ids.add(nxt)

    filtered_sims = []
    for sid in sorted(included_ids):
        if sid not in sims_map:
            continue
        s = dict(sims_map[sid])
        s['parents'] = [p for p in s['parents'] if p['id'] in included_ids]
        s['spouses'] = [x for x in s['spouses'] if x in included_ids]
        s['formerSpouses'] = [x for x in s['formerSpouses'] if x in included_ids]
        s['partners'] = [p for p in s['partners'] if p['id'] in included_ids]
        s['siblings'] = [x for x in s['siblings'] if x in included_ids]
        filtered_sims.append(s)

    filtered_relations = [
        r for r in relation_map.values()
        if r['from'] in included_ids and r['to'] in included_ids
    ]
    filtered_households = [
        {
            'id': h['id'],
            'name': h['name'],
            'played': h['played'],
            'active': h['active'],
            'members': [mid for mid in h['members'] if mid in included_ids],
        }
        for h in households_map.values()
        if any(mid in included_ids for mid in h['members'])
    ]

    payload = {
        'format': 'simline-sync',
        'version': 1,
        'game': 'sims4',
        'scope': scope,
        'exportedAt': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'exportedTs': int(time.time()),
        'saveSlot': save_slot,
        'activeHouseholdId': active_hh_id,
        'simCount': len(filtered_sims),
        'relationCount': len(filtered_relations),
        'households': filtered_households,
        'sims': filtered_sims,
        'relations': filtered_relations,
    }

    target_file = output_path or paths.get_sync_file()
    paths.atomic_write_json(target_file, payload)
    if not output_path and save_slot['id']:
        try:
            paths.atomic_write_json(paths.get_slot_file(save_slot['id']), payload)
        except Exception:
            pass
    return payload, target_file
