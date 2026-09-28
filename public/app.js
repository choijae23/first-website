/* 브라우저의 역할: 입력 받기 → 서버에 요청하기 → 결과 그리기.
   비밀 API 키는 이 파일에 넣지 않습니다. */
// $는 CSS 선택자로 화면 요소를 찾는 짧은 함수입니다.
const $ = (selector) => document.querySelector(selector);
// 오피넷의 유종 코드를 사람이 읽기 쉬운 이름으로 연결합니다.
const fuelNames = { B027: '휘발유', D047: '경유', B034: '고급휘발유', K015: 'LPG' };
// 가격에는 천 단위 쉼표를 넣고, 거리는 m 또는 km로 표시합니다.
const won = (value) => new Intl.NumberFormat('ko-KR').format(value);
const distanceText = (meters) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
// 검색 결과와 진행 중인 요청을 한곳에 보관합니다.
const state = { mode: 'live', ready: false, data: null, selection: null, controller: null, requestId: 0 };

// textContent로 문자열을 넣으면 주소나 API 응답에 HTML이 들어 있어도 실행되지 않습니다.
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
// 오류가 있으면 안내를 보여 주고, 빈 문자열이면 숨깁니다.
function error(message) { $('#error').textContent = message; $('#error').hidden = !message; }
// 새 검색을 시작할 때 이전 결과와 주소 후보를 비웁니다.
function clearResults() {
  state.data = null;
  $('#results').hidden = true;
  $('#address-choices').hidden = true;
  $('#welcome').hidden = false;
}
// 이전 검색을 취소하여 오래된 응답이 새 결과를 덮어쓰지 않게 합니다.
function cancelSearch() {
  state.requestId++;
  state.controller?.abort();
  $('#results').setAttribute('aria-busy', 'false');
  $('.search-button').textContent = '주유소 찾기 ↗';
}
// 서버의 인증키 설정 여부를 확인합니다. 실제 조회에 실패하면 오류를 표시합니다.
async function initialize() {
  try {
    if (location.protocol === 'file:') throw new Error('HTML을 더블클릭하면 실제 조회가 연결되지 않습니다. 터미널에서 npm start를 실행하고 http://127.0.0.1:3000으로 접속해 주세요.');
    const response = await fetch('/api/config', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('프로젝트 서버에 연결할 수 없습니다. npm start로 서버를 실행하고 접속 주소를 확인해 주세요.');
    const config = await response.json();
    if (config.mode !== 'live') throw new Error('이 화면은 실제 조회 전용입니다. oil-near-live 폴더의 서버를 실행해 주세요.');
    if (!config.configured) {
      $('#setup').hidden = false;
      throw new Error('카카오 REST API 키와 오피넷 인증키 설정이 필요합니다. 아래 연결 안내를 확인해 주세요.');
    }
    state.ready = true;
    $('.pill').textContent = '실제 조회 모드';
    $('#mode-text').textContent = '주소를 검색하면 오피넷의 주유소 가격을 가져옵니다. 인증키의 유효성은 검색할 때 확인합니다.';
  } catch (err) {
    $('.pill').textContent = '연결 준비 필요';
    $('#mode-text').textContent = '데이터 연결을 완료한 뒤 실제 가격을 조회할 수 있습니다.';
    error(err.message === 'Failed to fetch' ? '서버 연결을 확인해 주세요. npm start 실행 후 브라우저를 새로고침하세요.' : err.message);
  }
}
const initialized = initialize();

// 입력한 주소·유종·반경을 서버에 보내 주유소 목록을 받아옵니다.
async function search(selection = null) {
  await initialized;
  if (!state.ready) { await initialize(); if (!state.ready) return; error(''); }
  const address = $('#address').value.trim();
  if (!address) { error('검색할 주소를 입력해 주세요.'); $('#address').focus(); return; }
  cancelSearch();
  const requestId = state.requestId;
  clearResults(); error('');
  const fuel = $('input[name="fuel"]:checked').value;
  const radius = Number($('#radius').value);
  $('#status').textContent = '주소 주변의 주유소 가격을 확인하고 있어요…';
  $('.search-button').textContent = '조회 중…';
  $('#results').setAttribute('aria-busy', 'true');
  try {
    // fetch로 서버에 요청합니다. 인증키는 브라우저로 보내지 않습니다.
    state.controller = new AbortController();
    const query = new URLSearchParams({ address, fuel, radius });
    if (selection) { query.set('x', selection.x); query.set('y', selection.y); query.set('selected', selection.address); }
    const response = await fetch(`/api/stations?${query}`, { signal: state.controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '조회하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    if (requestId !== state.requestId) return;
    // 주소가 여러 곳으로 검색되면 사용자가 직접 선택하게 합니다.
    if (data.choices) {
      $('#welcome').hidden = true;
      $('#address-choices').hidden = false;
      $('#choice-list').replaceChildren();
      data.choices.forEach(choice => {
        const button = element('button', '', choice.address); button.type = 'button';
        button.addEventListener('click', () => { state.selection = choice; search(choice); });
        $('#choice-list').append(button);
      });
      $('#status').textContent = `${data.choices.length}개의 주소 후보가 있습니다. 정확한 주소를 선택해 주세요.`;
      $('#choice-list button')?.focus();
      return;
    }
    state.data = data;
    renderResults();
    $('#status').textContent = `${fuelNames[fuel]} 가격이 있는 주유소 ${data.stations.length}곳을 찾았습니다.`;
  } catch (err) {
    if (requestId !== state.requestId || err.name === 'AbortError') return;
    $('#status').textContent = '';
    error(err.message === 'Failed to fetch' ? '서버에 연결할 수 없습니다. 서버 실행 상태와 인터넷 연결을 확인한 뒤 다시 검색해 주세요.' : err.message);
  } finally {
    if (requestId === state.requestId) {
      $('.search-button').textContent = '주유소 찾기 ↗';
      $('#results').setAttribute('aria-busy', 'false');
    }
  }
}

// 받은 데이터를 최저가 카드와 주유소 목록으로 표시합니다.
function renderResults() {
  const data = state.data;
  if (!data) return;
  $('#welcome').hidden = true; $('#results').hidden = false;
  $('#result-location').textContent = `${data.address} · 반경 ${data.radius / 1000} km`;
  $('#results-title').textContent = `${fuelNames[data.fuel]} 주유소 ${data.stations.length}곳`;
  const list = $('#station-list'); list.replaceChildren();
  const comparison = $('#comparison'); comparison.replaceChildren();
  // 가격이 같으면 가까운 주유소가 앞에 오도록 정렬합니다.
  const byPrice = [...data.stations].sort((a,b) => a.price - b.price || a.distance - b.distance);
  const stations = $('#sort').value === 'distance' ? [...byPrice].sort((a,b) => a.distance - b.distance || a.price - b.price) : byPrice;
  if (!stations.length) {
    list.append(element('div', 'empty', '이 범위에서 해당 유종의 가격 정보가 없습니다. 검색 반경을 넓히거나 다른 유종을 선택해 보세요.'));
  } else {
    // 정렬된 첫 주유소를 최저가로 정하고 같은 가격인 곳도 표시합니다.
    const best = byPrice[0];
    const tied = byPrice.filter(s => s.price === best.price).length;
    const card = element('article', 'best-card');
    const detail = element('div');
    detail.append(element('div', 'best-label', `검색 결과 최저가${tied > 1 ? ` · 같은 가격 ${tied}곳` : ''}`), element('h3', '', best.name), element('p', '', `${best.brand} · 직선거리 ${distanceText(best.distance)}`));
    const price = element('div', 'best-price');
    price.append(element('strong', '', won(best.price)), element('span', '', '원/L'));
    price.append(element('p', '', `${fuelNames[data.fuel]} 기준${tied > 1 ? ' · 동률 중 가장 가까운 곳' : ''}`));
    card.append(detail, price); comparison.append(card);
    stations.forEach((station, index) => {
      const row = element('article', 'station-card');
      const info = element('div', 'station-info');
      const title = element('h3', '', station.name);
      if (station.price === best.price) title.append(element('span', 'tag', '최저가'));
      info.append(title, element('p', '', `${station.brand} · ${distanceText(station.distance)}`));
      const cost = element('div', 'station-price');
      cost.append(element('strong', '', won(station.price)), element('small', '', '원/L'), element('p', '', station.price === best.price ? '가장 낮은 가격' : `최저가보다 +${won(station.price - best.price)}원`));
      row.append(element('span', 'rank', String(index + 1).padStart(2, '0')), info, cost); list.append(row);
    });
  }
  $('#data-note').textContent = `출처: 한국석유공사 오피넷 · 조회 시각 ${new Date(data.fetchedAt).toLocaleString('ko-KR')} · 조회 시각은 판매가격 갱신 시각과 다릅니다. 가격 정보가 없는 주유소는 비교에서 제외됩니다.`;
}

// 검색 버튼, 정렬, 유종, 주소 입력 등 사용자 행동에 함수를 연결합니다.
$('#search-form').addEventListener('submit', event => { event.preventDefault(); search(state.selection); });
$('#sort').addEventListener('change', renderResults);
document.querySelectorAll('input[name="fuel"], #radius').forEach(input => input.addEventListener('change', () => { if ($('#address').value.trim()) search(state.selection); }));
$('#address').addEventListener('input', () => { cancelSearch(); state.selection = null; clearResults(); if (state.ready) error(''); $('#status').textContent = '주소 입력 후 주유소 찾기를 눌러 주세요.'; });
