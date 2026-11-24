# RoboSim

محاكي روبوتات يعمل في المتصفح (مستهدف: Chromebook).

## التشغيل
```bash
corepack enable
pnpm install
pnpm dev        # http://localhost:5173
pnpm check      # typecheck + lint + test
pnpm build
```
افتح الصفحة وتأكد أن بند `crossOriginIsolated` يظهر ✔.

## الهيكل
انظر `docs/ARCHITECTURE.md`. المراحل: `docs/ROADMAP.md`.

## النشر
مخصص لـ **Cloudflare**. انظر `docs/CLOUDFLARE.md`.
```bash
pnpm deploy
```
