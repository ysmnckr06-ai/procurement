// CORVIAN uçtan uca test robotu.
// Ortam değişkenleri: E2E_BASE_URL (ör. Vercel önizleme adresi), E2E_EMAIL, E2E_PASSWORD
// (yalnız test için açılmış ayrı bir hesap). Senaryo her çalıştırmada benzersiz
// bir etiketle (E2E-<zaman>) kendi kayıtlarını oluşturur ve bunları doğrular.
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = (process.env.E2E_BASE_URL || "https://procurement-dun.vercel.app").replace(/\/$/, "");
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
if (!email || !password) {
  console.log("E2E_EMAIL / E2E_PASSWORD tanımlı değil; uçtan uca test atlandı.");
  process.exit(0);
}

const tag = `E2E-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
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

  console.log(`\n${report.checks.length - report.failed.length}/${report.checks.length} kontrol geçti (${tag}).`);
  if (pageErrors.length) console.log(`Sayfa hataları:\n- ${pageErrors.slice(0, 10).join("\n- ")}`);
  if (report.failed.length) {
    for (const failure of report.failed) console.log(`BAŞARISIZ: ${failure.name} — ${failure.detail}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Senaryo yarıda kaldı:", error);
  await page.screenshot({ path: "e2e-hata.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
