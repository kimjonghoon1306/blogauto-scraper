# blogauto-puppeteer-scraper

BlogAuto Pro의 JS 렌더링 사이트 크롤링 전용 서버입니다.  
Railway에 독립적으로 배포하며, 기존 Vercel 프로젝트는 전혀 수정하지 않습니다.

---

## Railway 배포 순서

### 1. 이 폴더만 새 GitHub 레포로 생성

```bash
# 예시: blogauto-scraper 레포 생성 후
git init
git add .
git commit -m "init puppeteer scraper"
git remote add origin https://github.com/YOUR_NAME/blogauto-scraper.git
git push -u origin main
```

### 2. Railway 프로젝트 생성

1. https://railway.app → **New Project** → **Deploy from GitHub repo**
2. 위에서 만든 `blogauto-scraper` 레포 선택
3. 자동 감지: nixpacks.toml 있으면 Nixpacks 빌드 사용

### 3. 환경변수 설정 (Railway 대시보드 → Variables)

| 키 | 값 | 설명 |
|---|---|---|
| `SCRAPER_SECRET` | `랜덤_비밀키_생성` | Vercel과 공유할 인증키 (필수) |
| `KV_REST_API_URL` | Vercel KV URL | (선택) 직접 KV 접근 시 |
| `KV_REST_API_TOKEN` | Vercel KV Token | (선택) |

> `SCRAPER_SECRET` 생성 예: `openssl rand -hex 32`

### 4. Vercel 환경변수 추가 (기존 프로젝트)

| 키 | 값 |
|---|---|
| `RAILWAY_SCRAPER_URL` | Railway 배포 후 생성된 URL (예: `https://blogauto-scraper.up.railway.app`) |
| `SCRAPER_SECRET` | 위와 동일한 값 |

### 5. 동작 확인

```bash
curl https://YOUR_RAILWAY_URL/
# → { "ok": true, "service": "puppeteer-scraper" }

curl -X POST https://YOUR_RAILWAY_URL/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SECRET" \
  -d '{"url":"https://dinnerqueen.net"}'
# → { "ok": true, "html": "<!DOCTYPE html>..." }
```

---

## 작동 방식

```
Vercel (scrape-campaigns.js)
  ↓  RAILWAY_SCRAPER_URL 있을 때
  →  POST /scrape { url }
       Railway Puppeteer 서버
         → headless Chrome으로 JS 완전 렌더링
         → 렌더된 HTML 반환
  ←  { ok: true, html: "..." }
  ↓  기존 parseHtml() 로직으로 캠페인 파싱
```

`RAILWAY_SCRAPER_URL` 미설정 시 → 기존 fetch 방식으로 자동 fallback (벽돌 없음)

---

## 비용

Railway Hobby 플랜 기준:
- 월 $5 크레딧 무료 제공
- 체험단 스크래핑은 하루 몇 번 호출이므로 무료 범위 내 운영 가능
