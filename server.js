/**
 * railway-puppeteer/server.js
 * JS 렌더링 전용 Puppeteer 크롤러 서버 (Railway 배포용)
 *
 * POST /scrape  { url: string, key?: string }
 *   → { ok: true, html: string }  |  { ok: false, error: string }
 *
 * 인증: Authorization: Bearer <SCRAPER_SECRET>
 * 환경변수:
 *   SCRAPER_SECRET      — Vercel scrape-campaigns.js 와 공유하는 비밀키
 *   KV_REST_API_URL     — (선택) Vercel KV URL, 직접 저장 용도로만 사용
 *   KV_REST_API_TOKEN   — (선택) Vercel KV Token
 *   PORT                — Railway가 자동으로 주입 (기본 3000)
 */

import express from "express";
import puppeteer from "puppeteer";

const app  = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SCRAPER_SECRET || "";

app.use(express.json());

// ── 헬스 체크 ──────────────────────────────────────────
app.get("/", (_req, res) => res.json({ ok: true, service: "puppeteer-scraper" }));

// ── 크롤링 엔드포인트 ──────────────────────────────────
app.post("/scrape", async (req, res) => {
  // 인증 검사
  if (SECRET) {
    const auth = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (auth !== SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  const { url, waitFor = 2500 } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, error: "url 파라미터 필요" });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",   // Railway 메모리 절약
      ],
    });

    const page = await browser.newPage();

    // 한국어 브라우저처럼 보이게
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });

    // 이미지/폰트 차단 → 빠른 렌더링
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 20000,
    });

    // JS 렌더링 완료 대기
    await new Promise((r) => setTimeout(r, waitFor));

    const html = await page.content();
    await browser.close();

    return res.json({ ok: true, html });
  } catch (e) {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`[puppeteer-scraper] listening on :${PORT}`);
});
