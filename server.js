// Node.js 기본 기능만 사용합니다. npm install 없이 실행할 수 있습니다.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// 브라우저에 제공할 화면 파일은 public 폴더에 모아 둡니다.
const PUBLIC = new URL('./public/', import.meta.url);
// 허용하는 유종 코드와 정유사 이름입니다.
const FUELS = new Set(['B027', 'D047', 'B034', 'K015']);
const BRANDS = { SKE: 'SK에너지', GSC: 'GS칼텍스', HDO: '현대오일뱅크', SOL: 'S-OIL', RTE: '알뜰주유소', RTX: '고속도로 알뜰', NHO: '농협 알뜰', ETC: '자가상표', E1G: 'E1', SKG: 'SK가스' };
// 사용자에게 안내할 오류 문구와 HTTP 상태 코드를 함께 보관합니다.
class ServiceError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }

// 외부 통신 함수를 주입할 수 있게 해 두면 실제 키 없이도 오류 처리를 테스트할 수 있습니다.
export function createServer({ env = process.env, fetcher = fetch } = {}) {
  // 실제 API 데이터만 조회하며 임의의 주유소 데이터를 보여주지 않습니다.
  const mode = 'live';
  // 키의 존재 여부만 확인합니다. 실제 유효성은 API를 요청할 때 확인됩니다.
  const configured = Boolean(env.KAKAO_REST_API_KEY?.trim() && env.OPINET_API_KEY?.trim());
  // 외부 API를 호출하고 JSON으로 읽습니다. 10초가 지나면 요청을 중단합니다.
  async function getJSON(url, headers, provider) {
    try {
      const response = await fetcher(url, { headers, signal: AbortSignal.timeout(10000) });
      if (response.status === 401 || response.status === 403) throw new ServiceError(provider + ' 인증에 실패했습니다. 키 종류와 API 사용 권한을 확인해 주세요.', 502);
      if (response.status === 429) throw new ServiceError(provider + ' 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.', 429);
      if (!response.ok) throw new Error('upstream');
      return await response.json();
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      // 인증키가 포함된 외부 URL이나 외부 오류 원문을 브라우저에 보내지 않습니다.
      throw new ServiceError(`${provider} 조회에 실패했습니다. 인증키·이용 권한·호출 한도와 인터넷 연결을 확인해 주세요.`);
    }
  }
  // 카카오 API 요청에 서버에 보관된 REST 인증키를 붙입니다.
  function kakao(path, params) {
    const url = new URL(`https://dapi.kakao.com/v2/local/${path}.json`);
    url.search = new URLSearchParams(params);
    return getJSON(url, { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` }, '주소 서비스');
  }
  // 주소 확인 → 좌표 변환 → 오피넷 조회 순서로 처리합니다.
  async function stations(params) {
    if (!configured) throw new ServiceError('서버의 카카오 REST API 키와 오피넷 인증키를 모두 설정해 주세요.', 503);
    const address = (params.get('address') || '').trim();
    const fuel = params.get('fuel');
    const radius = Number(params.get('radius'));
    // 화면을 거치지 않은 요청도 있을 수 있어 서버에서 입력을 다시 검사합니다.
    if (!address || address.length > 120 || !FUELS.has(fuel) || ![1000,3000,5000].includes(radius)) throw new ServiceError('주소, 유종, 검색 반경을 확인해 주세요.', 400);
    let location;
    // 주소 후보를 골랐더라도 서버에서 주소를 다시 확인합니다.
    const found = await kakao('search/address', { query: address, size: '30' });
    if (!Array.isArray(found.documents)) throw new ServiceError('주소 서비스에서 올바른 응답을 받지 못했습니다.');
    const choices = found.documents.map(d => ({ address: d.road_address?.address_name || d.address_name, x: String(d.x), y: String(d.y) }));
    if (!choices.length) throw new ServiceError('주소를 찾지 못했습니다. 건물명 대신 시·군·구를 포함한 도로명 또는 지번 주소를 입력해 주세요.', 404);
    if (params.has('x') || params.has('y')) {
      location = choices.find(c => c.x === params.get('x') && c.y === params.get('y') && c.address === params.get('selected'));
      if (!location) throw new ServiceError('주소 선택이 유효하지 않습니다. 주소를 다시 검색해 주세요.', 400);
    } else {
      if (choices.length > 1) return { choices };
      location = choices[0];
    }
    if (!Number.isFinite(Number(location.x)) || !Number.isFinite(Number(location.y))) throw new ServiceError('주소 좌표를 확인할 수 없습니다.');
    // 카카오는 경도·위도(WGS84), 오피넷은 KATEC를 사용하므로 KTM으로 변환합니다.
    const converted = await kakao('geo/transcoord', { x: location.x, y: location.y, input_coord: 'WGS84', output_coord: 'KTM' });
    const point = converted.documents?.[0];
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) throw new ServiceError('주소의 좌표를 변환하지 못했습니다.');
    const url = new URL('https://www.opinet.co.kr/api/aroundAll.do');
    // 오피넷 2026년 6월 일반 API 설명서: 인증키 매개변수는 code입니다.
    url.search = new URLSearchParams({ code: env.OPINET_API_KEY, out: 'json', x: String(point.x), y: String(point.y), radius: String(radius), prodcd: fuel, sort: '1' });
    const result = await getJSON(url, {}, '오피넷');
    // 에러를 주유소 0곳으로 바꾸지 않습니다. 정상 OIL 배열만 허용합니다.
    if (!Array.isArray(result.RESULT?.OIL)) throw new ServiceError('오피넷에서 정상 가격 목록을 받지 못했습니다. 인증키와 반경 내 주유소 API 이용 권한을 확인해 주세요.');
    // 가격이 없거나 반경 밖인 데이터는 제외하고 주유소 ID로 중복을 제거합니다.
    const unique = new Map();
    for (const oil of result.RESULT.OIL) {
      const price = Number(oil.PRICE), distance = Number(oil.DISTANCE);
      if (!oil.UNI_ID || !oil.OS_NM || !Number.isFinite(price) || price <= 0 || oil.DISTANCE == null || !Number.isFinite(distance) || distance < 0 || distance > radius) continue;
      unique.set(String(oil.UNI_ID), { id: String(oil.UNI_ID), name: String(oil.OS_NM), brand: BRANDS[oil.POLL_DIV_CD || oil.POLL_DIV_CO] || '기타', price, distance });
    }
    return { mode: 'live', address: location.address, fuel, radius, fetchedAt: new Date().toISOString(), stations: [...unique.values()].sort((a,b) => a.price - b.price || a.distance - b.distance) };
  }
  // 이 서버 인스턴스에서 동시에 처리하는 검색을 최대 4개로 제한합니다.
  let active = 0;
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
    try {
      if (request.method !== 'GET') return json(405, { error: 'GET 요청만 지원합니다.' });
      const url = new URL(request.url, 'http://localhost');
      // 설정 상태만 알려주며 인증키 값은 응답에 포함하지 않습니다.
      if (url.pathname === '/api/config') return json(200, { mode, configured });
      // 주소 검색 요청을 처리합니다. 다른 경로에서는 아래의 화면 파일을 제공합니다.
      if (url.pathname === '/api/stations') {
        if (active >= 4) return json(429, { error: '조회가 진행 중입니다. 잠시 후 다시 시도해 주세요.' });
        active++;
        try { return json(200, await stations(url.searchParams)); }
        finally { active--; }
      }
      // 허용 목록으로 공개 폴더의 파일만 제공합니다. .env와 서버 소스는 제공하지 않습니다.
      const files = { '/': ['index.html','text/html'], '/index.html': ['index.html','text/html'], '/styles.css': ['styles.css','text/css'], '/app.js': ['app.js','text/javascript'] };
      const file = files[url.pathname];
      if (!file) return json(404, { error: '페이지를 찾을 수 없습니다.' });
      const body = await readFile(new URL(file[0], PUBLIC));
      response.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' }); response.end(body);
    } catch (err) { json(err.status || 500, { error: err instanceof ServiceError ? err.message : '서버 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' }); }
  });
}

// Vercel이 호출할 기본 요청 처리 함수입니다. 포트를 열지 않습니다.
const vercelServer = createServer();
export default function handler(request, response) {
  vercelServer.emit('request', request, response);
}

// 내 컴퓨터에서 직접 실행할 때만 포트를 엽니다.
if (
  process.env.VERCEL !== '1' &&
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.on('error', err => {
    console.error(err.code === 'EADDRINUSE'
      ? `${port}번 포트가 사용 중입니다. .env의 PORT를 다른 숫자로 바꾸세요.`
      : '서버를 시작하지 못했습니다. 설정을 확인하세요.');
    process.exitCode = 1;
  });
  server.listen(port, host, () => console.log(`오일어재 서버 실행: ${host}:${port}`));
}