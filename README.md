# SIMLINE (인연)

집안 족보와 인물 관계도를 한눈에 정리할 수 있는 데스크톱 앱(Electron + SQLite)입니다.  
**v2.3.0**부터 **The Sims 4 (`SIMLINE_Sims4_Sync.ts4script`)** 가계도·인물 정보·스샷 연동 기능을 지원합니다.

## 심즈 4 연동 사용법

1. `SIMLINE_Sims4_Sync.ts4script` 파일을 `문서\Electronic Arts\The Sims 4\Mods\` 폴더(하위 1단계 권장)에 복사합니다.
2. 심즈 4 게임 설정 → 기타에서 **스크립트 모드 허용**을 켠 뒤 게임을 실행합니다.
3. 게임을 **저장**하거나 `Ctrl+Shift+C` 치트 창에 `simline.sync`를 입력하면 `문서\Electronic Arts\The Sims 4\SIMLINE_Sync\simline_sims4_sync.json`이 생성됩니다.
   - 추가 명령어: `simline.sync all` / `simline.sync family` / `simline.autosync off|on` / `simline.status`
4. `SIMLINE.exe`를 실행하고 상단 **심즈 4 연동** 버튼을 누르면 변경 미리보기 후 현재 관계도에 반영할 수 있습니다.
   - 기존 SIMLINE 카드의 **사진·자르기·배치·수동 메모**는 덮어쓰지 않고 보존됩니다.
   - 인물 편집 모달의 **심즈 4 스샷** 버튼으로 `Screenshots` 폴더에서 바로 초상화를 고를 수 있습니다.
   - 반영 후에도 `Ctrl+Z`로 동기화 전체를 되돌릴 수 있습니다.
