# 식품업체 영업 레이더 · 팩스

[food-radar](https://github.com/YongjuShin83/food-radar)와 같은 화면·구조에 **팝빌 팩스 발송**을 붙인 버전입니다.

- 화면: `index.html` (GitHub Pages) — 업체 조회 · 관심업체 · 팩스 발송 탭
- 서버: `supabase/fax-send/index.ts` (Supabase Edge Function `fax-send`, 프로젝트 `qxbhsmgtbbcvuwiecenv`)
  - food-radar의 `food-biz-search` 기능(인허가·상권정보·우편번호) + 팝빌 팩스(`op=faxInfo|faxSend|faxSearch|faxResult|faxCancel`)

## Supabase 시크릿

| 이름 | 내용 |
|---|---|
| `ACCESS_PASSWORD` | 화면 접속 비밀번호 (food-radar와 공유) |
| `DATA_GO_KR_KEY` | 공공데이터포털 인증키 (food-radar와 공유) |
| `POPBILL_LINK_ID` | 팝빌 연동 LinkID |
| `POPBILL_SECRET_KEY` | 팝빌 연동 SecretKey |
| `POPBILL_CORP_NUM` | 팝빌 가입 사업자번호 10자리 |
| `POPBILL_IS_TEST` | `false`로 넣어야 실제 발송. 비워 두면 테스트 환경 |
| `POPBILL_USER_ID` | (선택) 팝빌 회원 아이디 |

발신번호는 팝빌 사이트에서 먼저 등록·승인받아야 목록에 나옵니다.
