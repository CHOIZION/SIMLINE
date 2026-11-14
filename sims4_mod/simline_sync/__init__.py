import functools
import time

from . import exporter, paths

_HOOKS_INSTALLED = False
_LAST_AUTO_EXPORT_TS = 0.0
_LAST_EXPORT_SUMMARY = None


def _register_persistence_callback():
    try:
        import services
        ps = services.get_persistence_service()
        if ps is not None:
            cbs = getattr(ps, '_manual_save_complete_callbacks', None)
            if cbs is not None and _on_manual_save_complete not in cbs:
                cbs.append(_on_manual_save_complete)
    except Exception as exc:
        paths.log_message('register_persistence_callback error: {}'.format(exc), exc)


def _trigger_auto_export(reason):
    global _LAST_AUTO_EXPORT_TS, _LAST_EXPORT_SUMMARY
    try:
        cfg = paths.load_config()
        if reason == 'save' and not cfg.get('auto_sync_on_save', True):
            return None
        if reason == 'load' and not cfg.get('auto_sync_on_load', True):
            return None

        now = time.monotonic()
        if now - _LAST_AUTO_EXPORT_TS < 2.0:
            return None

        import services
        sim_mgr = services.sim_info_manager()
        if sim_mgr is None:
            return None

        scope = cfg.get('default_scope', 'relevant')
        payload, target_file = exporter.export_world(scope=scope)
        _LAST_AUTO_EXPORT_TS = time.monotonic()
        _LAST_EXPORT_SUMMARY = {
            'reason': reason,
            'exportedAt': payload.get('exportedAt'),
            'simCount': payload.get('simCount'),
            'relationCount': payload.get('relationCount'),
            'path': target_file,
        }
        paths.log_message(
            'Auto export ({}) OK: {} sims, {} relations -> {}'.format(
                reason, payload.get('simCount'), payload.get('relationCount'), target_file
            )
        )
        return payload
    except Exception as exc:
        paths.log_message('Auto export ({}) failed: {}'.format(reason, exc), exc)
        return None


def _on_manual_save_complete():
    _trigger_auto_export('save')


def run_sync(scope='relevant'):
    global _LAST_AUTO_EXPORT_TS, _LAST_EXPORT_SUMMARY
    payload, target_file = exporter.export_world(scope=scope)
    _LAST_AUTO_EXPORT_TS = time.monotonic()
    _LAST_EXPORT_SUMMARY = {
        'reason': 'manual',
        'exportedAt': payload.get('exportedAt'),
        'simCount': payload.get('simCount'),
        'relationCount': payload.get('relationCount'),
        'path': target_file,
    }
    paths.log_message(
        'Manual export ({}) OK: {} sims, {} relations -> {}'.format(
            scope, payload.get('simCount'), payload.get('relationCount'), target_file
        )
    )
    return payload, target_file


def install_hooks():
    global _HOOKS_INSTALLED
    if _HOOKS_INSTALLED:
        return True
    try:
        import services.persistence_service as persistence_mod
        import zone as zone_mod

        PersistenceService = getattr(persistence_mod, 'PersistenceService', None)
        if PersistenceService is not None and hasattr(PersistenceService, 'save_game_gen'):
            orig_save_gen = PersistenceService.save_game_gen
            if not getattr(orig_save_gen, '_simline_wrapped', False):
                @functools.wraps(orig_save_gen)
                def _wrapped_save_game_gen(self, timeline, save_game_data, *args, **kwargs):
                    result = yield from orig_save_gen(self, timeline, save_game_data, *args, **kwargs)
                    try:
                        if int(result) == 0:
                            _trigger_auto_export('save')
                    except Exception as exc:
                        paths.log_message('save_game_gen hook error: {}'.format(exc), exc)
                    return result

                _wrapped_save_game_gen._simline_wrapped = True
                PersistenceService.save_game_gen = _wrapped_save_game_gen

        Zone = getattr(zone_mod, 'Zone', None)
        if Zone is not None and hasattr(Zone, 'on_loading_screen_animation_finished'):
            orig_on_load = Zone.on_loading_screen_animation_finished
            if not getattr(orig_on_load, '_simline_wrapped', False):
                @functools.wraps(orig_on_load)
                def _wrapped_on_loading_finished(self, *args, **kwargs):
                    result = orig_on_load(self, *args, **kwargs)
                    _register_persistence_callback()
                    _trigger_auto_export('load')
                    return result

                _wrapped_on_loading_finished._simline_wrapped = True
                Zone.on_loading_screen_animation_finished = _wrapped_on_loading_finished

        _HOOKS_INSTALLED = True
        paths.log_message('SIMLINE Sims 4 Sync initialized. Sync dir: {}'.format(paths.get_sync_dir()))
        return True
    except Exception as exc:
        paths.log_message('install_hooks skipped/error: {}'.format(exc), exc)
        return False


