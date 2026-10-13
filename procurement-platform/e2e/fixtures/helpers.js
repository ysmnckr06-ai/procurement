// Tarayıcıda (giriş yapılmış CORVIAN sekmesinde) uçtan uca senaryoyu sürmek için
// yardımcılar. Yükleme: eval(await (await fetch(URL)).text())
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const S = () => window.__supabase;
  const main = () => document.querySelector("main") || document.body;
  const text = (el) => (el?.innerText || el?.textContent || "").trim();

  const buttons = (root = main()) => [...root.querySelectorAll("button")];
  const findButton = (label, { exact = false, root } = {}) =>
    buttons(root).find((b) => (exact ? text(b) === label : text(b).startsWith(label)) && !b.disabled);

  async function waitFor(fn, { timeout = 30000, step = 400 } = {}) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeout) {
      const v = await fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  async function click(label, opts = {}) {
    const b = await waitFor(() => findButton(label, opts), { timeout: opts.timeout || 15000 });
    if (!b) throw new Error(`Düğme bulunamadı: ${label}`);
    b.click();
    await sleep(opts.after ?? 600);
    return text(b);
  }

  function setValue(el, value) {
    const proto =
      el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value));
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    if (el.tagName !== "SELECT") el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function field(labelStart, root = document) {
    const l = [...root.querySelectorAll("label")].find((x) => text(x).startsWith(labelStart));
    return l?.querySelector("input,select,textarea") || null;
  }

  async function attach(input, url, name) {
    const buf = await (await fetch(url)).arrayBuffer();
    const file = new File([buf], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function status() {
    return [...document.querySelectorAll('[role=status],[role=alert]')].map(text).filter(Boolean).join(" | ");
  }

  async function tab(name) {
    await click(name, { exact: true, after: 1200 });
  }

  function selectAllCheckbox(index) {
    const labels = [...main().querySelectorAll("label")].filter((e) => text(e) === "Tümünü Seç");
    const input = labels[index]?.querySelector("input");
    if (!input) throw new Error(`Tümünü Seç #${index} yok`);
    if (!input.checked) input.click();
  }

  async function projectItems(projectId) {
    const { data } = await S().from("project_items").select("*").eq("project_id", projectId);
    return data || [];
  }

  async function stockSnapshot() {
    const { data } = await S().from("products").select("id,product_code,current_stock,reserved_stock").limit(2000);
    return Object.fromEntries((data || []).map((p) => [p.product_code, { stock: +p.current_stock, reserved: +p.reserved_stock, id: p.id }]));
  }

  window.E2E = { sleep, waitFor, click, findButton, setValue, field, attach, status, tab, selectAllCheckbox, projectItems, stockSnapshot, text, main };
})();
