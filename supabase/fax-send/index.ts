// 공공데이터포털 프록시: 식품 인허가(행정안전부) + 상가(상권)정보(소상공인시장진흥공단) + 우편번호(우정사업본부)
// + 팝빌 팩스 발송 API (op=fax*)
// 인증키는 Edge Function 시크릿 DATA_GO_KR_KEY 에만 저장됩니다.
// 팝빌 시크릿: POPBILL_LINK_ID, POPBILL_SECRET_KEY, POPBILL_CORP_NUM(사업자번호 10자리),
//              POPBILL_IS_TEST('false'일 때만 실제 발송, 그 외에는 테스트 환경), POPBILL_USER_ID(선택)
// 접속 비밀번호는 시크릿 ACCESS_PASSWORD (헤더 x-access-pw 로 확인)

const ENDPOINTS: Record<string, string> = {
  instant: 'https://apis.data.go.kr/1741000/instant_food_processors', // 즉석판매제조가공업
  retail: 'https://apis.data.go.kr/1741000/other_food_retailers', // 식품판매업(기타)
};
const ZIP_URL = 'http://openapi.epost.go.kr/postal/retrieveNewZipCdService/retrieveNewZipCdService/getNewZipCdList';

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

// ---------- 우편번호 ----------
const zipCache = new Map<string, string>();

// 주소에서 검색에 필요한 부분만 남김: 도로명은 건물번호까지, 지번은 번지까지
function zipQuery(addr: string): string {
  let a = addr.replace(/\(.*?\)/g, ' ').split(',')[0].replace(/\s+/g, ' ').trim();
  const road = a.match(/^(.*?(?:로|길)\s?\d+(?:-\d+)?)(?=\s|$)/);
  if (road) return road[1];
  const lot = a.match(/^(.*?(?:동|리|가|읍|면)\s(?:산\s?)?\d+(?:-\d+)?)(?=\s|$|[^\d-])/);
  if (lot) return lot[1];
  return a.slice(0, 60);
}

async function lookupZip(key: string, addr: string): Promise<string> {
  const q = zipQuery(addr);
  if (!q) return '';
  if (zipCache.has(q)) return zipCache.get(q)!;
  const url = `${ZIP_URL}?serviceKey=${encodeURIComponent(key)}&srchwrd=${encodeURIComponent(q)}&countPerPage=1&currentPage=1`;
  try {
    const t = await (await fetch(url)).text();
    if (/<returnCode>(\d+)</.exec(t)?.[1] === '30') throw new Error('KEY');
    const z = /<zipNo>(\d{5})<\/zipNo>/.exec(t)?.[1] ?? '';
    zipCache.set(q, z);
    return z;
  } catch (e) {
    if ((e as Error).message === 'KEY') throw e;
    return '';
  }
}

async function handleZip(req: Request, key: string) {
  let addrs: unknown;
  try { addrs = (await req.json())?.addrs; } catch { /* ignore */ }
  if (!Array.isArray(addrs)) return json(400, { error: 'addrs 배열이 필요합니다.' });
  const list = addrs.slice(0, 100).map((a) => (typeof a === 'string' ? a.slice(0, 200) : ''));
  const out: string[] = new Array(list.length).fill('');
  let i = 0;
  try {
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (i < list.length) { const n = i++; out[n] = list[n] ? await lookupZip(key, list[n]) : ''; }
    }));
  } catch {
    return json(502, { error: '우편번호 API 인증키가 등록되지 않았습니다.' });
  }
  return json(200, { zips: out });
}

// ---------- 소상공인시장진흥공단 상가(상권)정보 ----------
const SDSC = 'https://apis.data.go.kr/B553077/api/open/sdsc2';
const SDSC_OPS = new Set(['storeListInDong', 'storeListInRadius', 'storeListInUpjong', 'storeOne',
  'largeUpjongList', 'middleUpjongList', 'smallUpjongList', 'baroApi']);
const SDSC_PARAMS = ['divId', 'key', 'indsLclsCd', 'indsMclsCd', 'indsSclsCd', 'radius', 'cx', 'cy',
  'resId', 'catId', 'ctprvnCd', 'signguCd', 'adongCd'];

