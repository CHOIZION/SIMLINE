import json
import os
import time
import traceback

DEFAULT_CONFIG = {
    'auto_sync_on_save': True,
    'auto_sync_on_load': True,
    'default_scope': 'relevant',
}


def _windows_documents_dir():
    if os.name != 'nt':
        return None
    try:
        import ctypes
        from ctypes import wintypes
        buf = ctypes.create_unicode_buffer(wintypes.MAX_PATH)
        # CSIDL_MYDOCUMENTS = 5
        res = ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf)
        if res == 0 and buf.value:
            return buf.value
    except Exception:
        pass
    return None


def find_ts4_user_dir():
    """Resolve Electronic Arts/The Sims 4 user data folder dynamically."""
    cur = os.path.abspath(__file__)
    for _ in range(10):
        parent = os.path.dirname(cur)
        if not parent or parent == cur:
            break
        if os.path.basename(cur).lower() == 'mods':
            return parent
        cur = parent

    candidates = []
    win_docs = _windows_documents_dir()
    if win_docs:
        candidates.append(os.path.join(win_docs, 'Electronic Arts', 'The Sims 4'))
    home = os.path.expanduser('~')
    if home:
        candidates.append(os.path.join(home, 'Documents', 'Electronic Arts', 'The Sims 4'))
        candidates.append(os.path.join(home, 'OneDrive', 'Documents', 'Electronic Arts', 'The Sims 4'))

    for path in candidates:
        if os.path.isdir(path):
            return path
    return candidates[0] if candidates else os.path.expanduser('~')


def get_sync_dir():
    sync_dir = os.path.join(find_ts4_user_dir(), 'SIMLINE_Sync')
    os.makedirs(sync_dir, exist_ok=True)
    return sync_dir


def get_sync_file():
    return os.path.join(get_sync_dir(), 'simline_sims4_sync.json')


def get_slot_file(slot_id):
    slots_dir = os.path.join(get_sync_dir(), 'slots')
    os.makedirs(slots_dir, exist_ok=True)
    safe_id = ''.join(ch if ch.isalnum() or ch in ('-', '_') else '_' for ch in str(slot_id or 'default'))
    return os.path.join(slots_dir, 'slot_{}.json'.format(safe_id))


def get_config_file():
    return os.path.join(get_sync_dir(), 'simline_sync_config.json')


def get_log_file():
    return os.path.join(get_sync_dir(), 'simline_sync.log')


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    path = get_config_file()
    try:
        if os.path.isfile(path):
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict):
                cfg.update(data)
    except Exception:
        pass
    return cfg


def save_config(cfg):
    merged = dict(DEFAULT_CONFIG)
    merged.update(cfg or {})
    atomic_write_json(get_config_file(), merged)
    return merged


def atomic_write_json(target_path, payload):
    parent = os.path.dirname(target_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp_path = '{}.{}.tmp'.format(target_path, os.getpid())
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, target_path)


def log_message(text, exc=None):
    try:
        log_path = get_log_file()
        if os.path.isfile(log_path) and os.path.getsize(log_path) > 262144:
            backup = log_path + '.old'
            try:
                os.replace(log_path, backup)
            except Exception:
                pass
        stamp = time.strftime('%Y-%m-%d %H:%M:%S')
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write('[{}] {}\n'.format(stamp, text))
            if exc is not None:
                f.write(traceback.format_exc())
                f.write('\n')
    except Exception:
        pass
