// CORVIAN uçtan uca test robotu.
// Ortam değişkenleri: E2E_BASE_URL (ör. Vercel önizleme adresi), E2E_EMAIL, E2E_PASSWORD
// (yalnız test için açılmış ayrı bir hesap). Senaryo her çalıştırmada benzersiz
// bir etiketle (E2E-<zaman>) kendi kayıtlarını oluşturur ve bunları doğrular.
import { appendFile, readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = (process.env.E2E_BASE_URL || "https://procurement-dun.vercel.app").replace(/\/$/, "");
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
if (!email || !password) {
  console.log("E2E_EMAIL / E2E_PASSWORD tanımlı değil; uçtan uca test atlandı.");
  process.exit(0);
}

// Saniye + rastgele ek: aynı dakikada başlayan iki çalışma aynı kartları paylaşmasın.
const tag = `E2E-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "tr-TR" });
if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
  await context.setExtraHTTPHeaders({ "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
}
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("dialog", (dialog) => dialog.accept());

try {
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
    [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Turu atla"))?.click();
  });

  const source = await readFile(new URL("./scenario-browser.js", import.meta.url), "utf8");
  await page.evaluate(source);
  page.on("console", (message) => {
    const line = message.text();
    if (line.startsWith("✓") || line.startsWith("✗")) console.log(line);
  });
  const report = await page.evaluate(
    (runTag) => window.CorvianE2E.run({ tag: runTag, log: (line) => console.log(line) }),
    tag,
  );

  const passed = report.checks.length - report.failed.length;
  console.log(`\n${passed}/${report.checks.length} kontrol geçti (${tag}).`);
  // GitHub'da çalışırken sonuç özet sayfasına ve uyarı satırlarına da yazılır.
  if (process.env.GITHUB_ACTIONS) {
    for (const check of report.checks) {
      const line = `${check.name}${check.detail ? ` — ${check.detail}` : ""}`.replace(/\r?\n/g, " ");
      console.log(`${check.ok ? "::notice title=Geçti::" : "::error title=Başarısız::"}${line}`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      const rows = report.checks.map((check) => `| ${check.ok ? "✅" : "❌"} | ${check.name} | ${String(check.detail || "").replace(/\|/g, "/")} |`);
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Uçtan uca senaryo (${tag})\n\n${passed}/${report.checks.length} kontrol geçti.\n\n| | Kontrol | Ayrıntı |\n|---|---|---|\n${rows.join("\n")}\n`);
    }
  }
  if (pageErrors.length) console.log(`Sayfa hataları:\n- ${pageErrors.slice(0, 10).join("\n- ")}`);
  if (report.failed.length) {
    for (const failure of report.failed) console.log(`BAŞARISIZ: ${failure.name} — ${failure.detail}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Senaryo yarıda kaldı:", error);
  const partial = await page.evaluate(() => window.CorvianE2E?.lastChecks || []).catch(() => []);
  for (const check of partial) {
    const line = `${check.name}${check.detail ? ` — ${check.detail}` : ""}`.replace(/\r?\n/g, " ");
    console.log(process.env.GITHUB_ACTIONS ? `${check.ok ? "::notice title=Geçti::" : "::error title=Başarısız::"}${line}` : `${check.ok ? "✓" : "✗"} ${line}`);
  }
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=Senaryo yarıda kaldı::${String(error?.message || error).replace(/\r?\n/g, " ")}`);
  await page.screenshot({ path: "e2e-hata.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