def _register_commands():
    try:
        import sims4.commands
    except Exception:
        return

    @sims4.commands.Command('simline.sync', command_type=sims4.commands.CommandType.Live)
    def simline_sync_cmd(scope: str = 'relevant', _connection=None):
        output = sims4.commands.CheatOutput(_connection)
        try:
            payload, target_file = run_sync(scope=scope)
            output(
                '[SIMLINE] 동기화 완료 ({}): 심 {}명 / 관계 {}건\n파일: {}'.format(
                    payload.get('scope'), payload.get('simCount'), payload.get('relationCount'), target_file
                )
            )
        except Exception as exc:
            paths.log_message('simline.sync command failed: {}'.format(exc), exc)
            output('[SIMLINE] 동기화 오류: {}'.format(exc))

    @sims4.commands.Command('simline.export', command_type=sims4.commands.CommandType.Live)
    def simline_export_cmd(scope: str = 'relevant', _connection=None):
        simline_sync_cmd(scope=scope, _connection=_connection)

    @sims4.commands.Command('simline.autosync', command_type=sims4.commands.CommandType.Live)
    def simline_autosync_cmd(mode: str = 'status', _connection=None):
        output = sims4.commands.CheatOutput(_connection)
        cfg = paths.load_config()
        arg = (mode or 'status').strip().lower()
        if arg in ('on', 'true', '1'):
            cfg['auto_sync_on_save'] = True
            cfg['auto_sync_on_load'] = True
            paths.save_config(cfg)
        elif arg in ('off', 'false', '0'):
            cfg['auto_sync_on_save'] = False
            cfg['auto_sync_on_load'] = False
            paths.save_config(cfg)
        elif arg == 'toggle':
            new_state = not bool(cfg.get('auto_sync_on_save', True))
            cfg['auto_sync_on_save'] = new_state
            cfg['auto_sync_on_load'] = new_state
            paths.save_config(cfg)
        output(
            '[SIMLINE] 자동 동기화: 저장 시={} / 로드 시={} / 기본 범위={}'.format(
                '켜짐' if cfg.get('auto_sync_on_save', True) else '꺼짐',
                '켜짐' if cfg.get('auto_sync_on_load', True) else '꺼짐',
                cfg.get('default_scope', 'relevant'),
            )
        )

    @sims4.commands.Command('simline.scope', command_type=sims4.commands.CommandType.Live)
    def simline_scope_cmd(scope: str = 'status', _connection=None):
        output = sims4.commands.CheatOutput(_connection)
        cfg = paths.load_config()
        val = (scope or 'status').strip().lower()
        if val in ('relevant', 'family', 'all'):
            cfg['default_scope'] = val
            paths.save_config(cfg)
            output('[SIMLINE] 기본 내보내기 범위가 "{}" 로 설정되었습니다.'.format(val))
        else:
            output('[SIMLINE] 현재 범위: {} (사용 가능: relevant, family, all)'.format(cfg.get('default_scope', 'relevant')))

    @sims4.commands.Command('simline.status', command_type=sims4.commands.CommandType.Live)
    def simline_status_cmd(_connection=None):
        output = sims4.commands.CheatOutput(_connection)
        cfg = paths.load_config()
        output('[SIMLINE] 동기화 파일: {}'.format(paths.get_sync_file()))
        output('[SIMLINE] 자동 동기화: 저장={}, 로드={}'.format(cfg.get('auto_sync_on_save'), cfg.get('auto_sync_on_load')))
        if _LAST_EXPORT_SUMMARY:
            output(
                '[SIMLINE] 최근 내보내기: {} / 심 {}명 / 관계 {}건 ({})'.format(
                    _LAST_EXPORT_SUMMARY.get('reason'),
                    _LAST_EXPORT_SUMMARY.get('simCount'),
                    _LAST_EXPORT_SUMMARY.get('relationCount'),
                    _LAST_EXPORT_SUMMARY.get('exportedAt'),
                )
            )


install_hooks()
_register_commands()
