// CORVIAN ekran taraması: her sayfayı masaüstü ve telefon genişliğinde açar,
// sayfa hatası / yatay taşma / hata ekranı arar; PDF ve Excel çıktılarını indirir;
// yanlış ve çok büyük dosya yüklemesine programın verdiği tepkiyi kontrol eder.
// Ortam değişkenleri run.mjs ile aynıdır (E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD).
import { appendFile } from "node:fs/promises";
import { chromium, devices } from "playwright";

const baseUrl = (process.env.E2E_BASE_URL || "https://procurement-dun.vercel.app").replace(/\/$/, "");
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
if (!email || !password) {
  console.log("E2E_EMAIL / E2E_PASSWORD tanımlı değil; ekran taraması atlandı.");
  process.exit(0);
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const STATIC_ROUTES = [
  "/dashboard",
  "/dashboard/projeler",
  "/dashboard/stok",
  "/dashboard/talepler",
  "/dashboard/talepler/icmal",
  "/dashboard/teklifler",
  "/dashboard/siparisler",
  "/dashboard/raporlar",
  "/dashboard/finans",
  "/dashboard/tedarikciler",
  "/dashboard/ai-asistan",
  "/dashboard/ayarlar",
  "/dashboard/yardim",
  "/abonelik",
];

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.__supabase && window.next?.router), null, { timeout: 60000 });
  await page.evaluate(() => {
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith("corvian_tour")) localStorage.setItem(key, JSON.stringify({ step: 0, done: true }));
    } catch {}
  });
  return page;
}

// Dinamik sayfalar için test hesabındaki gerçek kayıtlar (robot projeleri hariç tutulmaz;
// yalnız açılıp okunur, hiçbir şey değiştirilmez).
async function sampleIds(page) {
  return page.evaluate(async () => {
    const S = window.__supabase;
    const first = async (table, filter) => {
      let query = S.from(table).select("id").order("created_at", { ascending: false }).limit(1);
      if (filter) query = filter(query);
      return (await query).data?.[0]?.id || null;
    };
    return {
      project: await first("projects", (q) => q.not("status", "ilike", "iptal%")),
      order: await first("orders"),
      report: await first("reports"),
      supplier: await first("suppliers"),
    };
  });
}

async function visit(page, path, label) {
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on("pageerror", onError);
  const started = Date.now();
  let status = 0;
  try {
    const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    status = response?.status() || 0;
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
  } catch (error) {
    errors.push(error.message);
  }
  const elapsed = Date.now() - started;
  const state = await page.evaluate(() => {
    const body = document.body?.innerText || "";
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      crashed: /Application error|Unhandled Runtime Error|Bir hata oluştu|Something went wrong/i.test(body),
      empty: body.trim().length < 40,
      redirected: location.pathname,
    };
  }).catch(() => ({ overflow: 0, crashed: true, empty: true, redirected: "" }));
  page.off("pageerror", onError);
  const ok = status < 400 && errors.length === 0 && !state.crashed && !state.empty;
  check(`${label} ${path} açıldı`, ok, ok ? `${elapsed} ms` : `durum ${status} · ${errors.slice(0, 2).join(" / ") || (state.crashed ? "hata ekranı" : "boş sayfa")}`);
  return { elapsed, overflow: state.overflow };
}

async function captureDownload(page, buttonPattern, label) {
  const button = page.locator("button", { hasText: buttonPattern }).first();
  if ((await button.count()) === 0) {
    check(`${label} düğmesi var`, false, String(buttonPattern));
    return;
  }
  try {
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 45000 }), button.click()]);
    const path = await download.path();
    const { size } = await import("node:fs/promises").then((fs) => fs.stat(path));
    check(`${label} indirildi`, size > 1000, `${download.suggestedFilename()} · ${Math.round(size / 1024)} KB`);
  } catch (error) {
    check(`${label} indirildi`, false, error.message.split("\n")[0]);
  }
}

