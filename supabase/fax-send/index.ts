// 공공데이터포털 프록시: 경상남도 제조업체 · 경상남도 노인복지시설 · 공정거래위원회 가맹본부 일반정보 변경이력
// + 팝빌 팩스 발송 API (op=fax*)
// 인증키는 Edge Function 시크릿 DATA_GO_KR_KEY 에만 저장됩니다.
// 팝빌 시크릿: POPBILL_LINK_ID, POPBILL_SECRET_KEY, POPBILL_CORP_NUM(사업자번호 10자리),
//              POPBILL_IS_TEST('false'일 때만 실제 발송, 그 외에는 테스트 환경), POPBILL_USER_ID(선택)
// 접속 비밀번호는 시크릿 ACCESS_PASSWORD (헤더 x-access-pw 로 확인)
//
// op=gn&src=mfr|senior  경남 데이터 (원본 API에 검색 조건이 없어 전체를 받아 서버에서 거르고, 6시간 보관)
//   q(이름·업종·생산품) addr(주소) sgg(시군) fax=1(팩스번호 있는 곳만) pageNo numOfRows all=1(최대 5000건 한 번에)
// op=fc  가맹본부 변경이력  year(기준년도, 필수) mnno(가맹본부관리번호) pageNo numOfRows

const GN: Record<string, { url: string; name: string }> = {
  mfr: { url: 'https://apis.data.go.kr/6480000/gyeongnammanufacturer/gyeongnammanufacturerList', name: '경남 제조업체' },
  senior: { url: 'https://apis.data.go.kr/6480000/gyeongnamseniorwelfare/gyeongnamseniorwelfareList', name: '경남 노인복지시설' },
};
const FC_URL = 'https://apis.data.go.kr/1130000/FftcjnghdqrtrsInfoChghst2_Service/getjnghdqrtrsGnlHist';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-access-pw, content-type, authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
const clean = (v: string | null, max = 60) => (v ?? '').trim().slice(0, max);
const ymd = (v: string | null) => { const s = clean(v).replace(/-/g, ''); return /^\d{8}$/.test(s) ? s : ''; };
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const qs = (p: [string, string][]) => p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

class ApiError extends Error { code: string; constructor(msg: string, code = '') { super(msg); this.code = code; } }

// 공공데이터포털 공통 응답 해석 (JSON 또는 게이트웨이 XML 오류)
async function portal(url: string, label: string): Promise<{ total: number; items: any[] }> {
  let text = '';
  try { text = await (await fetch(url, { headers: { Accept: 'application/json' } })).text(); }
  catch (e) { throw new ApiError(`${label} 연결 실패: ${String(e).slice(0, 120)}`); }
  let data: any;
  try { data = JSON.parse(text); } catch {
    const msg = /<returnAuthMsg>(.*?)</.exec(text)?.[1] || /<resultMsg>(.*?)</.exec(text)?.[1] || /<errMsg>(.*?)</.exec(text)?.[1] || '';
    if (/SERVICE_KEY|SERVICE KEY|NOT_REGISTERED|KEY_IS_NOT/i.test(msg + text)) {
      throw new ApiError(`${label} 인증키가 아직 활성화되지 않았습니다. 활용신청 승인 후 1~2시간 뒤 다시 시도하세요.`, 'KEY');
    }
    throw new ApiError(`${label} 응답을 해석하지 못했습니다. ${msg}`.trim(), 'PARSE');
  }
  const root = data?.response ?? data;
  const header = root?.header ?? {};
  const code = s(header.resultCode ?? root?.resultCode);
  if (code === '03') return { total: 0, items: [] };          // NODATA
  if (code && code !== '00' && code !== '0') throw new ApiError(s(header.resultMsg ?? root?.resultMsg) || `${label} 조회 실패`, code);
  const body = root?.body ?? root;
  let items = body?.items?.item ?? body?.items ?? [];
  if (!Array.isArray(items)) items = items ? [items] : [];
  const total = parseInt(s(body?.totalCount ?? root?.totalCount), 10);
  return { total: Number.isFinite(total) ? total : items.length, items };
}

