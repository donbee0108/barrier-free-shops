// 장벽없는마을상점 목록 화면. 상점 목록은 Apps Script(config.js의 API_URL)에서 받아 옴.
// 마지막으로 받은 목록을 이 기기에 저장해 두고 먼저 보여 준 뒤, 새 목록이 오면 바꿈.
const CAT_ORDER = ["식당", "카페", "약국", "병원", "미용", "부동산", "생활", "기타"];
const AMEN_ORDER = ["경사로", "이동식경사로", "자동문", "점자메뉴판", "점자표지판", "AAC 의사소통판", "안전손잡이", "계단 손잡이"];
const STORE_KEY = "bf-shops-v1";     // 마지막으로 받은 목록
const FILTER_KEY = "bf-store-filter"; // 마지막으로 고른 분류·편의시설
const TIMEOUT_MS = 15000;

const $ = id => document.getElementById(id);
const IS_PHONE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || matchMedia("(hover: none) and (pointer: coarse)").matches;
const TEL_HINT = IS_PHONE ? "눌러서 전화" : "눌러서 복사";

let DATA = [];
let CATS = [];
let state = { cats: new Set(), amens: new Set(), q: "" }; // cats가 비어 있으면 "전체"
// 지도 보기 상태(아래 "지도 보기"에서 씀)
let view = "list", map = null, markers = [], myDot = null, myPos = null, cardShop = null, kakaoReady = null, noteTimer = 0;
try {
  const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || "null");
  // 예전에 하나만 고르던 때 저장한 값(cat)도 받아 줌
  if (saved) { state.cats = new Set(saved.cats || (saved.cat && saved.cat !== "전체" ? [saved.cat] : [])); state.amens = new Set(saved.amens || []); }
} catch (e) {}

function esc(t) { return String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function ordered(keys, order) { return [...order.filter(k => keys.includes(k)), ...keys.filter(k => !order.includes(k))]; }

// ===== 목록 받기 =====
function apiUrl() {
  const url = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || "";
  if (!url || url.includes("여기에")) throw new Error("config.js에 웹 앱 주소가 없습니다");
  return url;
}
async function fetchShops() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl() + "?action=list", { signal: ctrl.signal, redirect: "follow" });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "목록을 받지 못했습니다");
    return data.shops;
  } finally { clearTimeout(timer); }
}
function readSaved() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { return null; } }
function save(shops) { try { localStorage.setItem(STORE_KEY, JSON.stringify(shops)); } catch (e) {} }

async function load() {
  const saved = readSaved();
  try { if (saved && saved.length) setData(saved, false); else showSkeleton(); }
  catch (e) { try { localStorage.removeItem(STORE_KEY); } catch (e2) {} DATA = []; showSkeleton(); }
  $("loadbar").hidden = false;
  try {
    const shops = await fetchShops();
    save(shops);
    setData(shops, true);
  } catch (err) {
    if (!DATA.length) showError();
  } finally { $("loadbar").hidden = true; }
}

