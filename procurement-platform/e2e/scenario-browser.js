// CORVIAN uçtan uca senaryosu — tarayıcı tarafı.
// Giriş yapılmış bir CORVIAN sekmesinde çalışır (Playwright robotu veya elle).
// Gereken: window.__supabase (uygulama sağlar), window.next.router, window.XLSX.
// Kullanım: eval(kaynak); const rapor = await window.CorvianE2E.run({ tag: "E2E-..." });
// Her adım bir "kontrol" üretir; rapor.failed boşsa senaryo geçti.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const S = () => window.__supabase;
  const main = () => document.querySelector("main") || document.body;
  const text = (el) => (el?.innerText || el?.textContent || "").trim();

  async function waitFor(fn, { timeout = 30000, step = 400 } = {}) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeout) {
      const v = await fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }
  const findButton = (label, { exact = false, root = main() } = {}) =>
    [...root.querySelectorAll("button")].find((b) => (exact ? text(b) === label : text(b).startsWith(label)) && !b.disabled);
  async function click(label, opts = {}) {
    const b = await waitFor(() => findButton(label, opts), { timeout: opts.timeout || 20000 });
    if (!b) throw new Error(`Düğme bulunamadı: ${label}`);
    b.click();
    await sleep(opts.after ?? 600);
  }
  function setValue(el, value) {
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value));
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    if (el.tagName !== "SELECT") el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const field = (labelStart, root = document) =>
    [...root.querySelectorAll("label")].find((x) => text(x).startsWith(labelStart))?.querySelector("input,select,textarea") || null;
  const statusText = () => [...document.querySelectorAll("[role=status],[role=alert]")].map(text).join(" | ");
  function attachFiles(input, files) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function xlsxFile(name, sheetName, rows) {
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return new File([window.XLSX.write(wb, { type: "array", bookType: "xlsx" })], name, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }
  async function go(path, ready) {
    window.next.router.push(path);
    const ok = await waitFor(() => location.pathname === path && (!ready || ready()), { timeout: 40000 });
    if (!ok) throw new Error(`Sayfa açılamadı: ${path}`);
    await sleep(1500);
  }
  async function loadXlsx() {
    if (window.XLSX) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Deterministik sözde rastgele sayı
  function rng(seed) {
    let x = seed % 2147483647 || 1;
    return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
  }

  async function run({ tag, log = () => {} }) {
    const checks = [];
    // Senaryo yarıda kalırsa o ana kadarki kontroller de raporlansın.
    window.CorvianE2E.lastChecks = checks;
    const check = (name, ok, detail = "") => {
      checks.push({ name, ok: Boolean(ok), detail: String(detail) });
      log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
    };
    await loadXlsx();
    const r = rng(42);
    const code = (n) => `${tag}-${String(n).padStart(3, "0")}`;

    // 1) Stok: 30 kart; 5'i stoksuz (0), 1'i EUR fiyatlı.
    const stockRows = [["Sıra No", "Malzeme Kodu", "Malzeme Markası", "Malzeme Açıklaması", "Stok", "Birim", "Birim Fiyat", "Para Birimi", "Kritik Stok"]];
    const expectedStock = {};
    for (let i = 1; i <= 30; i += 1) {
      const qty = i <= 5 ? 0 : 5 + Math.floor(r() * 60);
      const currency = i === 6 ? "EUR" : "TRY";
      const price = Math.round((20 + r() * 400) * 100) / 100;
      expectedStock[code(i)] = { qty, currency, price };
      stockRows.push([i, code(i), "TestMarka", `${tag} Malzeme ${i}`, qty, "adet", price, currency, 5]);
    }
    await go("/dashboard/stok", () => document.querySelector("input[data-import-type=component]"));
    window.confirm = () => true;
    attachFiles(document.querySelector("input[data-import-type=component]"), [xlsxFile(`${tag}-stok.xlsx`, "Stok Girişi", stockRows)]);
    const importDone = await waitFor(() => /satır .*işlendi|Dikkat:|HIGH RISK/.test(statusText()) && !/uygulanıyor/.test(statusText()), { timeout: 180000, step: 1000 });
    check("Stok dosyası yüklendi", importDone, statusText().slice(0, 160));
    const { data: products } = await S().from("products").select("id,product_code,current_stock,last_unit_price,last_currency").like("product_code", `${tag}-%`);
    const byCode = Object.fromEntries((products || []).map((p) => [p.product_code, p]));
    check("30 kartın tamamı açıldı (stoğu 0 olanlar dahil)", (products || []).length === 30, `${(products || []).length}/30`);
    const stockMismatch = Object.entries(expectedStock).filter(([c, e]) => !byCode[c] || Number(byCode[c].current_stock) !== e.qty || byCode[c].last_currency !== e.currency);
    check("Stok miktarları ve para birimleri dosyayla aynı", stockMismatch.length === 0, stockMismatch.map(([c]) => c).join(", "));

    // 2) Stok kartı formunda yazma gecikmesi
    await click("+ Stok Kartı Aç", { exact: true, after: 800 });
    const nameInput = field("Ürün adı");
    if (nameInput) {
      const times = [];
      let value = "";
      for (const ch of "Gecikme") {
        value += ch;
        const t0 = performance.now();
        setValue(nameInput, value);
        await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
        times.push(performance.now() - t0);
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      check("Stok formunda tuş gecikmesi < 300 ms", avg < 300, `${Math.round(avg)} ms`);
      setValue(nameInput, "");
    } else {
      check("Stok kartı formu açıldı", false);
    }

    // 3) İki proje: A (TRY, malzeme listesi), B (iptal edilecek)
    const bomRow = (i) => {
      const e = expectedStock[code(i)];
      return [code(i), "TestMarka", `${tag} Malzeme ${i}`, e.qty > 0 ? e.qty + 4 : 3, "adet", e.price, e.currency];
    };
    const bom = (from, to, extra = []) => [
      ["Ürün Kodu", "Marka", "Ürün Açıklaması", "Miktar", "Birim", "Birim Fiyat", "Para Birimi"],
      ...Array.from({ length: to - from + 1 }, (_, k) => bomRow(from + k)),
      ...extra,
    ];
    async function createProject(name, rows) {
      await go("/dashboard/projeler", () => findButton("Yeni Proje", { exact: true }));
      await click("Yeni Proje", { exact: true, after: 800 });
      setValue(field("Proje Adı"), name);
      setValue(field("Müşteri Adı"), `${tag} Müşteri A.Ş.`);
      setValue(field("Sözleşme Bedeli"), 250000);
      setValue(field("Tahmini Bütçe"), 180000);
      setValue(field("Proje Sorumlusu"), "E2E Robot");
      setValue(field("Başlangıç Tarihi"), "2026-09-15");
      setValue(field("Planlanan Bitiş"), "2026-12-31");
      setValue(field("Durum"), "Devam Ediyor");
      attachFiles(document.querySelector("form input[type=file]"), [xlsxFile(`${name}.xlsx`, "Malzeme", rows)]);
      await sleep(500);
      document.querySelector("form button[type=submit]").click();
      const opened = await waitFor(() => /\/dashboard\/projeler\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 120000, step: 1000 });
      if (!opened) throw new Error(`Proje oluşturulamadı: ${name}`);
      return location.pathname.split("/").pop();
    }
    const projectA = await createProject(`${tag} Proje A`, bom(1, 12));
    const sharedCode = code(7);
    const projectB = await createProject(`${tag} Proje B`, bom(13, 18, [bomRow(7)]));
    const itemsOf = async (id) => (await S().from("project_items").select("*").eq("project_id", id)).data || [];
    const itemsA = await itemsOf(projectA);
    check("Proje A malzeme listesi 12 kalem", itemsA.length === 12, itemsA.length);
    const eurItem = itemsA.find((i) => i.product_code === code(6));
    check("EUR fiyatlı kalem EUR olarak aktarıldı", eurItem?.currency === "EUR", eurItem?.currency);

    // 4) Stoktan ayırma (A ve B)
    async function reserve(projectId) {
      await go(`/dashboard/projeler/${projectId}`, () => findButton("İhtiyaç Analizi", { exact: true }));
      await click("İhtiyaç Analizi", { exact: true, after: 1500 });
      const boxes = [...main().querySelectorAll("label")].filter((e) => text(e) === "Tümünü Seç");
      if (boxes.length < 2) return "";
      const input = boxes[1].querySelector("input");
      if (!input.checked) input.click();
      await sleep(400);
      window.confirm = () => true;
      await click("Seçilenleri Stoktan Karşıla");
      await waitFor(() => /stoktan ayrıldı|ayrılamadı|hata/i.test(statusText()), { timeout: 40000 });
      return statusText();
    }
    check("Proje A stoktan ayrıldı", /stoktan ayrıldı/.test(await reserve(projectA)));
    check("Proje B stoktan ayrıldı", /stoktan ayrıldı/.test(await reserve(projectB)));
    async function invariant() {
      const { data: prods } = await S().from("products").select("id,product_code,current_stock,reserved_stock").like("product_code", `${tag}-%`);
      const items = [...(await itemsOf(projectA)), ...(await itemsOf(projectB))];
      return (prods || []).filter((p) => {
        const sum = items.filter((i) => i.product_id === p.id).reduce((s, i) => s + Number(i.reserved_quantity || 0), 0);
        return Math.abs(sum - Number(p.reserved_stock)) > 1e-6 || Number(p.reserved_stock) > Number(p.current_stock);
      }).map((p) => p.product_code);
    }
    const bad1 = await invariant();
    check("Kart rezervi = projelerdeki rezerve toplamı", bad1.length === 0, bad1.join(", "));

    // 4b) Projeler arası ödünç: A depodaki malzemeyi B'ye verir, B geri verir.
    const sharedItem = async (projectId) => (await itemsOf(projectId)).find((i) => i.product_code === sharedCode);
    const beforeA = await sharedItem(projectA);
    const beforeB = await sharedItem(projectB);
    const lendQty = Math.min(2, Number(beforeA?.reserved_quantity || 0));
    if (lendQty > 0 && beforeB) {
      await go(`/dashboard/projeler/${projectA}`, () => findButton("İhtiyaç Analizi", { exact: true }));
      await click("İhtiyaç Analizi", { exact: true, after: 2500 });
      const moveRow = await waitFor(() => [...main().querySelectorAll("div")].find((d) =>
        d.querySelector(":scope > div > div.truncate")?.innerText === `${tag} Malzeme 7` && findButton("Başka projeye ver", { root: d })), { timeout: 20000 });
      if (moveRow) {
        findButton("Başka projeye ver", { root: moveRow }).click();
        await sleep(600);
        const panel = [...main().querySelectorAll("div")].reverse().find((d) => /^Başka projeye ver:/.test(text(d).split("\n")[0] || "") && d.querySelector("input[type=number]"));
        setValue(panel.querySelector("input[type=number]"), lendQty);
        await sleep(300);
        [...panel.querySelectorAll("button")].find((b) => text(b) === "Onayla").click();
        await waitFor(() => /ödünç kaydı açıldı|yapılamadı/.test(statusText()), { timeout: 30000 });
        const lentA = await sharedItem(projectA);
        const lentB = await sharedItem(projectB);
        check("Ödünç: veren projenin rezervi azaldı, alanınki arttı",
          Number(beforeA.reserved_quantity) - Number(lentA.reserved_quantity) === lendQty
            && Number(lentB.reserved_quantity) - Number(beforeB.reserved_quantity || 0) === lendQty,
          `A ${beforeA.reserved_quantity}→${lentA.reserved_quantity}, B ${beforeB.reserved_quantity || 0}→${lentB.reserved_quantity}`);
        const badLend = await invariant();
        check("Ödünç sonrası kart rezervi tutarlı", badLend.length === 0, badLend.join(", "));

        await go(`/dashboard/projeler/${projectB}`, () => findButton("İhtiyaç Analizi", { exact: true }));
        await click("İhtiyaç Analizi", { exact: true, after: 2500 });
        await click("Geri ver", { exact: true, after: 600 });
        const backPanel = [...main().querySelectorAll("div")].reverse().find((d) => /^Ödüncü geri ver/.test(text(d)) && d.querySelector("input[type=number]"));
        [...backPanel.querySelectorAll("button")].find((b) => text(b) === "Onayla").click();
        await waitFor(() => /geri verildi|yapılamadı/.test(statusText()), { timeout: 30000 });
        const backA = await sharedItem(projectA);
        const backB = await sharedItem(projectB);
        const { data: transfers } = await S().from("project_item_transfers").select("status").eq("from_item_id", beforeA.id);
        check("Ödünç geri verildi, miktarlar ilk hâline döndü",
          Number(backA.reserved_quantity) === Number(beforeA.reserved_quantity)
            && Number(backB.reserved_quantity || 0) === Number(beforeB.reserved_quantity || 0)
            && (transfers || []).length > 0 && transfers.every((t) => t.status !== "açık"),
          `A ${backA.reserved_quantity}, B ${backB.reserved_quantity || 0}, kayıt ${(transfers || []).map((t) => t.status).join(",")}`);
      } else {
        check("Ödünç: 'Başka projeye ver' satırı görünüyor", false, sharedCode);
      }
    } else {
      check("Ödünç senaryosu kuruldu (ortak kalem rezerve)", false, `A rezerv ${beforeA?.reserved_quantity}, B kalem ${Boolean(beforeB)}`);
    }

    // 4c) Projeye belge (çizim) ekleme
    await go(`/dashboard/projeler/${projectA}`, () => findButton("Belgeler", { exact: true }));
    await click("Belgeler", { exact: true, after: 2000 });
    const uploadLabel = await waitFor(() => [...main().querySelectorAll("label")].find((l) => text(l).startsWith("Belge Seç")));
    if (uploadLabel) {
      const typeSelect = [...main().querySelectorAll("select")].find((x) => x.getAttribute("aria-label") === "Belge türü");
      setValue(typeSelect, "cizim");
      await sleep(300);
      const drawing = new File([`${tag} çizim ${Date.now()}`], `${tag}-cizim.txt`, { type: "text/plain" });
      attachFiles(uploadLabel.querySelector("input[type=file]"), [drawing]);
      await waitFor(() => /belge projeye eklendi/.test(statusText()), { timeout: 30000 });
      const { data: drawingDocs } = await S().from("documents").select("id,document_type").eq("original_file_name", drawing.name);
      const drawingLinks = drawingDocs?.length
        ? (await S().from("document_links").select("id").eq("document_id", drawingDocs[0].id).eq("project_id", projectA)).data || []
        : [];
      check("Projeye çizim belgesi eklendi ve bağlandı", drawingDocs?.[0]?.document_type === "cizim" && drawingLinks.length === 1, statusText().slice(0, 120));
    } else {
      check("Proje belge ekleme alanı görünüyor", false);
    }

    // 4d) Geçmiş tarihli kur (belgedeki kur sorusu bu servisi kullanır)
    try {
      const rates = await (await fetch("/api/live-rates?date=2026-10-01", { cache: "no-store" })).json();
      check("1 Ekim 2026 TCMB kuru alınabiliyor", Number(rates?.rates?.EUR) > 1 && String(rates?.date || "").startsWith("2026-"), `EUR ${rates?.rates?.EUR} (${rates?.date})`);
    } catch (rateError) {
      check("1 Ekim 2026 TCMB kuru alınabiliyor", false, rateError.message);
    }

    // 5) Talep (A)
    await go(`/dashboard/projeler/${projectA}`, () => findButton("İhtiyaç Analizi", { exact: true }));
    await click("İhtiyaç Analizi", { exact: true, after: 1500 });
    window.confirm = () => true;
    await click("Tümü İçin Talep Oluştur");
    const dialog = await waitFor(() => [...document.querySelectorAll("div")].reverse().find((d) => /Talebi açan kişi kim\?/.test(d.innerText) && d.querySelector("input")), { timeout: 10000 });
    const dialogInputs = [...dialog.querySelectorAll("input")];
    setValue(dialogInputs[0], "E2E Robot");
    setValue(dialogInputs[1], "Satınalma");
    [...dialog.querySelectorAll("button")].find((b) => text(b) === "Talebi oluştur").click();
    await waitFor(() => /talep oluşturuldu/i.test(statusText()), { timeout: 30000 });
    const { data: request } = await S().from("requests").select("*").eq("project_id", projectA).single();
    const requestItems = Array.isArray(request.items) ? request.items : JSON.parse(request.items || "[]");
    const itemsAfter = await itemsOf(projectA);
    const wrongQty = requestItems.filter((ri) => {
      const it = itemsAfter.find((x) => x.product_code === ri.urunKodu);
      return !it || Number(ri.talepEdilenAdet) !== Number(it.estimated_quantity) - Number(it.reserved_quantity || 0);
    });
    check("Talep miktarı = ihtiyaç − rezerve", requestItems.length > 0 && wrongQty.length === 0, `${requestItems.length} kalem, hatalı: ${wrongQty.map((x) => x.urunKodu).join(",")}`);

    // 6) Teklifler ve mukayese → sipariş
    const suppliers = [`${tag} Ege Ltd.`, `${tag} Anadolu Ltd.`];
    const offerFiles = suppliers.map((supplier, si) => xlsxFile(`${tag}-teklif-${si}.xlsx`, "Teklif", [
      ["Firma", "Ürün Kodu", "Marka", "Ürün Açıklaması", "Miktar", "Birim", "Birim Fiyat", "Para Birimi", "Termin (gün)", "Vade (gün)"],
      ...requestItems.map((it) => [supplier, it.urunKodu, "", it.urunAciklamasi, Number(it.talepEdilenAdet), "adet", Math.round((50 + r() * 300) * (si ? 1.05 : 1) * 100) / 100, "TRY", si ? 3 : 7, si ? 30 : 60]),
    ]));
    await go("/dashboard/teklifler", () => document.querySelector("input[name=offer-request-pool]"));
    const radio = [...document.querySelectorAll("input[name=offer-request-pool]")].find((i) => text(i.closest("label")).startsWith(request.request_number));
    radio.click();
    await sleep(500);
    attachFiles([...document.querySelectorAll("input[type=file]")].find((i) => i.multiple), offerFiles);
    await sleep(1500);
    await click("Teklifleri Analiz Et");
    const reportOpened = await waitFor(() => /\/raporlar\/.+\/mukayese/.test(location.pathname), { timeout: 150000, step: 1000 });
    check("Mukayese raporu oluştu", reportOpened);
    if (reportOpened) {
      // Teklif belgesi sipariş oluşmasa da projenin belgelerine bağlanır.
      const reportId = location.pathname.split("/")[3];
      const offerLinked = await waitFor(async () => {
        const { data: offerDocs } = await S().from("documents").select("id").eq("document_number", `MUK-${reportId}`);
        if (!offerDocs?.length) return null;
        const { data: links } = await S().from("document_links").select("id").in("document_id", offerDocs.map((d) => d.id)).eq("project_id", projectA);
        return (links || []).length > 0;
      }, { timeout: 20000, step: 2000 });
      check("Teklif belgesi projeye bağlandı", offerLinked, `MUK-${reportId}`);
    }
    await sleep(3000);
    const groups = {};
    document.querySelectorAll("main input[type=radio]").forEach((x) => { (groups[x.name] = groups[x.name] || []).push(x); });
    for (const radios of Object.values(groups)) if (!radios.some((x) => x.checked)) radios[0].click();
    check("Mukayesede her kalem için grup var", Object.keys(groups).length === requestItems.length, `${Object.keys(groups).length}/${requestItems.length}`);
    await sleep(500);
    window.confirm = () => true;
    await click("Seçilenlerden Sipariş Oluştur", { after: 1500 });
    // İş Ortakları'nda kayıtlı olmayan tedarikçi için kısa firma formu açılır;
    // gerçek kullanıcı gibi doldurulup devam edilir.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const saveButton = findButton("Firma Bilgilerini Kaydet ve Devam Et", { root: document });
      if (!saveButton) break;
      const form = saveButton.closest("form");
      const cityInput = field("Şehir", form);
      if (cityInput && !cityInput.value) setValue(cityInput, "İzmir");
      await sleep(300);
      saveButton.click();
      await sleep(3000);
    }
    const created = await waitFor(() => /tedarikçi siparişi oluşturuldu|oluşturulamadı/i.test(main().innerText), { timeout: 60000 });
    check("Siparişler oluşturuldu", created && /siparişi oluşturuldu/.test(main().innerText), (main().innerText.match(/[^\n]*(oluşturuldu|tamamlayın)[^\n]*/) || [""])[0]);
    const { data: orders } = await S().from("orders").select("*").eq("project_id", projectA).order("order_no");
    const ordered = {};
    (orders || []).forEach((o) => o.items.forEach((i) => { ordered[i.productCode] = (ordered[i.productCode] || 0) + Number(i.quantity); }));
    check("Sipariş miktarları talep miktarlarıyla aynı", requestItems.every((ri) => ordered[ri.urunKodu] === Number(ri.talepEdilenAdet)));
    check("Siparişlerde termin tarihi var", (orders || []).length > 0 && orders.every((o) => o.termin_date), (orders || []).map((o) => o.termin_date).join(","));
    const { data: requestAfter } = await S().from("requests").select("durum").eq("id", request.id).single();
    check("Talep 'Siparişe Aktarıldı' oldu", requestAfter?.durum === "Siparişe Aktarıldı", requestAfter?.durum);

    if (!orders?.length) {
      return { tag, checks, failed: checks.filter((c) => !c.ok), projectA, projectB };
    }
    // 7) Teslim alma: aynı kalemde aynı gün iki eşit sevkiyat; projeye rezerve
    const order = orders[0];
    const line = order.items.find((i) => Number(i.quantity) >= 2);
    const half = Math.floor(Number(line.quantity) / 2);
    const lineIndex = order.items.indexOf(line);
    await go(`/dashboard/siparisler/${order.id}`, () => findButton("Teslim Alma", { exact: true }));
    await click("Teslim Alma", { exact: true, after: 1500 });
    const waybillNo = `${tag}-IRS1`;
    const waybillInput = await waitFor(() => main().querySelector("[data-testid=receipt-waybill-number]"));
    if (waybillInput) setValue(waybillInput, waybillNo);
    await sleep(300);
    async function receive(quantity, note) {
      const button = [...main().querySelectorAll("button")].filter((b) => text(b) === "Teslim Al")[lineIndex];
      const card = button.closest("div.rounded-2xl") || button.parentElement.parentElement.parentElement;
      const input = (label) => [...card.querySelectorAll("label")].find((l) => text(l).startsWith(label))?.querySelector("input");
      setValue(input("Gelen"), quantity);
      setValue(input("Teslim alan"), "E2E Depo");
      setValue(input("Açıklama"), note);
      await sleep(300);
      const countReceipts = async () => (await S().from("order_receipts").select("id", { count: "exact", head: true }).eq("order_id", order.id)).count || 0;
      const before = await countReceipts();
      window.confirm = () => true;
      button.click();
      // Ekrandaki mesaj önceki kayıttan kalmış olabilir; kaydın veritabanına düşmesi beklenir.
      await waitFor(async () => (await countReceipts()) > before, { timeout: 30000, step: 1000 });
      await sleep(3000);
    }
    const stockBefore = (await S().from("products").select("current_stock,reserved_stock").eq("product_code", line.productCode).single()).data;
    // Gerçek hayatta iki ayrı irsaliye: açıklamalar farklıdır. (Birebir aynı kayıt
    // 2 dakika içinde gelirse çift tıklama sayılıp tek kayıt tutulur.)
    await receive(half, "1. sevkiyat");
    await receive(half, "2. sevkiyat");
    const stockAfter = (await S().from("products").select("current_stock,reserved_stock").eq("product_code", line.productCode).single()).data;
    check("Aynı gün iki eşit sevkiyatın ikisi de stoğa girdi", Number(stockAfter.current_stock) - Number(stockBefore.current_stock) === half * 2, `${stockBefore.current_stock} → ${stockAfter.current_stock}`);
    check("Gelen malzeme projeye rezerve edildi", Number(stockAfter.reserved_stock) - Number(stockBefore.reserved_stock) === half * 2, `${stockBefore.reserved_stock} → ${stockAfter.reserved_stock}`);

    // 7b) Teslim almada irsaliye belgesi: iki sevkiyat aynı irsaliyede → tek belge,
    // siparişe ve projeye bağlı.
    const waybillDocs = await waitFor(async () => {
      const { data } = await S().from("documents").select("id,document_type,storage_path").eq("document_number", waybillNo);
      return data?.length ? data : null;
    }, { timeout: 20000, step: 2000 });
    const waybillLinks = waybillDocs?.length === 1
      ? (await S().from("document_links").select("order_id,project_id").eq("document_id", waybillDocs[0].id)).data || []
      : [];
    check("Teslim almada irsaliye belgesi oluştu (tek belge)", waybillInput && waybillDocs?.length === 1 && waybillDocs[0].document_type === "irsaliye", `${waybillDocs?.length || 0} belge`);
    check("İrsaliye siparişe ve projeye bağlandı",
      waybillLinks.some((l) => l.order_id === order.id) && waybillLinks.some((l) => l.project_id === projectA),
      waybillLinks.map((l) => (l.order_id ? "sipariş" : "proje")).join(","));

    // 8) Proje B iptal → rezerve stoğa döner
    await go("/dashboard/projeler", () => [...main().querySelectorAll("tr")].some((row) => row.innerText.includes(`${tag} Proje B`)));
    const rowB = [...main().querySelectorAll("tr")].find((row) => row.innerText.includes(`${tag} Proje B`));
    [...rowB.querySelectorAll("button")].find((b) => text(b) === "Düzenle").click();
    await sleep(1200);
    setValue(field("Durum"), "İptal");
    window.confirm = () => true;
    document.querySelector("form button[type=submit]").click();
    await waitFor(() => /iptal edildi/i.test(statusText()), { timeout: 30000 });
    const itemsB = await itemsOf(projectB);
    check("İptal edilen projenin rezervi bırakıldı", itemsB.every((i) => Number(i.reserved_quantity || 0) === 0), itemsB.map((i) => i.reserved_quantity).join(","));
    const bad2 = await invariant();
    check("İptal sonrası kart rezervleri tutarlı", bad2.length === 0, bad2.join(", "));

    // 9) Finans: iptal proje alacakta yok, A projesinde stok maliyeti düşülüyor;
    // proje detayındaki kâr ile Finans raporundaki kâr aynı.
    // Sekme ekranda kısa adıyla ("Finans") görünür.
    await go(`/dashboard/projeler/${projectA}`, () => findButton("Finans", { exact: true }));
    await click("Finans", { exact: true, after: 2500 });
    const projectProfitEl = await waitFor(() => main().querySelector("[data-testid=project-profit]"), { timeout: 20000 });
    const projectProfit = Number(projectProfitEl?.dataset.value);
    await go("/dashboard/finans", () => /Proje Bazlı Kâr/.test(main().innerText));
    await waitFor(() => main().innerText.includes(`${tag} Proje A`), { timeout: 20000 });
    check("Finans tablosunda iptal proje yok", !main().innerText.includes(`${tag} Proje B`));
    const rowA = [...main().querySelectorAll("tr")].find((row) => row.innerText.includes(`${tag} Proje A`));
    check("Finans tablosunda stok/gider maliyeti gösteriliyor", rowA && rowA.querySelectorAll("td").length >= 8);
    const financeProfit = Number(main().querySelector(`[data-testid=finance-project-profit][data-project-id="${projectA}"]`)?.dataset.value);
    check("Proje detayı ve Finans raporu aynı kâr/zararı gösteriyor",
      Number.isFinite(projectProfit) && Number.isFinite(financeProfit) && Math.abs(projectProfit - financeProfit) < 0.05,
      `proje ${projectProfit} · finans ${financeProfit}`);

    // 10) Temizlik: robotun proje A'sı da iptal edilir; rezervi depoya döner,
    // test hesabının finans ve proje ekranlarını kirletmez.
    try {
      await go("/dashboard/projeler", () => [...main().querySelectorAll("tr")].some((row) => row.innerText.includes(`${tag} Proje A`)));
      const rowA2 = [...main().querySelectorAll("tr")].find((row) => row.innerText.includes(`${tag} Proje A`));
      [...rowA2.querySelectorAll("button")].find((b) => text(b) === "Düzenle").click();
      await sleep(1200);
      setValue(field("Durum"), "İptal");
      window.confirm = () => true;
      document.querySelector("form button[type=submit]").click();
      await waitFor(() => /iptal edildi/i.test(statusText()), { timeout: 30000 });
      log("Temizlik: robot projeleri iptal edildi.");
    } catch (cleanupError) {
      log(`Temizlik yapılamadı: ${cleanupError.message}`);
    }

    const failed = checks.filter((c) => !c.ok);
    return { tag, checks, failed, projectA, projectB };
  }

  window.CorvianE2E = { run };
})();