// ---------- 경상남도 (제조업체 · 노인복지시설) ----------
type Row = Record<string, unknown> & { MNG_NO: string; BPLC_NM: string; ROAD_NM_ADDR: string; TELNO: string; FAXNO: string; SGG: string; detail: [string, string][] };

function normGn(src: string, x: any): Row {
  if (src === 'mfr') {
    const name = s(x.entrprsNm), addr = s(x.rdnmadr);
    return { MNG_NO: `mfr:${name}|${addr}`, BPLC_NM: name, ROAD_NM_ADDR: addr, TELNO: s(x.telno), FAXNO: s(x.fax), SGG: s(x.signguNm),
      INDUTY: s(x.indutyNm), GOODS: s(x.maingoods), REP: s(x.rprsntvNm), MEMBERS: s(x.membercnt),
      detail: [['업종', s(x.indutyNm)], ['주요생산품', s(x.maingoods)], ['대표자', s(x.rprsntvNm)], ['종업원수', s(x.membercnt)],
        ['시군', s(x.signguNm)], ['주소', addr], ['전화번호', s(x.telno)], ['팩스번호', s(x.fax)],
        ['위도·경도', x.latitude ? `${s(x.latitude)}, ${s(x.logitude)}` : ''], ['데이터기준일', s(x.referenceDate)]] };
  }
  const name = s(x.title), addr = s(x.roadaddress);
  return { MNG_NO: `senior:${s(x.entid) || name + '|' + addr}`, BPLC_NM: name, ROAD_NM_ADDR: addr, TELNO: s(x.tel), FAXNO: s(x.fax), SGG: s(x.sigungu),
    REP: s(x.delegate), HPG: s(x.homepage),
    detail: [['시군구', s(x.sigungu)], ['대표자', s(x.delegate)], ['주소', addr], ['전화번호', s(x.tel)], ['팩스번호', s(x.fax)],
      ['홈페이지', s(x.homepage)], ['고유번호', s(x.entid)]] };
}

const GN_TTL = 6 * 3600_000;
const gnCache = new Map<string, { at: number; rows: Row[] }>();
const gnLoading = new Map<string, Promise<Row[]>>();

async function gnLoad(src: string, key: string): Promise<Row[]> {
  const c = gnCache.get(src);
  if (c && Date.now() - c.at < GN_TTL) return c.rows;
  if (gnLoading.has(src)) return gnLoading.get(src)!;
  const job = (async () => {
    const per = 1000, rows: Row[] = [];
    for (let page = 1; page <= 60; page++) {
      const url = `${GN[src].url}?` + qs([['ServiceKey', key], ['pageNo', String(page)], ['numOfRows', String(per)], ['resultType', 'json']]);
      const r = await portal(url, GN[src].name);
      rows.push(...r.items.map((x) => normGn(src, x)));
      if (!r.items.length || rows.length >= r.total) break;
    }
    gnCache.set(src, { at: Date.now(), rows });
    return rows;
  })();
  gnLoading.set(src, job);
  try { return await job; } finally { gnLoading.delete(src); }
}

async function handleGn(q: URLSearchParams, key: string) {
  const src = q.get('src') ?? '';
  if (!GN[src]) return json(400, { error: '지원하지 않는 자료입니다.' });
  let rows: Row[];
  try { rows = await gnLoad(src, key); }
  catch (e) { return json(502, { error: (e as Error).message, code: (e as ApiError).code ?? '' }); }

  const words = clean(q.get('q')).split(/\s+/).filter(Boolean);
  const addr = clean(q.get('addr')), sgg = clean(q.get('sgg'), 30), faxOnly = q.get('fax') === '1';
  const hay = (r: Row) => [r.BPLC_NM, r.INDUTY, r.GOODS, r.REP].join(' ');
  const hit = rows.filter((r) => (!faxOnly || r.FAXNO.replace(/\D/g, '').length >= 8)
    && (!sgg || r.SGG === sgg) && (!addr || r.ROAD_NM_ADDR.includes(addr))
    && words.every((w) => hay(r).includes(w)));

  const sggs = [...rows.reduce((m, r) => (r.SGG ? m.set(r.SGG, (m.get(r.SGG) ?? 0) + 1) : m), new Map<string, number>())]
    .sort((a, b) => a[0].localeCompare(b[0], 'ko')).map(([name, n]) => ({ name, n }));
  const withFax = rows.filter((r) => r.FAXNO.replace(/\D/g, '').length >= 8).length;
  const loadedAt = new Date(gnCache.get(src)?.at ?? Date.now()).toISOString();

  if (q.get('all') === '1') return json(200, { totalCount: hit.length, items: hit.slice(0, 5000), sggs, all: rows.length, withFax, loadedAt });
  const per = Math.min(100, Math.max(1, parseInt(q.get('numOfRows') ?? '50', 10) || 50));
  const page = Math.max(1, parseInt(q.get('pageNo') ?? '1', 10) || 1);
  return json(200, { totalCount: hit.length, pageNo: page, numOfRows: per, items: hit.slice((page - 1) * per, page * per), sggs, all: rows.length, withFax, loadedAt });
}