// ===== 그리기 =====
// fresh: 서버에서 막 받은 목록일 때만, 없어진 분류·편의시설을 고른 조건에서 뺌(저장된 옛 목록으로는 빼지 않음)
function setData(shops, fresh) {
  DATA = shops;
  document.body.classList.remove("nodata");
  CATS = ordered([...new Set(DATA.map(s => s.cat))], CAT_ORDER);
  if (fresh) state.cats = new Set([...state.cats].filter(c => CATS.includes(c)));
  $("total").textContent = DATA.length;
  buildChips(fresh);
  update();
  padBody();
}
// 목록이 아직 없을 때(처음 불러오는 중·실패)는 소개 문장과 하단 독을 숨김
function showSkeleton() { document.body.classList.add("nodata"); $("results").innerHTML = '<ul class="list" style="margin-top:18px">' + '<li class="skel"></li>'.repeat(4) + "</ul>"; }
function showError() {
  document.body.classList.add("nodata");
  $("results").innerHTML = '<div class="empty">목록을 불러오지 못했습니다.<br><button class="btn" type="button" id="retry">다시 시도</button></div>';
  $("retry").onclick = load;
}
function chip(label, n, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "chip " + cls; b.dataset.key = label;
  b.innerHTML = "<span>" + esc(label) + '</span><span class="n">' + n + "</span>";
  b.onclick = onClick;
  return b;
}
// 칩은 목록을 받을 때만 새로 만들고, 고를 때는 눌림 표시만 바꿔서 넘겨 놓은 위치가 유지되게 함
function buildChips(fresh) {
  const amenCount = {};
  DATA.forEach(s => s.amen.forEach(a => amenCount[a] = (amenCount[a] || 0) + 1));
  if (fresh) state.amens = new Set([...state.amens].filter(a => amenCount[a]));
  $("cats").innerHTML = ""; $("amens").innerHTML = "";
  ["전체", ...CATS].forEach(c => $("cats").appendChild(chip(c, c === "전체" ? DATA.length : DATA.filter(s => s.cat === c).length, "cat", () => {
    // 전체를 누르면 고른 분류를 모두 풂. 분류는 여러 개 함께 고를 수 있음
    if (c === "전체") state.cats.clear(); else state.cats.has(c) ? state.cats.delete(c) : state.cats.add(c);
    update();
  })));
  ordered(Object.keys(amenCount), AMEN_ORDER).forEach(a => $("amens").appendChild(chip(a, amenCount[a], "amen", () => {
    state.amens.has(a) ? state.amens.delete(a) : state.amens.add(a); update();
  })));
}
function syncChips() {
  $("cats").querySelectorAll(".chip").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.key === "전체" ? !state.cats.size : state.cats.has(b.dataset.key))));
  $("amens").querySelectorAll(".chip").forEach(b => b.setAttribute("aria-pressed", String(state.amens.has(b.dataset.key))));
}
function matches(s) {
  if (state.cats.size && !state.cats.has(s.cat)) return false;
  for (const a of state.amens) if (!s.amen.includes(a)) return false;
  const q = state.q.trim().replace(/\s+/g, "");
  return !q || (s.name + s.addr + s.info + s.cat).replace(/\s+/g, "").includes(q);
}
// 전화 걸기는 첫 번째 번호로("(내선3)" 같은 메모는 뺌)
function dialable(tel) { const m = tel.match(/0\d{1,3}[-.\s)]*\d{3,4}[-.\s]*\d{4}/); return m ? m[0].replace(/[^\d-]/g, "") : ""; }
// 지도 검색어: "은평구 + 상호". 휴대폰에 앱이 있으면 앱으로 열림
function mapQuery(s) { return encodeURIComponent("은평구 " + s.name.replace(/\(.*?\)/g, "").trim()); }
function card(s) {
  const amen = s.amen.map(a => '<span class="amen-tag' + (state.amens.has(a) ? " hit" : "") + '">' + esc(a) + "</span>").join("");
  return '<li class="store"><div class="card-in"><div class="main"><h3>' + esc(s.name) + '<span class="kind">' + esc(s.info) + "</span></h3>" +
    '<p class="addr">' + esc(s.addr) + "</p>" +
    // 공개 번호가 없는 가게는 전화 줄을 빼고 지도 버튼만 남김
    (s.tel ? '<div><a class="tel" href="tel:' + esc(dialable(s.tel)) + '" data-tel="' + esc(s.tel) + '" aria-label="' + esc(s.name + " " + s.tel + " " + TEL_HINT) + '">' +
      '<span class="num">' + esc(s.tel) + '</span><span class="hint">' + TEL_HINT + "</span></a></div>" : "") +
    '<div class="amens">' + amen + "</div></div>" +
    '<div class="maps"><a class="map naver" href="https://map.naver.com/p/search/' + mapQuery(s) + '" target="_blank" rel="noopener" aria-label="' + esc(s.name) + ' 네이버 지도">네이버</a>' +
    '<a class="map kakao" href="https://map.kakao.com/link/search/' + mapQuery(s) + '" target="_blank" rel="noopener" aria-label="' + esc(s.name) + ' 카카오맵">카카오</a></div>' +
    "</div></li>";
}
function renderList() {
  drawMarkers();
  const hits = DATA.filter(matches);
  $("count").textContent = hits.length;
  const cond = [...CATS.filter(c => state.cats.has(c)), ...state.amens];
  $("cond").textContent = cond.length ? " · " + cond.join(", ") : "";
  $("reset").hidden = !cond.length && !state.q;
  $("optn").textContent = cond.length; $("optn").hidden = !cond.length;
  if (!hits.length) { $("results").innerHTML = '<p class="empty">조건에 맞는 상점이 없습니다.<br>편의시설 선택을 줄여 보세요.</p>'; return; }
  $("results").innerHTML = CATS.filter(c => !state.cats.size || state.cats.has(c)).map(c => {
    const g = hits.filter(s => s.cat === c);
    if (!g.length) return "";
    return '<section class="group"><h2>' + esc(c) + '<span class="n">' + g.length + '곳</span></h2><ul class="list">' + g.map(card).join("") + "</ul></section>";
  }).join("");
}
function update() {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify({ cats: [...state.cats], amens: [...state.amens] })); } catch (e) {}
  syncChips(); renderList();
}

