# النشر على Cloudflare

الإعداد يستخدم **Workers Static Assets** (الطريقة الحالية الموصى بها من Cloudflare).
ملف `apps/web/public/_headers` يضبط COOP/COEP تلقائياً دون أي كود Worker.

## الطريقة 1: الربط مع GitHub (الأسهل، بلا طرفية)
1. ارفع المشروع إلى مستودع GitHub.
2. Cloudflare Dashboard ← Workers & Pages ← Create ← Import a repository.
3. إعدادات البناء:
   - **Root directory:** `/`
   - **Build command:** `pnpm install --frozen-lockfile && pnpm build`
   - **Deploy command:** `cd apps/web && npx wrangler deploy`
   - متغير بيئة: `NODE_VERSION = 20`
4. بعد كل `git push` يُنشر الموقع تلقائياً على `https://robosim.<حسابك>.workers.dev`.

## الطريقة 2: من الطرفية
```bash
pnpm install
pnpm cf:preview   # معاينة محلية بنفس ترويسات الإنتاج
pnpm deploy       # يطلب تسجيل الدخول لحسابك أول مرة
```

## التحقق
افتح الرابط وتأكد أن `crossOriginIsolated` يظهر ✔.
إن ظهر ✘: افتح DevTools ← Network ← أول طلب ← Response Headers، وابحث عن
`Cross-Origin-Opener-Policy` و`Cross-Origin-Embedder-Policy`.

## ملاحظات
- COEP `require-corp` يمنع تحميل صور/سكربتات من نطاقات خارجية ما لم ترسل ترويسة CORP.
  استضف كل الأصول (نماذج، خطوط، wasm) على نفس النطاق.
- إن أردت Cloudflare Pages بدلاً من Workers فالملفات تعمل كما هي
  (مجلد الإخراج `apps/web/dist`، وأمر البناء نفسه).
- لاحقاً (المرحلة 9: تعاون ومنافسات) يمكن إضافة Worker وDurable Objects إلى نفس المشروع.
