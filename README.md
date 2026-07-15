# 이지어드민 재고 현황 대시보드 (자동 갱신)

매일 평일 오전 9시(한국시간)에 GitHub Actions가 이지어드민에서 재고·판매 데이터를 수집해
`docs/index.html` 대시보드를 다시 생성하고, GitHub Pages 고정 URL로 서비스합니다.
핸드폰·PC 어디서든 같은 주소로 항상 최신 재고를 볼 수 있습니다.

## 구성

| 파일 | 역할 |
|---|---|
| `scrape.js` | 이지어드민 로그인 → 현 재고조회(I100) + 일자별 발주수량(IE10) 수집 → 대시보드 생성 |
| `template.html` | 대시보드 템플릿 (데이터 자리에 `__PRODUCTS_JSON__` 플레이스홀더) |
| `docs/index.html` | 생성된 대시보드 (GitHub Pages가 서비스하는 파일) |
| `.github/workflows/update-dashboard.yml` | 매일 자동 실행 스케줄 |

## 최초 설정 (한 번만)

1. **GitHub 계정으로 새 저장소(repository) 생성**
   - 이름은 아무거나 (예: `stock-dash`)
   - ⚠️ 무료 계정은 Public 저장소에서만 GitHub Pages 사용 가능 → 아래 "보안" 참고

2. **이 폴더의 파일 전체 업로드**
   - 저장소 페이지에서 `Add file > Upload files`로 드래그&드롭
   - `.github/workflows/update-dashboard.yml` 경로가 유지되어야 합니다

3. **Secrets 등록** (로그인 정보 — 암호화 저장되며 외부에 노출되지 않음)
   - 저장소 `Settings > Secrets and variables > Actions > New repository secret`
   - `EZ_DOMAIN` = 이지어드민 도메인
   - `EZ_ID` = 아이디
   - `EZ_PW` = 비밀번호

4. **GitHub Pages 켜기**
   - `Settings > Pages > Source: Deploy from a branch`
   - Branch: `main`, 폴더: `/ (root)` 선택 후 Save
   - 몇 분 뒤 `https://<계정명>.github.io/<저장소명>/` 주소가 생깁니다 → 이게 대시보드 고정 URL

5. **첫 실행 테스트**
   - 저장소 `Actions` 탭 > "재고 대시보드 갱신" > `Run workflow` 버튼으로 수동 실행
   - 초록불이 뜨면 성공. 1~2분 뒤 Pages 주소에서 최신 데이터 확인

## 보안 주의사항

- 로그인 정보는 반드시 **Secrets에만** 넣으세요. 코드나 파일에 직접 쓰지 마세요.
- 가능하면 이지어드민에서 **조회 권한만 있는 전용 부계정**을 만들어 그 계정을 쓰는 것을 권장합니다.
- 무료 Public 저장소를 쓰면 **대시보드 URL도 공개**됩니다(주소를 아는 사람은 볼 수 있음).
  상품명·재고수량이 민감하다면: ① GitHub Pro(월 $4)로 Private 저장소 + Pages,
  ② 또는 Cloudflare Access 같은 무료 접근제어를 앞단에 두는 방법이 있습니다.

## 자주 하는 조정

- **갱신 시각 변경**: `update-dashboard.yml`의 cron 수정 (UTC 기준, 한국시간 −9시간)
- **주말에도 갱신**: cron을 `0 0 * * *`로
- **적정재고 기준(주) 변경**: 대시보드 화면 우측 상단 버튼 (4~12주) 또는 상품별 기준(주) 칸

## 문제가 생기면

Actions 탭에서 실패한 실행의 로그를 확인하세요.
- `로그인 실패`: Secrets 값 확인, 또는 이지어드민이 추가 인증(IP 등록 등)을 요구하는지 확인
- `그리드를 찾지 못함`: 이지어드민 화면 구조가 바뀐 경우 — 스크립트 수정 필요