// ---------- 공정거래위원회 가맹본부 일반정보 변경이력 ----------
function normFc(x: any): Row {
  const name = s(x.jnghdqrtrsConmNm), addr = [s(x.lctnAddr), s(x.lctnDaddr)].filter(Boolean).join(' ');
  const kind = s(x.indvdlCorpSeCd) === '11' ? '법인' : s(x.indvdlCorpSeCd) === '10' ? '개인' : '';
  return { MNG_NO: `fc:${s(x.jnghdqrtrsMnno)}:${s(x.hstrSn)}`, BPLC_NM: name, ROAD_NM_ADDR: addr,
    TELNO: s(x.jnghdqrtrsRprsTelno), FAXNO: s(x.jnghdqrtrsRprsFxno), SGG: s(x.areaNm),
    REP: s(x.jnghdqrtrsRprsvNm), HQ_NO: s(x.jnghdqrtrsMnno), HIST: s(x.hstrSn), YEAR: s(x.jngBizCrtraYr),
    BRANDS: s(x.brandCnt), SCALE: s(x.entScaleNm), HPG: s(x.hmpgUrladr),
    detail: [['대표자', s(x.jnghdqrtrsRprsvNm)], ['지역', s(x.areaNm)], ['주소', addr], ['우편번호(구)', s(x.jnghdqrtrsOzip)],
      ['전화번호', s(x.jnghdqrtrsRprsTelno)], ['팩스번호', s(x.jnghdqrtrsRprsFxno)], ['사업자등록번호', s(x.brno)],
      ['개인·법인', kind], ['사업자등록일', s(x.bzmnRgsDate)], ['법인등기일', s(x.corpRgDate)], ['브랜드 수', s(x.brandCnt)],
      ['계열회사 수', s(x.affltsCnt)], ['기업규모', s(x.entScaleNm)], ['가맹기관', s(x.jngInstNm)], ['홈페이지', s(x.hmpgUrladr)],
      ['가맹본부관리번호', s(x.jnghdqrtrsMnno)], ['이력일련번호', s(x.hstrSn)], ['가맹사업기준년도', s(x.jngBizCrtraYr)]] };
}

async function handleFc(q: URLSearchParams, key: string) {
  const year = clean(q.get('year'), 4);
  if (!/^\d{4}$/.test(year)) return json(400, { error: '기준년도(4자리)를 넣으세요.' });
  const mnno = clean(q.get('mnno'), 30).replace(/[^\w-]/g, '');
  const per = Math.min(100, Math.max(1, parseInt(q.get('numOfRows') ?? '50', 10) || 50));
  const page = Math.max(1, parseInt(q.get('pageNo') ?? '1', 10) || 1);
  const params: [string, string][] = [['serviceKey', key], ['pageNo', String(page)], ['numOfRows', String(per)], ['resultType', 'json'], ['jngBizCrtraYr', year]];
  if (mnno) params.push(['jnghdqrtrsMnno', mnno]);
  try {
    const r = await portal(`${FC_URL}?${qs(params)}`, '가맹본부 변경이력');
    return json(200, { totalCount: r.total, pageNo: page, numOfRows: per, items: r.items.map(normFc) });
  } catch (e) {
    return json(502, { error: (e as Error).message, code: (e as ApiError).code ?? '' });
  }
}

