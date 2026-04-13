/**
 * railway-puppeteer/server.js
 * 체험단 크롤러 서버 (Railway 배포용)
 *
 * GET  /          — 헬스 체크
 * POST /crawl     — 모든 사이트 크롤링 후 KV에 직접 저장 (Vercel 타임아웃 없음)
 * GET  /crawl     — 동일 (Railway cron 호환)
 *
 * 환경변수:
 *   SCRAPER_SECRET    — 인증키
 *   KV_REST_API_URL   — Vercel KV URL
 *   KV_REST_API_TOKEN — Vercel KV Token
 *   PORT              — Railway 자동 주입
 */

import express from "express";
import puppeteer from "puppeteer";

const app    = express();
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.SCRAPER_SECRET || "";
const KV_URL   = (process.env.KV_REST_API_URL || "").replace(/\/$/, "");
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";

app.use(express.json());

// ── KV 헬퍼 ───────────────────────────────────────────
async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) return false;
  try {
    const serialized = JSON.stringify(value);
    const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(serialized)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const d = await r.json();
    return d.result === "OK";
  } catch (e) {
    console.error("[KV] set error:", e.message);
    return false;
  }
}

// ── 파싱 유틸 ─────────────────────────────────────────
const KW = ["체험단","모집","리뷰어","블로그","인스타","후기","체험","무료","협찬","서포터즈"];
const REGIONS = ["서울","경기","부산","인천","대구","광주","대전","울산","강원","제주","전국","온라인"];

function isCampaignLike(text) {
  if (!text || text.length < 6 || text.length > 120) return false;
  return KW.some(k => text.includes(k));
}
function extractRegion(text) {
  for (const r of REGIONS) if (text.includes(r)) return r;
  return "전국";
}
function extractReward(text) {
  const m = text.match(/(\d+)\s*만\s*원/);
  if (m) return { reward: `${m[1]}만원 상당`, rewardVal: parseInt(m[1]) * 10000 };
  return { reward: "정보 확인 필요", rewardVal: 0 };
}

let gId = Date.now();

const URL_PATTERNS = {
  gangnam:     /\/cp\/[?]id=\d+/,
  dinnerqueen: /\/taste\/\d+/,
};

function parseHtml(html, site) {
  const results = [];
  const seen = new Set();
  const pattern = URL_PATTERNS[site.key];
  const baseUrl = (() => { try { return new URL(site.url).origin; } catch { return ""; } })();
  const re = /<a[^>]+href=["']([^"'#][^"']*?)["'][^>]*>([\s\S]{2,200}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let [, href, rawText] = m;
    const text = rawText.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!text || text.length < 4) continue;
    const fullHref = href.startsWith("http") ? href : baseUrl + (href.startsWith("/") ? href : "/" + href);

    if (pattern) {
      if (!pattern.test(fullHref) || seen.has(fullHref)) continue;
      seen.add(fullHref);
    } else {
      if (!isCampaignLike(text) || seen.has(text)) continue;
      seen.add(text);
    }

    const { reward, rewardVal } = extractReward(text);
    results.push({
      id: `${site.key}_${++gId}`,
      title: text.slice(0, 60),
      source: site.name,
      region: extractRegion(text),
      tags: [],
      reward, rewardVal,
      deadline: Math.floor(Math.random() * 12) + 1,
      url: pattern ? fullHref : (href.startsWith("http") ? href : baseUrl + (href.startsWith("/") ? href : "/" + href)),
      scraped: true,
    });
    if (results.length >= 15) break;
  }
  return results;
}

// ── Puppeteer로 JS 렌더링 ─────────────────────────────
async function fetchWithPuppeteer(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox", "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", "--disable-gpu",
        "--no-first-run", "--no-zygote", "--single-process",
      ],
    });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });
    await page.setRequestInterception(true);
    page.on("request", req => {
      if (["image", "stylesheet", "font", "media"].includes(req.resourceType())) req.abort();
      else req.continue();
    });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
    await new Promise(r => setTimeout(r, 2000));
    const html = await page.content();
    await browser.close();
    return html;
  } catch (e) {
    if (browser) try { await browser.close(); } catch {}
    throw e;
  }
}

