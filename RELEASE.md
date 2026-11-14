# SIMLINE v2.3.0 · The Sims 4 가계도 연동

**심즈 4(`SIMLINE_Sims4_Sync.ts4script`) 연동 에디션**입니다. 인게임 가족·부부·이혼·입양·절친/연인·유령/컬링된 조상 데이터와 `Screenshots` 초상화를 SIMLINE 관계도로 바로 가져올 수 있습니다.

## 주요 기능

- **심즈 4 자동·수동 추출 모드 (`SIMLINE_Sims4_Sync.ts4script`)**
  - 게임 저장 시 또는 존 로드 시 `문서\Electronic Arts\The Sims 4\SIMLINE_Sync\simline_sims4_sync.json`을 자동으로 생성합니다.
  - 인게임 치트 콘솔(`Ctrl+Shift+C`): `simline.sync` (기본 주변 범위), `simline.sync family` (가계도만), `simline.sync all` (전체 심), `simline.autosync off|on`, `simline.status`.
  - 심이 삭제(컬링)되어도 게임 내 `FamilyTreeGraph`에 남은 조상·입양·이혼·사별·종족(뱀파이어·마법사·늑대인간·인어·외계인·요정)·특성·직업을 함께 추출합니다.
- **SIMLINE 스마트 병합 및 실시간 감시**
  - 상단 **심즈 4 연동** 버튼에서 `SIMLINE_Sync` 폴더를 자동 감지·감시합니다.
  - 반영 전 **변경 미리보기**(+신규 심 / 기존 갱신 / 새 가족 단위 / 새 직접 관계)와 범위 필터를 선택할 수 있습니다.
  - 기존의 인물 **사진·자르기·카드 좌표·개인 메모**는 건드리지 않고 `[Sims 4 자동 동기화]` 블록만 안전하게 갱신하며, `Ctrl+Z`로 통째로 되돌릴 수 있습니다.
- **심즈 4 스크린샷 퀵 초상화 선택**
  - 인물 프로필 편집 → **심즈 4 스샷**에서 `Screenshots` 폴더의 최근 스크린샷을 썸네일로 보고 바로 프로필 사진에 적용합니다.

## GitHub 배포 파일 구성

- **`SIMLINE_Sims4_Sync.ts4script`** — 심즈 4 `Mods` 폴더에 넣는 스크립트 모드 (Python 3.7 바이트코드)
- **`SIMLINE-2.3.0-Windows-x64.zip`** — Windows x64용 실행 패키지 (압축 해제 후 `SIMLINE.exe` 실행, 내부에도 `.ts4script` 포함)
- **`SIMLINE-2.3.0-source.zip`** — 앱 및 `.ts4script` 전체 소스 코드와 빌드/테스트 스크립트
- **`SHA256SUMS.txt`** — 배포 파일 SHA-256 체크섬
