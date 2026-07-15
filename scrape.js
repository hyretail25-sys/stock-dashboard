/**
 * 이지어드민 재고·판매 데이터 수집 → 대시보드 생성 스크립트
 * GitHub Actions에서 매일 실행됩니다.
 *
 * 필요 환경변수 (GitHub Secrets):
 *   EZ_DOMAIN  이지어드민 도메인
 *   EZ_ID      이지어드민 아이디
 *   EZ_PW      이지어드민 비밀번호
 */
const { chromium } = require("playwright");
const fs = require("fs");

const DAYS = 14; // 일별 판매 수집 기간

function kstNow() {
  return new Date(Date.now() + 9 * 3600 * 1000); // UTC+9
}
function ymd(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const { EZ_DOMAIN, EZ_ID, EZ_PW } = process.env;
  if (!EZ_DOMAIN || !EZ_ID || !EZ_PW) throw new Error("EZ_DOMAIN / EZ_ID / EZ_PW 환경변수가 필요합니다");

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  });
  const page = await ctx.newPage();

  // ---------- 1. 로그인 ----------
  console.log("[1/4] 로그인 페이지 접속");
  await page.goto("https://login3.ezadmin.co.kr/login.htm", { waitUntil: "domcontentloaded", timeout: 60000 });

  await page.fill('input[placeholder="도메인"]', EZ_DOMAIN);
  await page.fill('input[placeholder="아이디"]', EZ_ID);
  await page.fill('input[placeholder="비밀번호"]', EZ_PW);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
    page.click('button:has-text("로그인"), input[type=submit], a:has-text("로그인")'),
  ]);

  const url = page.url();
  if (url.includes("login3.ezadmin")) {
    // 비밀번호 오류·추가 인증 등
    const body = (await page.textContent("body").catch(() => "")) || "";
    throw new Error("로그인 실패 — 여전히 로그인 페이지입니다. 페이지 메시지: " + body.slice(0, 300));
  }
  const origin = new URL(url).origin; // 예: https://ga68.ezadmin.co.kr
  console.log("로그인 성공:", origin);

  // ---------- 2. 현 재고조회 (I100) ----------
  console.log("[2/4] 현 재고조회 수집");
  await page.goto(origin + "/template35.htm?template=I100", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.click('text=검색(F2)');
  await page.waitForTimeout(4000);

  const stockRows = await page.evaluate(() => {
    const ht = document.querySelector(".ui-jqgrid-htable");
    const bt = document.querySelector(".ui-jqgrid-btable");
    if (!ht || !bt) return { error: "그리드를 찾지 못함" };
    const heads = [...ht.querySelectorAll("th")].map((t) => t.innerText.trim().replace(/\s+/g, ""));
    const col = (label) => heads.findIndex((h) => h === label);
    // '상품코드'가 2개 존재(숨김+표시)하므로 마지막 것을 사용
    const codeIdx = heads.lastIndexOf("상품코드");
    const idx = { name: col("상품명"), stock: col("정상재고"), backlog: col("접수") };
    const num = (s) => parseInt((s || "0").replace(/[^\d-]/g, ""), 10) || 0;
    const rows = [...bt.rows]
      .filter((r) => r.cells.length >= heads.length - 2)
      .map((r) => ({
        code: r.cells[codeIdx] ? r.cells[codeIdx].innerText.trim() : "",
        name: r.cells[idx.name] ? r.cells[idx.name].innerText.trim() : "",
        stock: num(r.cells[idx.stock] && r.cells[idx.stock].innerText),
        backlog: num(r.cells[idx.backlog] && r.cells[idx.backlog].innerText),
      }))
      .filter((r) => r.code);
    return { heads, rows };
  });
  if (stockRows.error) throw new Error("현 재고조회: " + stockRows.error);
  console.log(`재고 ${stockRows.rows.length}개 품목 수집`);
  if (stockRows.rows.length === 0) throw new Error("현 재고조회 결과 0건 — 헤더: " + stockRows.heads.join(","));

  // ---------- 3. 일자별 재고조회 (IE10) — 최근 14일 발주수량 ----------
  console.log("[3/4] 일자별 발주수량 수집");
  const end = kstNow();
  const start = new Date(end.getTime() - (DAYS - 1) * 864e5);
  await page.goto(origin + "/template40.htm?template=IE10", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  await page.evaluate(
    ({ s, e }) => {
      // 기간 시작/종료 입력: 값이 YYYY-MM-DD 형태인 처음 두 input
      const dateInputs = [...document.querySelectorAll('input[type=text]')].filter((i) =>
        /^\d{4}-\d{2}-\d{2}$/.test(i.value)
      );
      if (dateInputs.length >= 2) {
        dateInputs[0].value = s;
        dateInputs[1].value = e;
        dateInputs[0].dispatchEvent(new Event("change", { bubbles: true }));
        dateInputs[1].dispatchEvent(new Event("change", { bubbles: true }));
      }
      // 작업 드롭다운 → 발주(order)
      const sel = [...document.querySelectorAll("select")].find((s2) =>
        [...s2.options].some((o) => o.value === "order")
      );
      if (sel) {
        sel.value = "order";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },
    { s: ymd(start), e: ymd(end) }
  );
  await page.click('text=검색(F2)');
  await page.waitForTimeout(5000);

  const salesRows = await page.evaluate(() => {
    const ht = document.querySelector(".ui-jqgrid-htable");
    const bt = document.querySelector(".ui-jqgrid-btable");
    if (!ht || !bt) return { error: "그리드를 찾지 못함" };
    const heads = [...ht.querySelectorAll("th")].map((t) => t.innerText.trim());
    const dayCols = heads.map((h, i) => (/^\d{2}-\d{2}$/.test(h) ? i : -1)).filter((i) => i >= 0);
    const codeIdx = heads.findIndex((h) => h.replace(/\s+/g, "") === "상품코드");
    const num = (s) => parseInt((s || "0").replace(/[^\d-]/g, ""), 10) || 0;
    const rows = [...bt.rows]
      .filter((r) => r.cells.length >= heads.length - 1)
      .map((r) => ({
        code: r.cells[codeIdx] ? r.cells[codeIdx].innerText.trim() : "",
        daily: dayCols.map((i) => num(r.cells[i] && r.cells[i].innerText)),
      }))
      .filter((r) => r.code);
    return { heads, rows, dayCount: dayCols.length };
  });
  if (salesRows.error) throw new Error("일자별 재고조회: " + salesRows.error);
  console.log(`판매 데이터 ${salesRows.rows.length}개 품목, ${salesRows.dayCount}일치 수집`);

  await browser.close();

  // ---------- 4. 대시보드 생성 ----------
  console.log("[4/4] 대시보드 생성");
  const salesMap = Object.fromEntries(salesRows.rows.map((r) => [r.code, r.daily]));
  const zero = Array(DAYS).fill(0);
  const products = stockRows.rows.map((r) => ({
    code: r.code,
    name: r.name,
    opt: "",
    stock: r.stock,
    backlog: r.backlog,
    daily: (salesMap[r.code] || zero).slice(-DAYS),
  }));

  const updatedAt = kstNow().toISOString().slice(0, 16).replace("T", " ");
  let html = fs.readFileSync("template.html", "utf-8");
  html = html
    .replace("__UPDATED_AT__", updatedAt)
    .replace("__PRODUCTS_JSON__", JSON.stringify(products, null, 1));
  fs.writeFileSync("index.html", html);
  fs.writeFileSync("data.json", JSON.stringify({ updatedAt, products }, null, 1));
  console.log(`완료: ${products.length}개 품목, 기준 ${updatedAt} (KST)`);
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