async function handleStore(q: URLSearchParams, key: string) {
  const api = q.get('api') ?? '';
  if (!SDSC_OPS.has(api)) return json(400, { error: '지원하지 않는 상가정보 조회입니다.' });
  const params: [string, string][] = [['serviceKey', key], ['type', 'json']];
  if (api.startsWith('storeList')) {
    params.push(['pageNo', String(Math.max(1, parseInt(q.get('pageNo') ?? '1', 10) || 1))]);
    params.push(['numOfRows', String(Math.min(1000, Math.max(1, parseInt(q.get('numOfRows') ?? '100', 10) || 100)))]);
  }
  for (const p of SDSC_PARAMS) { const v = clean(q.get(p), 30); if (v) params.push([p, v]); }
  const url = `${SDSC}/${api}?` + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  try {
    const text = await (await fetch(url, { headers: { Accept: 'application/json' } })).text();
    let data: any;
    try { data = JSON.parse(text); } catch {
      const msg = /<returnAuthMsg>(.*?)</.exec(text)?.[1] || /<resultMsg>(.*?)</.exec(text)?.[1] || '';
      return json(502, { error: msg.includes('SERVICE_KEY') ? '상가정보 API 인증키가 아직 활성화되지 않았습니다. 활용신청 승인 후 1~2시간 뒤 다시 시도하세요.' : '상가정보 응답을 해석하지 못했습니다.', detail: text.slice(0, 300) });
    }
    const root = data?.response ?? data;
    const header = root?.header ?? {};
    if (header.resultCode === '03') return json(200, { totalCount: 0, items: [], stdrYm: header.stdrYm ?? '', code: '03', msg: header.resultMsg ?? '' });
    if (header.resultCode && header.resultCode !== '00' && header.resultCode !== '0') {
      return json(502, { error: header.resultMsg || '상가정보 조회 실패', code: header.resultCode });
    }
    const body = root?.body ?? {};
    let items = body?.items?.item ?? body?.items ?? [];
    if (!body?.items && q.get('debug') === '1') return json(200, { totalCount: 0, items: [], raw: text.slice(0, 400) });
    if (!Array.isArray(items)) items = [items];
    return json(200, { totalCount: body.totalCount ?? items.length, pageNo: body.pageNo, numOfRows: body.numOfRows, stdrYm: header.stdrYm ?? '', items });
  } catch (e) {
    return json(502, { error: '상가정보 API 연결 실패', detail: String(e).slice(0, 200) });
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

  const q0 = new URL(req.url).searchParams;
  // 업종·지역 분류 목록은 공개 기준정보라 비밀번호 없이 허용 (업체 목록은 보호)
  const isMeta = q0.get('op') === 'store' && /^(largeUpjongList|middleUpjongList|smallUpjongList|baroApi)$/.test(q0.get('api') ?? '');
  const pw = Deno.env.get('ACCESS_PASSWORD');
  if (pw && !isMeta && req.headers.get('x-access-pw') !== pw) return json(401, { error: '접속 비밀번호가 올바르지 않습니다.' });

  const op0 = q0.get('op') ?? '';
  if (op0.startsWith('fax')) return handleFax(req, op0, q0);

  const key = Deno.env.get('DATA_GO_KR_KEY');
  if (!key) return json(500, { error: '서버에 DATA_GO_KR_KEY 시크릿이 아직 없습니다.' });

  const q = new URL(req.url).searchParams;
  if (q.get('op') === 'zip' && req.method === 'POST') return handleZip(req, key);
  if (q.get('op') === 'store') return handleStore(q, key);

  const base = ENDPOINTS[q.get('type') ?? ''] ?? ENDPOINTS.instant;
  const op = q.get('op') === 'history' ? 'history' : 'info';
  const pageNo = Math.max(1, parseInt(q.get('pageNo') ?? '1', 10) || 1);
  const numOfRows = Math.min(100, Math.max(1, parseInt(q.get('numOfRows') ?? '50', 10) || 50));

  const params: [string, string][] = [
    ['serviceKey', key], ['pageNo', String(pageNo)], ['numOfRows', String(numOfRows)], ['returnType', 'json'],
  ];
  const cond = (name: string, value: string) => { if (value) params.push([`cond[${name}]`, value]); };
  cond('BPLC_NM::LIKE', clean(q.get('name')));
  if (op === 'info') cond('ROAD_NM_ADDR::LIKE', clean(q.get('addr')));
  const status = q.get('status') ?? '';
  if (/^\d{2}$/.test(status)) cond('SALS_STTS_CD::EQ', status);
  cond('LCPMT_YMD::GTE', ymd(q.get('from')));
  cond('LCPMT_YMD::LT', ymd(q.get('to')));
  const region = q.get('region') ?? '';
  if (/^\d{7}$/.test(region)) cond('OPN_ATMY_GRP_CD::EQ', region);
  if (op === 'history') cond('BASE_DATE::EQ', ymd(q.get('baseDate')));

  const url = `${base}/${op}?` + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await r.text();
    let data: any;
    try { data = JSON.parse(text); } catch {
      return json(502, { error: '공공데이터포털 응답을 해석하지 못했습니다.', detail: text.slice(0, 300) });
    }
    const header = data?.response?.header ?? {};
    if (header.resultCode && header.resultCode !== '0' && header.resultCode !== '00') {
      return json(502, { error: header.resultMsg || '조회 실패', code: header.resultCode });
    }
    const body = data?.response?.body ?? {};
    let items = body?.items?.item ?? [];
    if (!Array.isArray(items)) items = [items];
    return json(200, { totalCount: body.totalCount ?? 0, pageNo: body.pageNo ?? pageNo, numOfRows: body.numOfRows ?? numOfRows, items });
  } catch (e) {
    return json(502, { error: '공공데이터포털 연결 실패', detail: String(e).slice(0, 200) });
  }
});