const browser = await chromium.launch();
try {
  // 1) Masaüstü: tüm sayfalar + çıktılar + yanlış dosya
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "tr-TR", acceptDownloads: true });
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) await desktop.setExtraHTTPHeaders({ "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
  const page = await login(desktop);
  page.on("dialog", (dialog) => dialog.accept());
  const ids = await sampleIds(page);
  const dynamicRoutes = [
    ids.project && `/dashboard/projeler/${ids.project}`,
    ids.order && `/dashboard/siparisler/${ids.order}`,
    ids.report && `/dashboard/raporlar/${ids.report}/mukayese`,
    ids.supplier && `/dashboard/tedarikciler/${ids.supplier}`,
  ].filter(Boolean);
  const routes = [...STATIC_ROUTES, ...dynamicRoutes];
  const slow = [];
  for (const route of routes) {
    const { elapsed } = await visit(page, route, "Masaüstü");
    if (elapsed > 8000) slow.push(`${route} ${elapsed} ms`);
  }
  check("Masaüstünde hiçbir sayfa 8 saniyeden uzun sürmedi", slow.length === 0, slow.join(", "));

  // Çıktılar
  if (ids.order) {
    await page.goto(`${baseUrl}/dashboard/siparisler/${ids.order}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
    await captureDownload(page, /^Sipariş PDF$/, "Sipariş PDF'i");
    await captureDownload(page, /Excel/, "Sipariş Excel'i");
  }
  if (ids.report) {
    await page.goto(`${baseUrl}/dashboard/raporlar/${ids.report}/mukayese`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(3000);
    await captureDownload(page, /PDF/, "Mukayese PDF'i");
  }

  // Yanlış dosya: Excel uzantılı ama içi bozuk dosya stok yüklemesine verilir.
  await page.goto(`${baseUrl}/dashboard/stok`);
  await page.waitForSelector("input[data-import-type=component]", { timeout: 40000, state: "attached" });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setInputFiles("input[data-import-type=component]", {
    name: "bozuk-dosya.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("Bu bir Excel dosyası değil, bozuk içerik."),
  });
  const reaction = await page.waitForFunction(() => {
    const text = [...document.querySelectorAll("[role=status],[role=alert]")].map((el) => el.innerText).join(" | ");
    return text.length > 0 ? text : null;
  }, null, { timeout: 30000 }).then((handle) => handle.jsonValue()).catch(() => "");
  check("Bozuk Excel yüklenince anlaşılır uyarı çıkıyor, sayfa çökmüyor",
    reaction && !/işlendi/.test(reaction) && pageErrors.length === 0,
    String(reaction || "uyarı görünmedi").slice(0, 140) + (pageErrors.length ? ` · sayfa hatası: ${pageErrors[0]}` : ""));

  // Çok büyük dosya (26 MB > 25 MB sınırı) projeye belge olarak eklenmeye çalışılır.
  if (ids.project) {
    await page.goto(`${baseUrl}/dashboard/projeler/${ids.project}`);
    await page.getByRole("button", { name: "Belgeler", exact: true }).click({ timeout: 40000 });
    const uploader = page.locator("label", { hasText: "Belge Seç" }).locator("input[type=file]");
    await uploader.waitFor({ state: "attached", timeout: 20000 });
    await uploader.setInputFiles({ name: "cok-buyuk.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(26 * 1024 * 1024, 32) });
    const bigReaction = await page.waitForFunction(() => {
      const text = [...document.querySelectorAll("[role=status],[role=alert]")].map((el) => el.innerText).join(" | ");
      return /belge projeye eklendi|Eklenemeyen|büyük/i.test(text) ? text : null;
    }, null, { timeout: 90000 }).then((handle) => handle.jsonValue()).catch(() => "");
    check("25 MB'tan büyük belge reddediliyor ve kullanıcı bilgilendiriliyor",
      /Eklenemeyen|büyük/i.test(bigReaction || "") && !/^1 belge/.test(bigReaction || ""),
      String(bigReaction || "mesaj görünmedi").slice(0, 160));
  }
  await desktop.close();

  // 2) Telefon görünümü: yatay taşma
  const mobile = await browser.newContext({ ...devices["iPhone 13"], locale: "tr-TR" });
  const mobilePage = await login(mobile);
  const overflowing = [];
  for (const route of routes) {
    const { overflow } = await visit(mobilePage, route, "Telefon");
    if (overflow > 4) overflowing.push(`${route} (+${overflow}px)`);
  }
  check("Telefonda sayfalar yana taşmıyor", overflowing.length === 0, overflowing.join(", "));
  await mobile.close();
} catch (error) {
  check("Ekran taraması tamamlandı", false, error.message.split("\n")[0]);
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
const passed = checks.length - failed.length;
console.log(`\n${passed}/${checks.length} ekran kontrolü geçti.`);
if (process.env.GITHUB_ACTIONS) {
  console.log(`::notice title=Ekran taraması::${passed}/${checks.length} kontrol geçti.`);
  for (const c of failed.slice(0, 9)) console.log(`::error title=Ekran::${`${c.name} — ${c.detail}`.replace(/\r?\n/g, " ")}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = checks.map((c) => `| ${c.ok ? "✅" : "❌"} | ${c.name} | ${String(c.detail).replace(/\|/g, "/")} |`);
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Ekran taraması\n\n${passed}/${checks.length} geçti.\n\n| | Kontrol | Ayrıntı |\n|---|---|---|\n${rows.join("\n")}\n`);
  }
}
if (failed.length) process.exitCode = 1;
