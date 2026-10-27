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
let state = { cat: "전체", amens: new Set(), q: "" };
try {
  const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || "null");
  if (saved) { state.cat = saved.cat || "전체"; state.amens = new Set(saved.amens || []); }
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
  if (fresh && state.cat !== "전체" && !CATS.includes(state.cat)) state.cat = "전체";
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
  ["전체", ...CATS].forEach(c => $("cats").appendChild(chip(c, c === "전체" ? DATA.length : DATA.filter(s => s.cat === c).length, "cat", () => { state.cat = c; update(); })));
  ordered(Object.keys(amenCount), AMEN_ORDER).forEach(a => $("amens").appendChild(chip(a, amenCount[a], "amen", () => {
    state.amens.has(a) ? state.amens.delete(a) : state.amens.add(a); update();
  })));
}
function syncChips() {
  $("cats").querySelectorAll(".chip").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.key === state.cat)));
  $("amens").querySelectorAll(".chip").forEach(b => b.setAttribute("aria-pressed", String(state.amens.has(b.dataset.key))));
}
function matches(s) {
  if (state.cat !== "전체" && s.cat !== state.cat) return false;
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
  const hits = DATA.filter(matches);
  $("count").textContent = hits.length;
  const cond = [state.cat !== "전체" ? state.cat : "", ...state.amens].filter(Boolean);
  $("cond").textContent = cond.length ? " · " + cond.join(", ") : "";
  $("reset").hidden = !cond.length && !state.q;
  if (!hits.length) { $("results").innerHTML = '<p class="empty">조건에 맞는 상점이 없습니다.<br>편의시설 선택을 줄여 보세요.</p>'; return; }
  $("results").innerHTML = CATS.filter(c => state.cat === "전체" || c === state.cat).map(c => {
    const g = hits.filter(s => s.cat === c);
    if (!g.length) return "";
    return '<section class="group"><h2>' + esc(c) + '<span class="n">' + g.length + '곳</span></h2><ul class="list">' + g.map(card).join("") + "</ul></section>";
  }).join("");
}
function update() {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify({ cat: state.cat, amens: [...state.amens] })); } catch (e) {}
  syncChips(); renderList();
}

// ===== 하단 독 =====
function setOpen(on) {
  $("dock").classList.toggle("open", on); $("dockBg").classList.toggle("open", on);
  $("more").textContent = on ? "접기" : "더보기"; $("more").setAttribute("aria-expanded", String(on));
  if (!on) setTimeout(padBody, 350); // 접히는 움직임(.3초)이 끝난 뒤 높이로 맞춤
}
// 독 높이만큼 본문 아래 여백을 줘서 마지막 카드가 가려지지 않게 함(접힌 높이 기준)
function padBody() { if (!$("dock").classList.contains("open")) document.body.style.paddingBottom = $("dock").offsetHeight + 16 + "px"; }
if ("ResizeObserver" in window) new ResizeObserver(padBody).observe($("dock")); else padBody();
$("more").onclick = () => setOpen(!$("dock").classList.contains("open"));
$("dockBg").onclick = () => setOpen(false);
$("reset").onclick = () => { state = { cat: "전체", amens: new Set(), q: "" }; $("q").value = ""; update(); };
$("q").addEventListener("input", e => { state.q = e.target.value; renderList(); });

// 전화번호: 휴대폰은 tel: 링크 그대로 전화, 컴퓨터는 눌러서 복사
$("results").addEventListener("click", e => {
  const b = e.target.closest(".tel");
  if (!b || IS_PHONE) return;
  e.preventDefault();
  const hint = b.querySelector(".hint");
  const done = () => { b.classList.add("done"); hint.textContent = "복사됨"; setTimeout(() => { b.classList.remove("done"); hint.textContent = TEL_HINT; }, 1500); };
  const fallback = () => { const r = document.createRange(); r.selectNodeContents(b.querySelector(".num")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); hint.textContent = "Ctrl+C로 복사"; };
  try { navigator.clipboard.writeText(b.dataset.tel).then(done, fallback); } catch (err) { fallback(); }
});

load();