// ---------- 팝빌 팩스 ----------
const PB = {
  linkId: Deno.env.get('POPBILL_LINK_ID') ?? '',
  secret: Deno.env.get('POPBILL_SECRET_KEY') ?? '',
  corp: (Deno.env.get('POPBILL_CORP_NUM') ?? '').replace(/\D/g, ''),
  userId: Deno.env.get('POPBILL_USER_ID') ?? '',
  test: (Deno.env.get('POPBILL_IS_TEST') ?? '').toLowerCase() !== 'false',
};
const PB_SID = () => (PB.test ? 'POPBILL_TEST' : 'POPBILL');
const PB_HOST = () => (PB.test ? 'https://popbill-test.linkhub.co.kr' : 'https://popbill.linkhub.co.kr');
const PB_AUTH = 'https://auth.linkhub.co.kr';
let pbToken: { token: string; exp: number } | null = null;

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

class PbError extends Error { code: number; constructor(code: number, msg: string) { super(msg); this.code = code; } }

async function pbGetToken(): Promise<string> {
  if (pbToken && pbToken.exp - Date.now() > 60_000) return pbToken.token;
  const body = JSON.stringify({ access_id: PB.corp, scope: ['member', '160', '161'] });
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const bodyHash = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
  const path = `/${PB_SID()}/Token`;
  const toSign = ['POST', bodyHash, date, '*', '2.0', path].join('\n');
  let keyBytes: Uint8Array;
  try { keyBytes = Uint8Array.from(atob(PB.secret), (c) => c.charCodeAt(0)); }
  catch { throw new PbError(-1, 'POPBILL_SECRET_KEY 형식이 올바르지 않습니다.'); }
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(toSign)));
  const r = await fetch(PB_AUTH + path, {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/json', 'x-lh-date': date, 'x-lh-version': '2.0', 'x-lh-forwarded': '*',
      Authorization: `LINKHUB ${PB.linkId} ${sig}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.session_token) throw new PbError(j.code ?? r.status, '팝빌 인증 실패: ' + (j.message ?? r.status));
  pbToken = { token: j.session_token, exp: Date.parse(j.expiration) || Date.now() + 25 * 60_000 };
  return pbToken.token;
}

async function pbCall(path: string, init: RequestInit = {}, host = PB_HOST()): Promise<any> {
  const headers: Record<string, string> = { 'x-pb-version': '1.0', Authorization: 'Bearer ' + await pbGetToken() };
  if (PB.userId) headers['x-pb-userid'] = PB.userId;
  const r = await fetch(host + path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) } });
  const text = await r.text();
  let j: any = {};
  try { j = JSON.parse(text); } catch { j = { message: text.slice(0, 200) }; }
  if (!r.ok) throw new PbError(j.code ?? r.status, j.message ?? '팝빌 요청 실패');
  return j;
}

const digits = (v: unknown, max = 20) => String(v ?? '').replace(/\D/g, '').slice(0, max);
const MAX_FILES = 5, MAX_BYTES = 10 * 1024 * 1024, MAX_RCV = 100;

async function handleFax(req: Request, op: string, q: URLSearchParams) {
  if (!PB.linkId || !PB.secret || PB.corp.length !== 10) {
    return json(op === 'faxInfo' ? 200 : 500, { configured: false, error: '팝빌 연동정보(POPBILL_LINK_ID·POPBILL_SECRET_KEY·POPBILL_CORP_NUM) 시크릿이 아직 없습니다.' });
  }
  try {
    if (op === 'faxInfo') {
      const [senders, unit, point] = await Promise.all([
        pbCall('/FAX/SenderNumber').catch((e) => ({ error: e.message })),
        pbCall('/FAX/UnitCost').catch(() => ({})),
        pbCall(`/${PB_SID()}/Point`, {}, PB_AUTH).catch(() => ({})),
      ]);
      return json(200, { configured: true, test: PB.test, senders: Array.isArray(senders) ? senders : [],
        senderError: Array.isArray(senders) ? '' : senders.error, unitCost: unit.unitCost ?? null, balance: point.remainPoint ?? null });
    }
    if (op === 'faxSend' && req.method === 'POST') {
      const fd = await req.formData();
      const snd = digits(fd.get('sender'));
      if (!snd) return json(400, { error: '발신번호를 고르세요.' });
      let rcvs: { rcv: string; rcvnm: string }[] = [];
      try {
        rcvs = (JSON.parse(String(fd.get('receivers') ?? '[]')) as any[])
          .map((x) => ({ rcv: digits(x?.num), rcvnm: String(x?.name ?? '').slice(0, 50) }))
          .filter((x) => x.rcv.length >= 8);
      } catch { /* ignore */ }
      if (!rcvs.length) return json(400, { error: '수신 팩스번호를 1개 이상 넣으세요.' });
      if (rcvs.length > MAX_RCV) return json(400, { error: `한 번에 ${MAX_RCV}곳까지 보낼 수 있습니다.` });
      const files = fd.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
      if (!files.length) return json(400, { error: '보낼 파일을 첨부하세요.' });
      if (files.length > MAX_FILES) return json(400, { error: `파일은 ${MAX_FILES}개까지입니다.` });
      if (files.reduce((s, f) => s + f.size, 0) > MAX_BYTES) return json(400, { error: '파일 합계가 10MB를 넘습니다.' });
      const reserve = digits(fd.get('reserveDT'), 14);
      const meta: Record<string, unknown> = {
        snd, sndnm: String(fd.get('senderName') ?? '').slice(0, 50), fCnt: files.length, rcvs,
        sndDT: reserve.length === 14 ? reserve : null, title: String(fd.get('title') ?? '').slice(0, 100) || null,
        requestNum: null, adsYN: fd.get('ads') === '1',
      };
      // 팝빌 SDK와 같은 multipart 형식: form(JSON) + file(여러 개)
      const out = new FormData();
      out.append('form', JSON.stringify(meta));
      for (const f of files) out.append('file', new Blob([await f.arrayBuffer()], { type: 'application/octet-stream' }), f.name);
      const j = await pbCall('/FAX', { method: 'POST', body: out });
      return json(200, { receiptNum: j.receiptNum, count: rcvs.length, test: PB.test });
    }
    if (op === 'faxResult') {
      const rn = clean(q.get('receiptNum'), 20).replace(/[^\w]/g, '');
      if (!rn) return json(400, { error: '접수번호가 필요합니다.' });
      const list = await pbCall('/FAX/' + rn);
      return json(200, { items: Array.isArray(list) ? list : [list] });
    }
    if (op === 'faxCancel' && req.method === 'POST') {
      const rn = clean(q.get('receiptNum'), 20).replace(/[^\w]/g, '');
      if (!rn) return json(400, { error: '접수번호가 필요합니다.' });
      await pbCall(`/FAX/${rn}/Cancel`);
      return json(200, { ok: true });
    }
    if (op === 'faxSearch') {
      const sd = ymd(q.get('from')), ed = ymd(q.get('to'));
      if (!sd || !ed) return json(400, { error: '조회 기간이 필요합니다.' });
      const page = Math.max(1, parseInt(q.get('page') ?? '1', 10) || 1);
      const qs = `SDate=${sd}&EDate=${ed}&State=1,2,3,4&ReserveYN=0&SenderOnly=0&Page=${page}&PerPage=50&Order=D`;
      const j = await pbCall('/FAX/Search?' + qs);
      return json(200, { total: j.total ?? 0, page: j.pageNum ?? page, pageCount: j.pageCount ?? 1, items: j.list ?? [] });
    }
    return json(400, { error: '지원하지 않는 팩스 요청입니다.' });
  } catch (e) {
    const code = e instanceof PbError ? e.code : 0;
    return json(502, { error: (e as Error).message || '팝빌 연결 실패', code });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const q = new URL(req.url).searchParams;
  const pw = Deno.env.get('ACCESS_PASSWORD');
  if (pw && req.headers.get('x-access-pw') !== pw) return json(401, { error: '접속 비밀번호가 올바르지 않습니다.' });

  const op = q.get('op') ?? '';
  if (op.startsWith('fax')) return handleFax(req, op, q);

  const key = Deno.env.get('DATA_GO_KR_KEY');
  if (!key) return json(500, { error: '서버에 DATA_GO_KR_KEY 시크릿이 아직 없습니다.' });

  if (op === 'gn') return handleGn(q, key);
  if (op === 'fc') return handleFc(q, key);
  return json(400, { error: '지원하지 않는 요청입니다.' });
});
