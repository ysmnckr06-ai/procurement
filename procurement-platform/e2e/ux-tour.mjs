// Kullanıcı gözüyle tur: hiçbir şey kaydetmeden ekran görüntüleri alır.
// 1) Giriş yapmamış ziyaretçi: ana sayfa, kayıt, giriş (masaüstü + telefon)
// 2) Tanıtım turu adım adım (masaüstü)
// 3) Bütün panel sayfaları masaüstü + telefon, "yeni" düğmelerinin açtığı pencereler
// Görüntüler ux/ klasörüne yazılır. Ortam: E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD.
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, devices } from "playwright";

const baseUrl = (process.env.E2E_BASE_URL || "https://procurement-dun.vercel.app").replace(/\/$/, "");
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const OUT = "ux";
await mkdir(`${OUT}/ziyaretci`, { recursive: true });
await mkdir(`${OUT}/tur`, { recursive: true });
await mkdir(`${OUT}/masaustu`, { recursive: true });
await mkdir(`${OUT}/telefon`, { recursive: true });
const notes = [];
const note = (s) => { notes.push(s); console.log(s); };

const ROUTES = [
  ["01-panel", "/dashboard"],
  ["02-projeler", "/dashboard/projeler"],
  ["03-stok", "/dashboard/stok"],
  ["04-talepler", "/dashboard/talepler"],
  ["05-icmal", "/dashboard/talepler/icmal"],
  ["06-teklifler", "/dashboard/teklifler"],
  ["07-siparisler", "/dashboard/siparisler"],
  ["08-raporlar", "/dashboard/raporlar"],
  ["09-finans", "/dashboard/finans"],
  ["10-tedarikciler", "/dashboard/tedarikciler"],
  ["11-ai-asistan", "/dashboard/ai-asistan"],
  ["12-ayarlar", "/dashboard/ayarlar"],
  ["13-yardim", "/dashboard/yardim"],
  ["14-abonelik", "/abonelik"],
];

async function shot(page, path, full = true) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path, fullPage: full, type: "jpeg", quality: 60 }).catch((e) => note(`! görüntü alınamadı ${path}: ${e.message.split("\n")[0]}`));
}

async function go(page, path) {
  const t = Date.now();
  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  return Date.now() - t;
}

async function login(context, keepTour) {
  const page = await context.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(`${baseUrl}/login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate((keep) => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith("corvian_tour")) continue;
        if (keep) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify({ step: 0, done: true }));
      }
    } catch {}
  }, keepTour);
  return page;
}

const browser = await chromium.launch();
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const baseNewContext = browser.newContext.bind(browser);
browser.newContext = (opts = {}) => baseNewContext({ ...opts, ...(bypass ? { extraHTTPHeaders: { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" } } : {}) });
try {
  // 1) Ziyaretçi
  for (const [label, ctxOpts] of [["masaustu", { viewport: { width: 1440, height: 900 } }], ["telefon", devices["iPhone 13"]]]) {
    const ctx = await browser.newContext({ ...ctxOpts, locale: "tr-TR" });
    const page = await ctx.newPage();
    for (const [name, path] of [["01-ana-sayfa", "/"], ["02-kayit", "/register"], ["03-giris", "/login"]]) {
      if (label === "telefon") { await go(page, path); await shot(page, `${OUT}/ziyaretci/${label}-${name}-ilk-ekran.jpg`, false); }
      const ms = await go(page, path);
      note(`ziyaretci ${label} ${path} ${ms} ms`);
      await shot(page, `${OUT}/ziyaretci/${label}-${name}.jpg`);
    }
    await ctx.close();
  }

  if (process.env.UX_VISITOR_ONLY) throw new Error("yalnız giriş öncesi sayfalar istendi");
  if (!email || !password) throw new Error("E2E_EMAIL / E2E_PASSWORD yok");

  // 2) Tanıtım turu
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "tr-TR" });
    const page = await login(ctx, true);
    await go(page, "/dashboard");
    await page.waitForTimeout(2500);
    for (let i = 0; i < 11; i++) {
      await shot(page, `${OUT}/tur/${String(i).padStart(2, "0")}.jpg`, false);
      const next = page.locator("button", { hasText: /^(Turu başlat|İleri)$/ }).first();
      if (!(await next.count())) { note(`tur ${i}. adımda bitti/ileri düğmesi yok (${page.url()})`); break; }
      await next.click().catch(() => {});
      await page.waitForTimeout(2500);
    }
    // turu bitmiş olarak bırak
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("corvian_tour")) localStorage.setItem(k, JSON.stringify({ step: 0, done: true })); });
    await ctx.close();
  }

  // 3) Sayfalar
  for (const [label, ctxOpts] of [["masaustu", { viewport: { width: 1440, height: 900 } }], ["telefon", devices["iPhone 13"]]]) {
    const ctx = await browser.newContext({ ...ctxOpts, locale: "tr-TR" });
    const page = await login(ctx, false);
    for (const [name, path] of ROUTES) {
      const ms = await go(page, path);
      await page.waitForTimeout(1500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => 0);
      note(`${label} ${path} ${ms} ms${overflow > 2 ? ` · YATAY TAŞMA ${overflow}px` : ""}`);
      await shot(page, `${OUT}/${label}/${name}.jpg`);
    }
    // ilk proje detay sayfası
    const projectHref = await (async () => { await go(page, "/dashboard/projeler"); return page.locator('a[href^="/dashboard/projeler/"]').first().getAttribute("href").catch(() => null); })();
    if (projectHref) { await go(page, projectHref); await shot(page, `${OUT}/${label}/15-proje-detay.jpg`); }
    if (label === "masaustu") {
      // "yeni" düğmeleri: yalnız açılan pencere görüntülenir, hiçbir şey kaydedilmez
      for (const [name, path, rx] of [
        ["20-yeni-proje", "/dashboard/projeler", /Yeni Proje|Proje Oluştur|Proje Ekle|\+ Proje/i],
        ["21-yeni-talep", "/dashboard/talepler", /Yeni Talep Listesi/i],
        ["22-yeni-tedarikci", "/dashboard/tedarikciler", /Yeni (İş Ortağı|Tedarikçi)|Tedarikçi Ekle|İş Ortağı Ekle/i],
        ["23-urun-ekle", "/dashboard/stok", /Ürün Ekle|Yeni Ürün|Yeni Kart/i],
      ]) {
        await go(page, path);
        const btn = page.locator("button, a", { hasText: rx }).first();
        if (await btn.count()) {
          await btn.click().catch(() => {});
          await page.waitForTimeout(2000);
          await shot(page, `${OUT}/masaustu/${name}.jpg`, false);
          note(`düğme ${name}: açıldı (${page.url().replace(baseUrl, "")})`);
        } else note(`düğme ${name}: bulunamadı`);
      }
    }
    await ctx.close();
  }
} catch (e) {
  note(`HATA: ${e.message}`);
} finally {
  await browser.close();
  await writeFile(`${OUT}/notlar.txt`, notes.join("\n") + "\n");
}