// ===== 하단 독 =====
// 세 가지 모양: normal(첫 화면, 필터 2줄) · open(더보기, 위로 늘어남) · mini(찾기 + '검색옵션' 버튼만, 누르면 open)
let mode = "normal";
function setMode(m) {
  const was = mode; mode = m;
  $("dock").classList.toggle("open", m === "open"); $("dock").classList.toggle("mini", m === "mini");
  $("dockBg").classList.toggle("open", m === "open");
  $("more").textContent = m === "open" ? "접기" : "더보기"; $("more").setAttribute("aria-expanded", String(m === "open"));
  if (was === "open") setTimeout(padBody, 350); // 접히는 움직임(.3초)이 끝난 뒤 높이로 맞춤
}
// 독을 손가락으로 끌기: 위로 = 늘리기(접힌 모양이면 첫 화면으로), 아래로 = 접기.
// 필터 칸 안 목록이 위로 더 넘어갈 수 있으면 아래로 끌 때 목록 넘기기가 먼저
let drag = null;
$("dock").addEventListener("touchstart", e => {
  drag = e.touches.length === 1 ? { y: e.touches[0].clientY, list: e.target.closest(".chips"), mine: null, dy: 0 } : null;
}, { passive: true });
$("dock").addEventListener("touchmove", e => {
  if (!drag) return;
  const dy = e.touches[0].clientY - drag.y;
  if (drag.mine === null) {
    if (!dy) return;
    drag.mine = dy < 0 ? mode !== "open" : mode !== "mini" && !(drag.list && drag.list.scrollTop > 0);
    if (drag.mine) $("dock").classList.add("dragging");
  }
  if (!drag.mine) return;
  e.preventDefault(); drag.dy = dy;
  $("dock").style.transform = dy > 0 ? "translateY(" + Math.min(dy, 120) * .5 + "px)" : "";
}, { passive: false });
function endDrag() {
  if (!drag) return;
  if (drag.mine) {
    $("dock").classList.remove("dragging"); $("dock").style.transform = "";
    if (drag.dy < -30) setMode(mode === "mini" ? "normal" : "open");
    else if (drag.dy > 30) setMode("mini");
  }
  drag = null;
}
$("dock").addEventListener("touchend", endDrag);
$("dock").addEventListener("touchcancel", endDrag);
// 독 높이만큼 본문 아래 여백을 줘서 마지막 카드가 가려지지 않게 함(접힌 높이 기준). 지도도 독 바로 위까지만
function padBody() {
  if ($("dock").classList.contains("open")) return;
  const h = $("dock").offsetHeight;
  document.body.style.paddingBottom = h + 16 + "px";
  document.documentElement.style.setProperty("--dock-h", h + "px");
  if (map) requestAnimationFrame(() => map.relayout());
}
if ("ResizeObserver" in window) new ResizeObserver(padBody).observe($("dock")); else padBody();
$("more").onclick = () => setMode(mode === "open" ? "mini" : "open");
$("opt").onclick = () => setMode("open");
$("dockBg").onclick = () => setMode("normal");
$("reset").onclick = () => { state = { cats: new Set(), amens: new Set(), q: "" }; $("q").value = ""; update(); };
$("q").addEventListener("input", e => { state.q = e.target.value; renderList(); });

