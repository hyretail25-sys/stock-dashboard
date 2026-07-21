/**
 * 카카오톡 "나에게 보내기" 재고 알림
 * data.json(당일 수집 데이터)을 읽어 발주 알림 + 정상재고 현황을 본인 카톡으로 발송.
 * 필요 Secrets: KAKAO_REST_KEY, KAKAO_REFRESH_TOKEN (없으면 조용히 생략)
 */
const fs = require("fs");

const WEEKS = 6; // 적정재고 기준(주) — 대시보드 기본값과 동일
const DASH_URL = "https://hyretail25-sys.github.io/stock-dashboard/";

async function main() {
  const { KAKAO_REST_KEY, KAKAO_REFRESH_TOKEN, KAKAO_CLIENT_SECRET } = process.env;
  if (!KAKAO_REST_KEY || !KAKAO_REFRESH_TOKEN) {
    console.log("카카오 키 미설정 — 카톡 알림 생략");
    return;
  }
  const { updatedAt, products } = JSON.parse(fs.readFileSync("data.json", "utf-8"));

  // 대시보드와 동일한 판정 로직
  const rows = products.map((p) => {
    const sales7 = p.daily.slice(-7).reduce((a, b) => a + b, 0);
    const avg7 = sales7 / 7;
    const target = Math.ceil(avg7 * WEEKS * 7);
    const avail = p.stock - p.backlog;
    const daysLeft = avail <= 0 ? 0 : avg7 > 0 ? avail / avg7 : Infinity;
    let status;
    if (avg7 === 0 && p.backlog === 0) status = "판매없음";
    else if (avail <= 0) status = "품절";
    else if (avail <= target) status = "발주필요";
    else if (avail <= target + avg7 * 21) status = "주의";
    else status = "충분";
    const reorder = status === "발주필요" || status === "품절" ? Math.max(0, target - avail) : 0;
    return { ...p, avg7, avail, daysLeft, status, reorder };
  });

  const nm = (s) => (s.length > 11 ? s.slice(0, 11) + "…" : s);
  const dd = (r) => (isFinite(r.daysLeft) ? `D-${Math.floor(r.daysLeft)}` : "-");
  const L = [];
  L.push(`📦 재고알림 ${updatedAt}`);

  const crit = rows.filter((r) => r.status === "품절" || r.status === "발주필요").sort((a, b) => a.daysLeft - b.daysLeft);
  const warn = rows.filter((r) => r.status === "주의").sort((a, b) => a.daysLeft - b.daysLeft);
  if (crit.length === 0) L.push("✅ 발주 필요 상품 없음");
  crit.forEach((r) =>
    L.push(
      r.status === "품절"
        ? `🔴${nm(r.name)} 품절·미출고${r.backlog.toLocaleString()} → 발주 ${r.reorder.toLocaleString()}개`
        : `🟠${nm(r.name)} ${dd(r)} 재고${r.stock.toLocaleString()} → 발주 ${r.reorder.toLocaleString()}개`
    )
  );
  warn.forEach((r) => L.push(`🟡${nm(r.name)} ${dd(r)} 재고${r.stock.toLocaleString()}`));

  L.push("— 정상재고 현황 —");
  rows
    .filter((r) => r.status === "충분")
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .forEach((r) => L.push(`${nm(r.name)} ${r.stock.toLocaleString()}개 ${dd(r)}`));
  const rest = rows.filter((r) => r.status === "판매없음");
  if (rest.length)
    L.push(`외 ${rest.length}종(부자재 등) ${rest.reduce((a, r) => a + r.stock, 0).toLocaleString()}개`);

  // 토큰 갱신
  const tk = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: KAKAO_REST_KEY,
      refresh_token: KAKAO_REFRESH_TOKEN,
      ...(KAKAO_CLIENT_SECRET ? { client_secret: KAKAO_CLIENT_SECRET } : {}),
    }),
  }).then((r) => r.json());
  if (!tk.access_token) throw new Error("카카오 토큰 갱신 실패: " + JSON.stringify(tk));
  if (tk.refresh_token)
    console.log("⚠️ 카카오가 새 refresh token을 발급했습니다. GitHub Secrets의 KAKAO_REFRESH_TOKEN을 새 값으로 교체하세요: (로그 보안상 값은 미출력 — 재인증 필요 시 안내)");

  // 200자 제한에 맞춰 나눠 발송
  const chunks = [];
  let cur = "";
  for (const line of L) {
    if ((cur + "\n" + line).length > 190) {
      chunks.push(cur);
      cur = line;
    } else cur = cur ? cur + "\n" + line : line;
  }
  if (cur) chunks.push(cur);

  for (let i = 0; i < chunks.length; i++) {
    const tmpl = {
      object_type: "text",
      text: chunks[i],
      link: { web_url: DASH_URL, mobile_web_url: DASH_URL },
      button_title: "대시보드 열기",
    };
    const res = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tk.access_token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ template_object: JSON.stringify(tmpl) }),
    }).then((r) => r.json());
    if (res.result_code !== 0) throw new Error("카톡 발송 실패: " + JSON.stringify(res));
    console.log(`카톡 ${i + 1}/${chunks.length} 발송 완료`);
  }
}

main().catch((e) => {
  console.error("카카오 알림 오류(워크플로는 계속 진행):", e.message);
  process.exit(0); // 알림 실패가 대시보드 갱신을 막지 않도록
});
