// 실제 API 키 없이 가짜 응답으로 검색 처리와 오류 안내를 검사합니다.
// 테스트용 데이터는 실제 사이트의 검색 결과로 사용하지 않습니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

const env = { DATA_MODE: 'live', KAKAO_REST_API_KEY: 'test-kakao-secret', OPINET_API_KEY: 'test-opinet-secret' };
const addressResult = { documents: [{ address_name: '서울 중구 세종대로 110', x: '126.978', y: '37.566' }] };
const query = '/api/stations?address=test&fuel=B027&radius=3000';
test('설정 없이도 live 전용이며 예시 파일을 제공하지 않음', async () => {
  await withServer({ env: {} }, async base => {
    assert.deepEqual(await (await fetch(base + '/api/config')).json(), { mode: 'live', configured: false });
    assert.equal((await fetch(base + query)).status, 503);
    assert.equal((await fetch(base + '/demo.js')).status, 404);
    const page = await (await fetch(base)).text();
    assert.ok(!page.includes('src="demo.js"')); assert.ok(page.includes('id="setup"'));
  });
});
test('외부 인증 실패와 호출 한도에 따른 안내', async () => {
  for (const [upstream, status, message] of [[401,502,'인증'],[403,502,'인증'],[429,429,'호출 한도']]) {
    await withServer({ env, fetcher: async () => new Response('', { status: upstream }) }, async base => {
      const response = await fetch(base + query); assert.equal(response.status, status);
      assert.ok((await response.json()).error.includes(message));
    });
  }
});
async function withServer(options, run) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
function mock(oil, seen = []) {
  return async url => {
    seen.push(String(url));
    const body = String(url).includes('search/address') ? addressResult : String(url).includes('transcoord') ? { documents: [{ x: 310000, y: 550000 }] } : oil;
    return new Response(JSON.stringify(body));
  };
}
test('실제 조회 흐름: 좌표 변환, 유종 전달, 무효 가격 제외, 중복 제거, 가격 정렬', async () => {
  const seen = [];
  await withServer({ env, fetcher: mock({ RESULT: { OIL: [
    { UNI_ID: 'a', OS_NM: 'A', POLL_DIV_CD: 'GSC', PRICE: 1700, DISTANCE: 700 },
    { UNI_ID: 'b', OS_NM: 'B', POLL_DIV_CO: 'SOL', PRICE: 1600, DISTANCE: 900 },
    { UNI_ID: 'c', OS_NM: 'C', PRICE: 0, DISTANCE: 500 },
    { UNI_ID: 'd', OS_NM: 'D', PRICE: 1500, DISTANCE: 4000 },
    { UNI_ID: 'a', OS_NM: 'A', PRICE: 1700, DISTANCE: 700 }
  ] } }, seen) }, async base => {
    const response = await fetch(base + query), data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.stations.length, 2);
    assert.equal(data.stations[0].id, 'b'); assert.equal(data.stations[0].brand, 'S-OIL');
    assert.equal(new URL(seen[1]).searchParams.get('output_coord'), 'KTM');
    assert.equal(new URL(seen[2]).searchParams.get('prodcd'), 'B027');
    assert.equal(new URL(seen[2]).searchParams.get('code'), env.OPINET_API_KEY);
    assert.equal(new URL(seen[2]).searchParams.has('certkey'), false);
    assert.ok(!JSON.stringify(data).includes('secret'));
  });
});
test('API 오류를 빈 결과로 숨기지 않고 키를 노출하지 않음', async () => {
  await withServer({ env, fetcher: mock({ RESULT: { ERROR: 'invalid test-opinet-secret' } }) }, async base => {
    const response = await fetch(base + query), data = await response.json();
    assert.equal(response.status, 502); assert.ok(data.error); assert.ok(!JSON.stringify(data).includes('secret'));
  });
});
test('정상 빈 목록은 200 및 빈 배열', async () => {
  await withServer({ env, fetcher: mock({ RESULT: { OIL: [] } }) }, async base => {
    const response = await fetch(base + query); assert.equal(response.status, 200); assert.deepEqual((await response.json()).stations, []);
  });
});
test('주소가 모호하면 임의 선택하지 않음', async () => {
  await withServer({ env, fetcher: async () => new Response(JSON.stringify({ documents: [...addressResult.documents, { address_name: '다른 주소', x: '127', y: '37' }] })) }, async base => {
    const data = await (await fetch(base + query)).json(); assert.equal(data.choices.length, 2); assert.equal(data.stations, undefined);
  });
});
test('입력값 검증, 비밀 파일 차단, 설정 키 비노출', async () => {
  await withServer({ env, fetcher: () => { throw new Error('외부 호출되면 안 됨'); } }, async base => {
    assert.equal((await fetch(base + query.replace('3000', '99999'))).status, 400);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/server.js')).status, 404);
    assert.deepEqual(await (await fetch(base + '/api/config')).json(), { mode: 'live', configured: true });
  });
});
test('키 누락 및 외부 통신 실패를 구분하여 처리', async () => {
  await withServer({ env: { DATA_MODE: 'live' } }, async base => assert.equal((await fetch(base + query)).status, 503));
  await withServer({ env, fetcher: async () => { throw new Error('network test-secret'); } }, async base => {
    const response = await fetch(base + query); assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('test-secret'));
  });
});