// 전화번호: 휴대폰은 tel: 링크 그대로 전화, 컴퓨터는 눌러서 복사(목록·지도 카드 모두)
document.addEventListener("click", e => {
  const b = e.target.closest(".tel");
  if (!b || IS_PHONE) return;
  e.preventDefault();
  const hint = b.querySelector(".hint");
  const done = () => { b.classList.add("done"); hint.textContent = "복사됨"; setTimeout(() => { b.classList.remove("done"); hint.textContent = TEL_HINT; }, 1500); };
  const fallback = () => { const r = document.createRange(); r.selectNodeContents(b.querySelector(".num")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); hint.textContent = "Ctrl+C로 복사"; };
  try { navigator.clipboard.writeText(b.dataset.tel).then(done, fallback); } catch (err) { fallback(); }
});

// ===== 지도 보기 =====
// 카카오 지도는 지도 탭을 처음 열 때만 불러옴. 내 위치는 이 휴대폰 안에서만 쓰고 어디에도 저장·전송하지 않음
const KAKAO_KEY = (window.APP_CONFIG && window.APP_CONFIG.KAKAO_JS_KEY) || "";
const EP_CENTER = [37.6027, 126.9291]; // 은평구청 부근
const EP_BOUNDS = { s: 37.56, n: 37.67, w: 126.87, e: 126.99 };