// ── 일반 fetch ────────────────────────────────────────
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9",
  "Cache-Control": "no-cache",
};
async function fetchHtml(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: HEADERS });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ── 사이트 정의 ───────────────────────────────────────
const SITES = [
  { name: "강남맛집체험단", url: "https://xn--939au0g4vj8sq.net", fallback: "http://xn--939au0g4vj8sq.net", key: "gangnam",     jsRender: true  },
  { name: "디너의여왕",     url: "https://dinnerqueen.net",         key: "dinnerqueen", jsRender: true  },
  { name: "레뷰",           url: "https://www.revu.net/campaign",   key: "revu",        jsRender: false },
  { name: "모두의체험단",   url: "https://www.modan.kr",            key: "modan",       jsRender: false },
  { name: "태그바이",       url: "https://www.tagby.io/recruit",    key: "tagby",       jsRender: false },
];

// ── 사이트별 크롤링 ───────────────────────────────────
async function scrapeSite(site) {
  const now = new Date().toISOString();
  try {
    let html = "";
    if (site.jsRender) {
      // Puppeteer 사용 (Railway는 타임아웃 없음)
      try {
        html = await fetchWithPuppeteer(site.url);
      } catch (e) {
        console.warn(`[${site.name}] Puppeteer 실패, fetch fallback:`, e.message);
        html = await fetchHtml(site.fallback || site.url);
      }
    } else {
      html = await fetchHtml(site.url);
    }
    const campaigns = parseHtml(html, site);
    console.log(`[${site.name}] ${campaigns.length}개 수집`);
    return { name: site.name, ok: true, campaigns, count: campaigns.length, scrapedAt: now };
  } catch (e) {
    console.error(`[${site.name}] 실패:`, e.message);
    return { name: site.name, ok: false, error: String(e.message), campaigns: [], scrapedAt: now };
  }
}

// ── 전체 크롤링 실행 ──────────────────────────────────
async function runCrawl() {
  console.log("[crawl] 시작");
  // JS 렌더링 사이트는 순차 실행 (메모리 절약), 일반 사이트는 병렬
  const jsSites    = SITES.filter(s => s.jsRender);
  const plainSites = SITES.filter(s => !s.jsRender);

  const jsResults = [];
  for (const site of jsSites) {
    jsResults.push(await scrapeSite(site));
  }
  const plainResults = await Promise.allSettled(plainSites.map(s => scrapeSite(s)));
  const plainResolved = plainResults.map((r, i) =>
    r.status === "fulfilled" ? r.value
    : { name: plainSites[i].name, ok: false, error: "예외", campaigns: [], scrapedAt: new Date().toISOString() }
  );

  const allResults = [...jsResults, ...plainResolved];
  const allCampaigns = allResults.flatMap(r => r.campaigns || []);
  const updatedAt = new Date().toISOString();

  // KV에 저장
  const saved = await kvSet("campaigns:data", { campaigns: allCampaigns, updatedAt });
  await kvSet("campaigns:status", allResults.map(r => ({
    name: r.name, ok: r.ok, count: r.campaigns?.length || 0,
    error: r.error || null, scrapedAt: r.scrapedAt,
  })));

  console.log(`[crawl] 완료 — 총 ${allCampaigns.length}개, KV 저장: ${saved}`);
  return { total: allCampaigns.length, updatedAt, sites: allResults.map(r => ({ name: r.name, ok: r.ok, count: r.count || 0, error: r.error || null })) };
}

// ── 인증 미들웨어 ─────────────────────────────────────
function authCheck(req, res, next) {
  if (!SECRET) return next();
  const auth = (req.headers.authorization || "").replace("Bearer ", "").trim();
  if (auth !== SECRET) return res.status(401).json({ ok: false, error: "Unauthorized" });
  next();
}

// ── 엔드포인트 ────────────────────────────────────────
app.get("/", (_req, res) => res.json({ ok: true, service: "blogauto-crawler", sites: SITES.length }));

// Vercel에서 트리거 or Railway cron
app.post("/crawl", authCheck, async (_req, res) => {
  try {
    const result = await runCrawl();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

// Railway cron용 GET도 지원
app.get("/crawl", authCheck, async (_req, res) => {
  try {
    const result = await runCrawl();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

app.listen(PORT, () => {
  console.log(`[blogauto-crawler] listening on :${PORT}`);
});
