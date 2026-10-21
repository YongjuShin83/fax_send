# 영업 레이더 · 팩스

영업 대상 업체를 조회해 **팝빌 팩스**로 바로 보내는 화면입니다.

- 화면: `index.html` (GitHub Pages) — 업체 조회 · 관심업체 · 팩스 발송 탭
- 서버: `supabase/fax-send/index.ts` (Supabase Edge Function `fax-send`, 프로젝트 `qxbhsmgtbbcvuwiecenv`)

## 연결된 데이터 (공공데이터포털)

| 자료 | 요청 주소 | 비고 |
|---|---|---|
| 경상남도_제조업체 | `apis.data.go.kr/6480000/gyeongnammanufacturer/gyeongnammanufacturerList` | 회사명·업종·생산품·전화·**팩스**. 검색 조건이 없어 서버가 전체를 받아 6시간 보관하며 거름 |
| 경상남도_노인복지시설 | `apis.data.go.kr/6480000/gyeongnamseniorwelfare/gyeongnamseniorwelfareList` | 기관명·시군구·전화·**팩스**. 위와 같은 방식 |
| 공정거래위원회_가맹정보_가맹본부 일반 정보 상세 | `apis.data.go.kr/1130000/FftcJnghdqrtrsGnrlDtl3_Service/getjnghdqrtrsGnlinfo2` | 기준년도 전체 본부 + 주소·대표 전화·**팩스** (관리번호 없이 목록). 주소·지역·팩스 검색에 사용 |
| 공정거래위원회_가맹정보_브랜드 목록 정보 | `apis.data.go.kr/1130000/FftcBrandRlsInfo2_Service/getBrandinfo` | 기준년도 전체 브랜드 → 가맹본부별로 묶어 브랜드·본부명·업종·상품으로 검색 (12시간 보관) |
| 공정거래위원회_가맹정보_가맹본부 일반 정보 변경 이력현황 | `apis.data.go.kr/1130000/FftcjnghdqrtrsInfoChghst2_Service/getjnghdqrtrsGnlHist` | 기준년도+관리번호 필수. 화면에 보이는 본부마다 최신 이력에서 대표 전화·**팩스**·주소를 채움 |

서버 요청: `op=gn&src=mfr|senior` (q, addr, sgg, fax=1, pageNo, numOfRows, all=1) · `op=fc` (올해+작년 합쳐 최신 · q, lcls, addr, sgg, fax=1, pageNo, numOfRows, all=1) · `op=raw&src=mfr|senior|brand|fc|dtl` (원본 응답 점검) · `op=fax*`

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