function loadKakao() {
  if (!kakaoReady) {
    kakaoReady = new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = "https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=" + encodeURIComponent(KAKAO_KEY);
      s.onload = () => (window.kakao && kakao.maps ? kakao.maps.load(ok) : fail(new Error("kakao")));
      s.onerror = () => fail(new Error("load"));
      document.head.appendChild(s);
    });
    kakaoReady.catch(() => { kakaoReady = null; });
  }
  return kakaoReady;
}
function setView(v) {
  view = v;
  document.body.classList.toggle("mapview", v === "map");
  $("mapwrap").hidden = v !== "map";
  $("tabList").setAttribute("aria-pressed", String(v === "list"));
  $("tabMap").setAttribute("aria-pressed", String(v === "map"));
  if (v === "map") openMap(); else { hideCard(); window.scrollTo(0, 0); }
}
async function openMap() {
  try { await loadKakao(); } catch (e) { note("지도를 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.", true); return; }
  $("mapnote").hidden = true;
  if (view !== "map") return;
  if (map) { map.relayout(); drawMarkers(); return; }
  map = new kakao.maps.Map($("map"), { center: new kakao.maps.LatLng(EP_CENTER[0], EP_CENTER[1]), level: 7 });
  kakao.maps.event.addListener(map, "click", hideCard);
  drawMarkers();
  fitAll();
  locate();
}
function placedHits() { return DATA.filter(matches).filter(s => s.lat != null && s.lng != null); }
function drawMarkers() {
  if (!map || view !== "map") return;
  markers.forEach(m => m.setMap(null));
  const hits = DATA.filter(matches), placed = placedHits();
  // 같은 건물(같은 좌표)의 상점은 핀 하나로 묶고, 누르면 함께 보여 줌
  const spots = {};
  placed.forEach(s => (spots[s.lat + "," + s.lng] = spots[s.lat + "," + s.lng] || []).push(s));
  markers = Object.values(spots).map(group => {
    const m = new kakao.maps.Marker({ map: map, position: new kakao.maps.LatLng(group[0].lat, group[0].lng), title: group.map(s => s.name).join(", "), clickable: true });
    kakao.maps.event.addListener(m, "click", () => showCard(group[0]));
    return m;
  });
  const miss = hits.length - placed.length;
  $("mapmissN").textContent = miss; $("mapmiss").hidden = !miss;
  if (cardShop && !placed.includes(cardShop)) hideCard(); else if (cardShop) showCard(cardShop);
}
// 고른 조건의 상점이 모두 보이게 지도 맞추기(없으면 은평구 가운데)
function fitAll() {
  const placed = placedHits();
  if (!placed.length) { map.setCenter(new kakao.maps.LatLng(EP_CENTER[0], EP_CENTER[1])); map.setLevel(7); return; }
  const b = new kakao.maps.LatLngBounds();
  placed.forEach(s => b.extend(new kakao.maps.LatLng(s.lat, s.lng)));
  map.setBounds(b, 40, 20, 40, 20);
}
function inEunpyeong(p) { return p.lat >= EP_BOUNDS.s && p.lat <= EP_BOUNDS.n && p.lng >= EP_BOUNDS.w && p.lng <= EP_BOUNDS.e; }
function locate() {
  if (!navigator.geolocation) { note("위치를 쓸 수 없어 은평구 전체를 보여 드립니다."); return; }
  $("locbtn").classList.add("busy"); $("locbtn").textContent = "찾는 중…";
  navigator.geolocation.getCurrentPosition(p => {
    resetLocBtn();
    myPos = { lat: p.coords.latitude, lng: p.coords.longitude };
    const ll = new kakao.maps.LatLng(myPos.lat, myPos.lng);
    if (!myDot) myDot = new kakao.maps.CustomOverlay({ map: map, position: ll, content: '<div class="me" title="내 위치"></div>', zIndex: 5 });
    else myDot.setPosition(ll);
    if (!inEunpyeong(myPos)) { note("지금 계신 곳 근처에는 상점이 없어 은평구 전체를 보여 드립니다."); fitAll(); return; }
    map.setLevel(4); map.panTo(ll);
    if (cardShop) showCard(cardShop); // 거리 다시 표시
  }, () => {
    resetLocBtn();
    note("위치를 쓸 수 없어 은평구 전체를 보여 드립니다.");
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}
function resetLocBtn() { $("locbtn").classList.remove("busy"); $("locbtn").textContent = "내 위치"; }
// 지도 위 짧은 안내. stay면 사라지지 않음(지도를 못 불러왔을 때)
function note(msg, stay) {
  $("mapnote").textContent = msg; $("mapnote").hidden = false;
  clearTimeout(noteTimer); if (!stay) noteTimer = setTimeout(() => { $("mapnote").hidden = true; }, 4000);
}
// 두 점 사이 거리(m)
function meters(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function distText(s) {
  if (!myPos || !inEunpyeong(myPos)) return "";
  const m = meters(myPos, s);
  return "내 위치에서 약 " + (m < 1000 ? Math.round(m / 10) * 10 + "m" : (m / 1000).toFixed(1) + "km");
}
function showCard(s) {
  cardShop = s;
  const group = placedHits().filter(x => x.lat === s.lat && x.lng === s.lng);
  const head = [distText(s), group.length > 1 ? "같은 건물 " + group.length + "곳" : ""].filter(Boolean).join(" · ");
  $("mapcard").innerHTML = '<div class="cardhead"><span class="dist">' + esc(head) + '</span><button class="txtbtn" type="button" id="cardclose">닫기</button></div><ul class="list">' + group.map(card).join("") + "</ul>";
  $("mapcard").hidden = false;
  $("cardclose").onclick = hideCard;
}
function hideCard() { cardShop = null; $("mapcard").hidden = true; }

if (KAKAO_KEY) {
  $("tabs").hidden = false;
  $("tabList").onclick = () => setView("list");
  $("tabMap").onclick = () => setView("map");
  $("locbtn").onclick = () => (map ? locate() : null);
  $("mapmiss").onclick = () => setView("list");
}

load();
