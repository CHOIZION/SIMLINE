import json
import os
import shutil
import sys
import tempfile
import types
import zipfile


def run_all(ts4script_path):
    assert os.path.isfile(ts4script_path), 'Missing ts4script: ' + ts4script_path

    # Verify ZIP entries & Python 3.7 bytecode magic
    with zipfile.ZipFile(ts4script_path, 'r') as zf:
        names = sorted(zf.namelist())
        assert 'simline_sync/__init__.pyc' in names, names
        assert 'simline_sync/exporter.pyc' in names, names
        assert 'simline_sync/paths.pyc' in names, names
        for name in names:
            data = zf.read(name)
            assert data[:4] == b'\x42\x0d\x0d\x0a', (name, data[:4])

    tmp_root = tempfile.mkdtemp(prefix='simline_ts4_test_')
    try:
        fake_ts4_dir = os.path.join(tmp_root, 'The Sims 4')
        fake_mods_dir = os.path.join(fake_ts4_dir, 'Mods')
        os.makedirs(fake_mods_dir, exist_ok=True)
        staged_mod = os.path.join(fake_mods_dir, 'SIMLINE_Sims4_Sync.ts4script')
        shutil.copy2(ts4script_path, staged_mod)

        # Install clean mock Sims 4 modules
        registered_commands = {}
        command_outputs = []

        sims4_mod = types.ModuleType('sims4')
        sims4_cmd_mod = types.ModuleType('sims4.commands')

        class EnumVal(int):
            def __new__(cls, val, name):
                obj = int.__new__(cls, val)
                obj.name = name
                return obj

        class CommandType:
            Live = 0

        def Command(name, command_type=None):
            def deco(fn):
                registered_commands[name] = fn
                return fn
            return deco

        def CheatOutput(_connection):
            def emit(msg):
                command_outputs.append(str(msg))
            return emit

        sims4_cmd_mod.CommandType = CommandType
        sims4_cmd_mod.Command = Command
        sims4_cmd_mod.CheatOutput = CheatOutput
        sims4_mod.commands = sims4_cmd_mod
        sys.modules['sims4'] = sims4_mod
        sys.modules['sims4.commands'] = sims4_cmd_mod

        ft_pkg = types.ModuleType('family_tree')
        ft_enum_mod = types.ModuleType('family_tree.family_tree_enums')

        class FamilyRelationBitFlags:
            NONE = 0
            PARENT = 1 << 0
            CHILD = 1 << 1
            SPOUSE = 1 << 2
            FIANCE = 1 << 3
            STEADY = 1 << 4
            ADOPTED = 1 << 5

        ft_enum_mod.FamilyRelationBitFlags = FamilyRelationBitFlags
        ft_pkg.family_tree_enums = ft_enum_mod
        sys.modules['family_tree'] = ft_pkg
        sys.modules['family_tree.family_tree_enums'] = ft_enum_mod

        sims_pkg = types.ModuleType('sims')
        sims_gen_mod = types.ModuleType('sims.genealogy_tracker')
        sims_occ_pkg = types.ModuleType('sims.occult')
        sims_occ_mod = types.ModuleType('sims.occult.occult_enums')

        class FamilyRelationshipIndex:
            MOTHER = 0
            FATHER = 1

        class OccultType:
            HUMAN = 1
            ALIEN = 2
            VAMPIRE = 4
            MERMAID = 8
            WITCH = 16

        sims_gen_mod.FamilyRelationshipIndex = FamilyRelationshipIndex
        sims_occ_mod.OccultType = OccultType
        sys.modules['sims'] = sims_pkg
        sys.modules['sims.genealogy_tracker'] = sims_gen_mod
        sys.modules['sims.occult'] = sims_occ_pkg
        sys.modules['sims.occult.occult_enums'] = sims_occ_mod

        # Domain mocks
        class MockGender:
            MALE = EnumVal(4096, 'MALE')
            FEMALE = EnumVal(8192, 'FEMALE')

        class MockAge:
            CHILD = EnumVal(4, 'CHILD')
            YOUNGADULT = EnumVal(16, 'YOUNGADULT')
            ADULT = EnumVal(32, 'ADULT')
            ELDER = EnumVal(64, 'ELDER')

        class MockSpecies:
            HUMAN = EnumVal(1, 'HUMAN')

        class MockDeathType:
            NONE = EnumVal(0, 'NONE')
            OLD_AGE = EnumVal(1, 'OLD_AGE')

        class BitType:
            def __init__(self, name):
                self.__name__ = name

        BIT_DIVORCED = BitType('marital_Divorced')
        BIT_FRIEND = BitType('friendship-friend')
        BIT_BFF = BitType('friendship-bff')

        class FakeEdge:
            def __init__(self, src, dst, flags):
                self.source_sim_id = src
                self.target_sim_id = dst
                self.edge_data = flags

            def has_relation(self, flag):
                return bool(self.edge_data & flag)

        class FakeNode:
            def __init__(self, sim_id, first, last, gender, is_culled=False):
                self.sim_id = sim_id
                self.first_name = first
                self.last_name = last
                self.gender = gender
                self.is_culled = is_culled
                self.outgoing_edges = []

            def get_parents_edges(self):
                return [e for e in self.outgoing_edges if e.has_relation(FamilyRelationBitFlags.CHILD)]

            def get_partner_edges(self):
                return [e for e in self.outgoing_edges if e.has_relation(
                    FamilyRelationBitFlags.SPOUSE | FamilyRelationBitFlags.FIANCE | FamilyRelationBitFlags.STEADY
                )]

        class FakeGenealogy:
            def __init__(self, sim_id, mother_id=None, father_id=None):
                self._id = sim_id
                self._mother = mother_id
                self._father = father_id

            def get_parent_relation(self, rel, allow_invalid_parent=True):
                if rel == FamilyRelationshipIndex.MOTHER:
                    return self._mother
                if rel == FamilyRelationshipIndex.FATHER:
                    return self._father
                return None

            def get_parent_sim_ids(self):
                return [x for x in (self._mother, self._father) if x]

            def get_siblings_sim_ids_gen(self):
                return []

        class FakeTrait:
            is_personality_trait = True
            def __init__(self, name):
                self.__name__ = name

        class FakeCareer:
            def __init__(self, name, level):
                self.__name__ = name
                self.current_track_tuning = self
                self.user_level = level

        class FakeSimInfo:
            def __init__(self, sim_id, first, last, gender, age, hh, played=True, ghost=False, death=MockDeathType.NONE, occult=1, traits=(), careers=(), spouse=None, mother=None, father=None):
                self.sim_id = sim_id
                self.id = sim_id
                self.first_name = first
                self.last_name = last
                self.full_name = first + ' ' + last
                self.gender = gender
                self.age = age
                self.species = MockSpecies.HUMAN
                self.household = hh
                self.is_player_sim = played
                self.is_ghost = ghost
                self.death_type = death
                self.spouse_sim_id = spouse
                self.fiance_sim_id = None
                self.steady_sim_ids = []
                self.occult_tracker = types.SimpleNamespace(occult_types=occult)
                self.trait_tracker = types.SimpleNamespace(personality_traits=list(traits), equipped_traits=[])
                self.career_tracker = types.SimpleNamespace(careers={i: c for i, c in enumerate(careers)})
                self.genealogy = FakeGenealogy(sim_id, mother, father)

        class FakeHousehold:
            def __init__(self, hh_id, name, played=True, active=False):
                self.id = hh_id
                self.name = name
                self.is_played_household = played
                self.is_active_household = active
                self._members = []

            def sim_info_gen(self):
                return iter(self._members)

        class FakeRel:
            def __init__(self, a, b, bits_a=(), bits_b=()):
                self.sim_id_a = a
                self.sim_id_b = b
                self._bits_a = list(bits_a)
                self._bits_b = list(bits_b)

            def get_bits(self, sim_id):
                return self._bits_a if sim_id == self.sim_id_a else self._bits_b

        hh_main = FakeHousehold(9001, 'Kim Family', played=True, active=True)
        hh_npc = FakeHousehold(9002, 'Park Household', played=False, active=False)
        hh_stranger = FakeHousehold(9003, 'Stranger Household', played=False, active=False)

        # IDs: 1=Minsoo Kim, 2=Soyeon Lee (spouse of 1), 3=Jiwon Kim (adopted child of 1&2),
        #      4=Taeho Kim (bio child of 1&99(ex)), 5=Youngja Han (culled mother of 1),
        #      6=Hana Park (ex-spouse of 1), 7=Mina Cho (BFF of 1), 8=Stranger (unrelated)
        sim1 = FakeSimInfo(1, 'Minsoo', 'Kim', MockGender.MALE, MockAge.ADULT, hh_main, played=True,
                           occult=int(OccultType.WITCH), traits=[FakeTrait('trait_Genius')],
                           careers=[FakeCareer('career_Adult_Programmer', 7)], spouse=2, mother=5)
        sim2 = FakeSimInfo(2, 'Soyeon', 'Lee', MockGender.FEMALE, MockAge.ADULT, hh_main, played=True, spouse=1)
        sim3 = FakeSimInfo(3, 'Jiwon', 'Kim', MockGender.FEMALE, MockAge.CHILD, hh_main, played=True, mother=2, father=1)
        sim4 = FakeSimInfo(4, 'Taeho', 'Kim', MockGender.MALE, MockAge.YOUNGADULT, hh_main, played=True, mother=6, father=1)
        sim6 = FakeSimInfo(6, 'Hana', 'Park', MockGender.FEMALE, MockAge.ADULT, hh_npc, played=False)
        sim7 = FakeSimInfo(7, 'Mina', 'Cho', MockGender.FEMALE, MockAge.YOUNGADULT, hh_npc, played=False)
        sim8 = FakeSimInfo(8, 'Random', 'Stranger', MockGender.MALE, MockAge.ADULT, hh_stranger, played=False)

        hh_main._members = [sim1, sim2, sim3, sim4]
        hh_npc._members = [sim6, sim7]
        hh_stranger._members = [sim8]

        node1 = FakeNode(1, 'Minsoo', 'Kim', MockGender.MALE)
        node2 = FakeNode(2, 'Soyeon', 'Lee', MockGender.FEMALE)
        node3 = FakeNode(3, 'Jiwon', 'Kim', MockGender.FEMALE)
        node4 = FakeNode(4, 'Taeho', 'Kim', MockGender.MALE)
        node5 = FakeNode(5, 'Youngja', 'Han', MockGender.FEMALE, is_culled=True)
        node6 = FakeNode(6, 'Hana', 'Park', MockGender.FEMALE)

        node1.outgoing_edges = [
            FakeEdge(1, 5, FamilyRelationBitFlags.CHILD),
            FakeEdge(1, 2, FamilyRelationBitFlags.SPOUSE),
        ]
        node2.outgoing_edges = [FakeEdge(2, 1, FamilyRelationBitFlags.SPOUSE)]
        node3.outgoing_edges = [
            FakeEdge(3, 1, FamilyRelationBitFlags.CHILD | FamilyRelationBitFlags.ADOPTED),
            FakeEdge(3, 2, FamilyRelationBitFlags.CHILD | FamilyRelationBitFlags.ADOPTED),
        ]
        node4.outgoing_edges = [
            FakeEdge(4, 1, FamilyRelationBitFlags.CHILD),
            FakeEdge(4, 6, FamilyRelationBitFlags.CHILD),
        ]

        ft_service = types.SimpleNamespace(
            DIVORCED_SPOUSE_RELATIONSHIP_BIT=BIT_DIVORCED,
            DEAD_SPOUSE_RELATIONSHIP_BIT=None,
            family_tree_graph=types.SimpleNamespace(
                nodes={1: node1, 2: node2, 3: node3, 4: node4, 5: node5, 6: node6}
            )
        )

        rels = [
            FakeRel(1, 6, [BIT_DIVORCED], [BIT_DIVORCED]),
            FakeRel(1, 7, [BIT_BFF], [BIT_FRIEND]),
        ]

        class FakePersistenceService:
            def __init__(self):
                self._manual_save_complete_callbacks = []

            def get_save_slot_proto_buff(self):
                return types.SimpleNamespace(slot_id=7, slot_name='Legacy Save')

            def save_game_gen(self, timeline, save_game_data, *args, **kwargs):
                yield 'step'
                return 0

        ps_instance = FakePersistenceService()

        class Zone:
            def on_loading_screen_animation_finished(self):
                return 'loaded'

        ps_mod = types.ModuleType('services.persistence_service')
        ps_mod.PersistenceService = FakePersistenceService
        zone_mod = types.ModuleType('zone')
        zone_mod.Zone = Zone

        class FakeIndexedManager(dict):
            def get_all(self):
                return list(self.values())

        sim_mgr = FakeIndexedManager({s.sim_id: s for s in (sim1, sim2, sim3, sim4, sim6, sim7, sim8)})
        hh_mgr = FakeIndexedManager({h.id: h for h in (hh_main, hh_npc, hh_stranger)})

        services_mod = types.ModuleType('services')
        services_mod.sim_info_manager = lambda: sim_mgr
        services_mod.household_manager = lambda: hh_mgr
        services_mod.family_tree_service = lambda: ft_service
        services_mod.relationship_service = lambda: rels
        services_mod.get_persistence_service = lambda: ps_instance
        services_mod.active_household = lambda: hh_main
        services_mod.persistence_service = ps_mod

        sys.modules['services'] = services_mod
        sys.modules['services.persistence_service'] = ps_mod
        sys.modules['zone'] = zone_mod

        # Import directly from the compiled .ts4script!
        sys.path.insert(0, staged_mod)
        import simline_sync
        assert 'simline.sync' in registered_commands
        assert 'simline.autosync' in registered_commands
        assert 'simline.scope' in registered_commands
        assert 'simline.status' in registered_commands

        # Test Zone loading hook -> registers persistence callback and runs initial export
        z = Zone()
        assert z.on_loading_screen_animation_finished() == 'loaded'
        assert len(ps_instance._manual_save_complete_callbacks) == 1

        # Test cheat command output (relevant scope)
        registered_commands['simline.sync']('relevant', None)
        assert any('[SIMLINE]' in m for m in command_outputs), command_outputs

        sync_json_path = os.path.join(fake_ts4_dir, 'SIMLINE_Sync', 'simline_sims4_sync.json')
        assert os.path.isfile(sync_json_path), sync_json_path
        with open(sync_json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        assert data['format'] == 'simline-sync'
        assert data['version'] == 1
        assert data['saveSlot'] == {'id': '7', 'name': 'Legacy Save'}
        ids = {s['id']: s for s in data['sims']}
        assert set(ids.keys()) == {'1', '2', '3', '4', '5', '6', '7'}, set(ids.keys())
        assert '8' not in ids  # stranger excluded in relevant scope
        assert ids['5']['isCulled'] is True and ids['5']['isDead'] is True
        assert '마법사' in ids['1']['occults']
        assert any(p['id'] == '1' and p['kind'] == 'adoptive' for p in ids['3']['parents'])
        assert any(r['type'] == 'former' and {r['from'], r['to']} == {'1', '6'} for r in data['relations'])
        assert any(r['type'] == 'friend' and r.get('label') == '절친' and {r['from'], r['to']} == {'1', '7'} for r in data['relations'])

        # Test family scope excludes Mina Cho (friend) but keeps Hana Park (mother of Taeho / ex) & culled Youngja
        payload_fam, _ = simline_sync.run_sync('family')
        fam_ids = {s['id'] for s in payload_fam['sims']}
        assert fam_ids == {'1', '2', '3', '4', '5', '6'}, fam_ids

        # Test all scope includes stranger
        payload_all, _ = simline_sync.run_sync('all')
        all_ids = {s['id'] for s in payload_all['sims']}
        assert '8' in all_ids

        # Test PersistenceService.save_game_gen wrapper returns result intact
        simline_sync._LAST_AUTO_EXPORT_TS = 0.0
        gen = ps_instance.save_game_gen(None, None)
        assert next(gen) == 'step'
        try:
            next(gen)
            assert False, 'Expected StopIteration'
        except StopIteration as stop:
            assert stop.value == 0

        print('TS4_MOD_TESTS_OK')
    finally:
        if sys.path and staged_mod in sys.path:
            sys.path.remove(staged_mod)
        shutil.rmtree(tmp_root, ignore_errors=True)
