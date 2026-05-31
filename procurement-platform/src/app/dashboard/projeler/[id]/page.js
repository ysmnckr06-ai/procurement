"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { calculateBaseAmount, currencyOptions, getBaseCurrency, getExchangeRate } from "@/lib/currency";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const tabs = [
  "Genel Özet",
  "Tahmini Ürün/Malzeme Listesi",
  "Talepler",
  "Teklifler",
  "Siparişler",
  "Stok Hareketleri",
  "Ödemeler",
  "Raporlar",
];

const itemStatuses = [
  "SatÄ±nalma gerekli",
  "Talep oluÅŸturuldu",
  "Teklif bekleniyor",
  "SipariÅŸ verildi",
  "TedarikÃ§iden bekleniyor",
  "KÄ±smi geldi",
  "Eksik geldi",
  "Fazla geldi",
  "HatalÄ± / arÄ±zalÄ± geldi",
  "Projeye rezerve edildi",
  "Ãœretime verildi",
  "Sevk edildi",
  "Bekliyor",
  "Satınalma gerekli",
  "Sipariş verildi",
  "Depoda",
  "Üretimde",
  "Montajda",
  "Tamamlandı",
];

const paymentTypes = ["Avans", "Ara ödeme", "Hakediş", "Kapanış ödemesi"];

const lifecycleItemStatuses = [
  "Bekliyor",
  "Sat\u0131nalma gerekli",
  "Talep olu\u015fturuldu",
  "Teklif bekleniyor",
  "Sipari\u015f verildi",
  "Tedarik\u00e7iden bekleniyor",
  "K\u0131smi geldi",
  "Depoda",
  "Eksik geldi",
  "Fazla geldi",
  "Hatal\u0131 / ar\u0131zal\u0131 geldi",
  "Projeye rezerve edildi",
  "\u00dcretime verildi",
  "\u00dcretimde",
  "Montajda",
  "Sevk edildi",
  "Tamamland\u0131",
];

const emptyItem = {
  parent_item_id: "",
  product_code: "",
  product_name: "",
  unit: "adet",
  estimated_quantity: "",
  estimated_unit_price: "",
  status: "Bekliyor",
  note: "",
};

const emptyPayment = {
  payment_date: new Date().toISOString().slice(0, 10),
  amount: "",
  currency: "TRY",
  exchange_rate: 1,
  payment_type: "Avans",
  description: "",
};

function formatMoney(value) {
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))} TRY`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("tr-TR");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/\s+/g, " ");
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function statusClass(status) {
  const classes = {
    Taslak: "bg-slate-100 text-slate-700",
    Onaylandı: "bg-blue-100 text-blue-700",
    "Devam Ediyor": "bg-emerald-100 text-emerald-700",
    Tamamlandı: "bg-green-100 text-green-700",
    İptal: "bg-red-100 text-red-700",
  };

  return classes[status] || "bg-slate-100 text-slate-700";
}

function itemStatusClass(status) {
  const classes = {
    Bekliyor: "bg-slate-100 text-slate-700",
    "Sat\u0131nalma gerekli": "bg-red-100 text-red-700",
    "Talep olu\u015fturuldu": "bg-blue-100 text-blue-700",
    "Teklif bekleniyor": "bg-indigo-100 text-indigo-700",
    "Sipari\u015f verildi": "bg-blue-100 text-blue-700",
    "Tedarik\u00e7iden bekleniyor": "bg-sky-100 text-sky-700",
    "K\u0131smi geldi": "bg-amber-100 text-amber-700",
    Depoda: "bg-emerald-100 text-emerald-700",
    "Eksik geldi": "bg-yellow-100 text-yellow-800",
    "Fazla geldi": "bg-cyan-100 text-cyan-700",
    "Hatal\u0131 / ar\u0131zal\u0131 geldi": "bg-red-100 text-red-700",
    "Projeye rezerve edildi": "bg-teal-100 text-teal-700",
    "\u00dcretime verildi": "bg-violet-100 text-violet-700",
    "\u00dcretimde": "bg-purple-100 text-purple-700",
    Montajda: "bg-orange-100 text-orange-700",
    "Sevk edildi": "bg-slate-900 text-white",
    "Tamamland\u0131": "bg-green-100 text-green-700",
    "Talep oluÅŸturuldu": "bg-blue-100 text-blue-700",
    "Teklif bekleniyor": "bg-indigo-100 text-indigo-700",
    "TedarikÃ§iden bekleniyor": "bg-sky-100 text-sky-700",
    "KÄ±smi geldi": "bg-amber-100 text-amber-700",
    "Eksik geldi": "bg-yellow-100 text-yellow-800",
    "Fazla geldi": "bg-cyan-100 text-cyan-700",
    "HatalÄ± / arÄ±zalÄ± geldi": "bg-red-100 text-red-700",
    "Projeye rezerve edildi": "bg-teal-100 text-teal-700",
    "Ãœretime verildi": "bg-violet-100 text-violet-700",
    "Sevk edildi": "bg-slate-900 text-white",
    "Satınalma gerekli": "bg-red-100 text-red-700",
    "Sipariş verildi": "bg-blue-100 text-blue-700",
    Depoda: "bg-emerald-100 text-emerald-700",
    Üretimde: "bg-purple-100 text-purple-700",
    Montajda: "bg-orange-100 text-orange-700",
    Tamamlandı: "bg-green-100 text-green-700",
  };

  return classes[status] || "bg-slate-100 text-slate-700";
}

function SummaryCard({ title, value, text, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    green: "text-emerald-700",
    red: "text-red-600",
    blue: "text-blue-700",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-500">{title}</div>
      <div className={`mt-2 text-2xl font-black ${tones[tone]}`}>{value}</div>
      <div className="mt-1 text-sm text-slate-500">{text}</div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id;

  const [project, setProject] = useState(null);
  const [items, setItems] = useState([]);
  const [payments, setPayments] = useState([]);
  const [products, setProducts] = useState([]);
  const [projectRequests, setProjectRequests] = useState([]);
  const [projectOrders, setProjectOrders] = useState([]);
  const [stockMovements, setStockMovements] = useState([]);
  const [companySettings, setCompanySettings] = useState({ default_currency: "TRY", base_currency: "TRY" });
  const [activeTab, setActiveTab] = useState("Genel Özet");
  const [itemForm, setItemForm] = useState(emptyItem);
  const [paymentForm, setPaymentForm] = useState(emptyPayment);
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [expandedItems, setExpandedItems] = useState({});
  const [selectedPurchaseItemIds, setSelectedPurchaseItemIds] = useState([]);
  const [createdRequestId, setCreatedRequestId] = useState("");
  const [previewRows, setPreviewRows] = useState([]);
  const [previewWarnings, setPreviewWarnings] = useState([]);
  const [previewBlocked, setPreviewBlocked] = useState(false);
  const [previewSections, setPreviewSections] = useState([]);
  const [previewParentId, setPreviewParentId] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const visiblePreviewSections = useMemo(() => {
    const seen = new Set();

    return previewSections.filter((section) => {
      const name = String(section.section_name || "").trim().toUpperCase();
      const compactName = name.replace(/[^A-Z0-9ÇĞİÖŞÜ]/g, "");
      const total = Number(section.section_total || 0);

      if (!compactName || ["TL", "TRY", "EUR", "USD"].includes(compactName) || total <= 0) {
        return false;
      }

      const key = `${compactName}-${total.toFixed(2)}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }, [previewSections]);

  useEffect(() => {
    loadProject();
  }, [projectId]);

  async function getUserOrRedirect() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return null;
    }

    return user;
  }

  async function loadProject() {
    setLoading(true);
    const user = await getUserOrRedirect();
    if (!user) return;

    const [projectRes, itemRes, paymentRes, productRes, requestRes, orderRes, movementRes, settingsRes] = await Promise.all([
      supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("project_items")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("project_payments")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("payment_date", { ascending: false }),
      supabase
        .from("products")
        .select("*")
        .eq("user_id", user.id),
      supabase
        .from("requests")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("stock_movements")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("company_settings")
        .select("*")
        .eq("user_id", user.id)
        .limit(1),
    ]);

    if (projectRes.error) {
      setMessage("Proje bulunamadı veya proje tabloları hazır değil.");
      setLoading(false);
      return;
    }

    setProject(projectRes.data);
    setItems(itemRes.data || []);
    setPayments(paymentRes.data || []);
    setProducts(productRes.data || []);
    setProjectRequests(requestRes.data || []);
    setProjectOrders(orderRes.data || []);
    setStockMovements(movementRes.data || []);
    if (settingsRes.data?.[0]) setCompanySettings(settingsRes.data[0]);
    setLoading(false);
  }

  function stockForItem(item) {
    const code = normalizeCode(item.product_code);
    const name = normalizeText(item.product_name);

    const matched = products.filter((product) => {
      const productCode = normalizeCode(product.product_code);
      const productName = normalizeText(product.product_name);

      if (code && productCode && code === productCode && name === productName) return true;
      if (!code && name && name === productName) return true;
      return false;
    });

    return matched.reduce((sum, product) => sum + Number(product.current_stock || 0), 0);
  }

  function stockWarning(item) {
    const required = Number(item.estimated_quantity || 0);
    const available = stockForItem(item);

    if (required <= 0) return { available, text: "Miktar girilmedi", tone: "slate" };
    if (available >= required) return { available, text: "Stok yeterli", tone: "green" };
    if (available > 0) return { available, text: "Kısmi stok var", tone: "yellow" };
    return { available, text: "Satınalma gerekli", tone: "red" };
  }

  function updateItemForm(field, value) {
    setItemForm((prev) => ({ ...prev, [field]: value }));
  }

  function updatePaymentForm(field, value) {
    setPaymentForm((prev) => ({ ...prev, [field]: value }));
  }

  async function refreshProjectBudget(nextItems) {
    const estimatedTotal = nextItems.reduce((sum, item) => sum + Number(item.estimated_total || 0), 0);

    await supabase
      .from("projects")
      .update({
        estimated_budget: estimatedTotal,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", project.user_id);
  }

  async function addProjectItem(event) {
    event.preventDefault();
    setMessage("");

    const user = await getUserOrRedirect();
    if (!user) return;

    const quantity = Number(itemForm.estimated_quantity || 0);
    const unitPrice = Number(itemForm.estimated_unit_price || 0);
    const total = quantity * unitPrice;

    if (!itemForm.product_name.trim()) {
      setMessage("Ürün adı zorunlu.");
      return;
    }

    const payload = {
      user_id: user.id,
      project_id: projectId,
      parent_item_id: itemForm.parent_item_id || null,
      product_code: itemForm.product_code.trim().toUpperCase(),
      product_name: itemForm.product_name.trim(),
      unit: itemForm.unit || "adet",
      estimated_quantity: quantity,
      estimated_unit_price: unitPrice,
      estimated_total: total,
      status: itemForm.status,
      note: itemForm.note.trim(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("project_items")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      setMessage("Malzeme satırı eklenemedi. Supabase şemasında parent_item_id/status alanları çalıştırılmış olmalı.");
      return;
    }

    const nextItems = [...items, data];
    setItems(nextItems);
    setItemForm(emptyItem);
    await refreshProjectBudget(nextItems);
    await loadProject();
  }

  async function updateItemStatus(itemId, status) {
    const { error } = await supabase
      .from("project_items")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("project_id", projectId);

    if (error) {
      setMessage("Durum güncellenemedi.");
      return;
    }

    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, status } : item)));
  }

  async function deleteProjectItem(itemId) {
    const approved = window.confirm("Bu tahmini malzeme satırı silinsin mi?");
    if (!approved) return;

    const { error } = await supabase
      .from("project_items")
      .delete()
      .eq("id", itemId)
      .eq("project_id", projectId);

    if (error) {
      setMessage("Malzeme satırı silinemedi.");
      return;
    }

    const nextItems = items.filter((item) => item.id !== itemId && item.parent_item_id !== itemId);
    setItems(nextItems);
    await refreshProjectBudget(nextItems);
    await loadProject();
  }

  async function savePayment(event) {
    event.preventDefault();
    setMessage("");

    const user = await getUserOrRedirect();
    if (!user) return;

    const amount = Number(paymentForm.amount || 0);
    if (amount <= 0) {
      setMessage("Ödeme tutarı sıfırdan büyük olmalı.");
      return;
    }

    const payload = {
      payment_date: paymentForm.payment_date || new Date().toISOString().slice(0, 10),
      amount,
      original_amount: amount,
      currency: paymentForm.currency || project.contract_currency || getBaseCurrency(companySettings),
      exchange_rate: Number(paymentForm.exchange_rate || getExchangeRate(paymentForm.currency, companySettings)),
      exchange_rate_date: paymentForm.payment_date || new Date().toISOString().slice(0, 10),
      base_currency: getBaseCurrency(companySettings),
      base_amount: calculateBaseAmount(amount, paymentForm.currency, companySettings, paymentForm.exchange_rate),
      payment_type: paymentForm.payment_type,
      description: paymentForm.description.trim(),
    };

    const request = editingPaymentId
      ? supabase
          .from("project_payments")
          .update(payload)
          .eq("id", editingPaymentId)
          .eq("project_id", projectId)
          .eq("user_id", user.id)
          .select("*")
          .single()
      : supabase
          .from("project_payments")
          .insert({
            ...payload,
            user_id: user.id,
            project_id: projectId,
          })
          .select("*")
          .single();

    const { data, error } = await request;

    if (error) {
      setMessage("Ödeme kaydedilemedi.");
      return;
    }

    setPayments((prev) =>
      editingPaymentId
        ? prev.map((payment) => (payment.id === data.id ? data : payment))
        : [data, ...prev],
    );
    setPaymentForm(emptyPayment);
    setEditingPaymentId(null);
    setMessage(editingPaymentId ? "Ã–deme kaydÄ± gÃ¼ncellendi." : "Ã–deme kaydÄ± eklendi.");
  }

  function editPayment(payment) {
    setEditingPaymentId(payment.id);
    setPaymentForm({
      payment_date: payment.payment_date || new Date().toISOString().slice(0, 10),
      amount: payment.amount ?? "",
      currency: payment.currency || project.contract_currency || getBaseCurrency(companySettings),
      exchange_rate: payment.exchange_rate || getExchangeRate(payment.currency, companySettings),
      payment_type: payment.payment_type || "Avans",
      description: payment.description || "",
    });
    setMessage("Ã–deme kaydÄ± dÃ¼zenleniyor. DeÄŸiÅŸiklikleri formdan kaydedebilirsiniz.");
  }

  function cancelPaymentEdit() {
    setEditingPaymentId(null);
    setPaymentForm(emptyPayment);
    setMessage("");
  }

  async function deletePayment(payment) {
    const approved = window.confirm("Bu Ã¶deme kaydÄ±nÄ± silmek istediÄŸinize emin misiniz?");
    if (!approved) return;

    setMessage("");
    const user = await getUserOrRedirect();
    if (!user) return;

    const { error } = await supabase
      .from("project_payments")
      .delete()
      .eq("id", payment.id)
      .eq("project_id", projectId)
      .eq("user_id", user.id);

    if (error) {
      setMessage("Ã–deme kaydÄ± silinemedi.");
      return;
    }

    setPayments((prev) => prev.filter((item) => item.id !== payment.id));
    if (editingPaymentId === payment.id) {
      setEditingPaymentId(null);
      setPaymentForm(emptyPayment);
    }
    setMessage("Ã–deme kaydÄ± silindi. Finans Ã¶zetleri yeniden hesaplandÄ±.");
  }

  async function parseProjectItemFiles(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setIsParsing(true);
    setMessage("");
    setPreviewWarnings([]);
    setPreviewBlocked(false);
    setPreviewSections([]);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const token = session?.access_token;

      if (!token || !API_URL) {
        setMessage("Dosya okuma için oturum veya API adresi bulunamadı.");
        setIsParsing(false);
        return;
      }

      const formData = new FormData();
      files.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch(`${API_URL}/parse-project-items`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await response.json();
      const warnings = data.warnings || [];

      if (!response.ok || !data.success) {
        setPreviewWarnings(warnings.length > 0 ? warnings : [data.detail || "Dosyadan ürün okunamadı."]);
        setPreviewBlocked(true);
        setPreviewSections(data.sections || []);
        setMessage("Dosya kontrol edildi ama güvenli aktarım için kilitlendi.");
        setPreviewRows(data.rows || []);
      } else {
        setPreviewRows(data.rows || []);
        setPreviewWarnings(warnings);
        setPreviewBlocked(false);
        setPreviewSections(data.sections || []);
        setMessage(`${data.totalRows} satır okundu. Aktarmadan önce önizlemeyi kontrol edin.`);
      }
    } catch (error) {
      console.error(error);
      setMessage("Dosya okunurken hata oluştu.");
    } finally {
      setIsParsing(false);
      event.target.value = "";
    }
  }

  async function importPreviewRows() {
    if (previewRows.length === 0) return;

    const user = await getUserOrRedirect();
    if (!user) return;

    const payload = previewRows.map((row) => ({
      user_id: user.id,
      project_id: projectId,
      parent_item_id: previewParentId || null,
      product_code: String(row.product_code || "").trim().toUpperCase(),
      product_name: String(row.product_name || "").trim(),
      unit: row.unit || "adet",
      estimated_quantity: Number(row.estimated_quantity || 0),
      estimated_unit_price: Number(row.estimated_unit_price || 0),
      estimated_total: Number(row.estimated_total || 0),
      status: row.status || "Bekliyor",
      note: row.note || row.source_file || "",
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from("project_items")
      .insert(payload)
      .select("*");

    if (error) {
      setMessage("Önizleme satırları projeye aktarılamadı.");
      return;
    }

    const nextItems = [...items, ...(data || [])];
    setItems(nextItems);
    setPreviewRows([]);
    setPreviewParentId("");
    await refreshProjectBudget(nextItems);
    await loadProject();
    setMessage("Dosyadan okunan ürünler projeye aktarıldı.");
  }

  function togglePurchaseItem(itemId) {
    setSelectedPurchaseItemIds((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId],
    );
  }

  function mapItemToRequestLine(item) {
    return {
      urunKodu: item.product_code || "",
      urunAciklamasi: item.product_name || "",
      birim: item.unit || "adet",
      talepEdilenAdet: Number(item.estimated_quantity || 0),
      not: item.note || "",
      projectItemId: item.id,
      parentItemId: item.parent_item_id || null,
    };
  }

  async function createRequestFromSelectedItems() {
    setMessage("");
    setCreatedRequestId("");

    const user = await getUserOrRedirect();
    if (!user) return;

    const selectedItems = items.filter((item) => selectedPurchaseItemIds.includes(item.id));

    if (selectedItems.length === 0) {
      setMessage("Talep oluşturmak için en az bir ürün seçin.");
      return;
    }

    const requestItems = selectedItems.map(mapItemToRequestLine);
    const title = `${project.project_code || "PRJ"} - Satınalma Talebi`;

    const { data, error } = await supabase
      .from("requests")
      .insert({
        user_id: user.id,
        project_id: projectId,
        ad: title,
        durum: "Proje Talebi",
        filepath: null,
        totalitems: requestItems.length,
        items: requestItems,
      })
      .select("*")
      .single();

    if (error) {
      setMessage("Proje talebi oluşturulamadı. Requests tablosunda project_id ve items alanları çalıştırılmış olmalı.");
      return;
    }

    await supabase
      .from("project_items")
      .update({ status: "Satınalma gerekli", updated_at: new Date().toISOString() })
      .in("id", selectedItems.map((item) => item.id));

    setProjectRequests((prev) => [data, ...prev]);
    setSelectedPurchaseItemIds([]);
    setCreatedRequestId(data.id);
    setMessage("Proje satınalma talebi oluşturuldu.");
  }

  const parentItems = useMemo(() => items.filter((item) => !item.parent_item_id), [items]);

  const childItemsByParent = useMemo(() => {
    const grouped = {};
    items.forEach((item) => {
      if (!item.parent_item_id) return;
      grouped[item.parent_item_id] = [...(grouped[item.parent_item_id] || []), item];
    });
    return grouped;
  }, [items]);

  const purchaseRequiredItems = useMemo(() => {
    return items.filter((item) => item.status === "Satınalma gerekli");
  }, [items]);

  const totals = useMemo(() => {
    const itemEstimate = items.reduce((sum, item) => sum + Number(item.estimated_total || 0), 0);
    const orderTotal = projectOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
    const stockCost = stockMovements.reduce(
      (sum, movement) => sum + Number(movement.quantity || 0) * Number(movement.unit_price || 0),
      0,
    );
    const actualCost = Number(project?.actual_cost || 0) || orderTotal + stockCost;
    const contract = Number(project?.contract_amount || 0);
    const estimatedBudget = itemEstimate || Number(project?.estimated_budget || 0);
    const remainingBudget = estimatedBudget - actualCost;
    const budgetVariance = actualCost - estimatedBudget;
    const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const remainingCollection = contract - paidTotal;

    return {
      itemEstimate,
      actualCost,
      orderTotal,
      stockCost,
      contract,
      estimatedBudget,
      remainingBudget,
      budgetVariance,
      paidTotal,
      remainingCollection,
    };
  }, [items, payments, project, projectOrders, stockMovements]);

  const projectKpis = useMemo(() => {
    const mainItems = items.filter((item) => !item.parent_item_id);
    const childItems = items.filter((item) => item.parent_item_id);
    const completedItems = items.filter((item) =>
      ["Tamamlandı", "Sevk edildi", "Depoda"].includes(item.status),
    ).length;
    const receivedItems = items.filter((item) => Number(item.received_quantity || 0) > 0 || item.status === "Depoda").length;
    const missingItems = items.filter((item) =>
      ["Satınalma gerekli", "Eksik geldi", "Tedarikçiden bekleniyor"].includes(item.status),
    ).length;
    const openOrders = projectOrders.filter(
      (order) => !["Tam Teslim", "Teslim Edildi", "İptal"].includes(order.status),
    ).length;
    const materialCompletion =
      items.length > 0 ? Math.round((receivedItems / items.length) * 100) : 0;
    const completion =
      items.length > 0 ? Math.round((completedItems / items.length) * 100) : 0;
    const collection =
      totals.contract > 0 ? Math.round((totals.paidTotal / totals.contract) * 100) : 0;
    const profitLoss = totals.contract - totals.actualCost;

    return {
      mainItems,
      childItems,
      completion,
      materialCompletion,
      collection,
      totalOrders: projectOrders.length,
      openOrders,
      receivedItems,
      missingItems,
      actualCost: totals.actualCost,
      profitLoss,
      budgetVariance: totals.budgetVariance,
    };
  }, [items, projectOrders, totals]);

  function panelStats(parent) {
    const children = childItemsByParent[parent.id] || [];
    const missing = children.filter((item) =>
      ["Satınalma gerekli", "Eksik geldi", "Tedarikçiden bekleniyor"].includes(item.status),
    ).length;
    const production = children.filter((item) =>
      ["Üretime verildi", "Üretimde", "Montajda"].includes(item.status),
    ).length;
    const completed = children.filter((item) =>
      ["Depoda", "Tamamlandı", "Sevk edildi"].includes(item.status),
    ).length;
    const completion = children.length > 0 ? Math.round((completed / children.length) * 100) : 0;

    return { total: children.length, missing, production, completion };
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Proje yükleniyor...</div>;
  }

  if (!project) {
    return (
      <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-bold text-yellow-900">
        {message || "Proje bulunamadı."}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link href="/dashboard/projeler" className="text-sm font-bold text-blue-700 hover:underline">
              Projelere dön
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-bold text-slate-900">{project.project_name}</h1>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(project.status)}`}>
                {project.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {project.project_code} · {project.customer_name || "Müşteri belirtilmedi"}
            </p>
          </div>
          <button
            type="button"
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
            onClick={() => window.print()}
          >
            Proje Raporu
          </button>
        </div>

        {message && (
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold text-yellow-900">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <span>{message}</span>
              {createdRequestId && (
                <Link
                  href="/dashboard/talepler"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-center text-xs font-bold text-white hover:bg-blue-700"
                >
                  Talepler sayfasına git
                </Link>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
          <SummaryCard title="Sözleşme Bedeli" value={formatMoney(totals.contract)} text="Proje geliri" tone="blue" />
          <SummaryCard title="Tahsil Edilen" value={formatMoney(totals.paidTotal)} text="Ödeme toplamı" tone="green" />
          <SummaryCard title="Kalan Tahsilat" value={formatMoney(totals.remainingCollection)} text="Sözleşme - tahsilat" tone={totals.remainingCollection < 0 ? "red" : "blue"} />
          <SummaryCard title="Tahmini Maliyet" value={formatMoney(totals.estimatedBudget)} text="Malzeme listesi" />
          <SummaryCard title="Gerçekleşen Maliyet" value={formatMoney(totals.actualCost)} text="Satınalma bağlantıları eklenecek" />
          <SummaryCard title="Kalan Bütçe" value={formatMoney(totals.remainingBudget)} text="Tahmini - gerçekleşen" tone={totals.remainingBudget < 0 ? "red" : "green"} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <SummaryCard title="Tamamlanma" value={`%${projectKpis.completion}`} text="Kalem bazlı" tone="blue" />
          <SummaryCard title="Malzeme Tamamlama" value={`%${projectKpis.materialCompletion}`} text="Gelen/depoda" tone="green" />
          <SummaryCard title="Tahsilat" value={`%${projectKpis.collection}`} text="Tahsil edilen" tone="green" />
          <SummaryCard title="Toplam Sipariş" value={projectKpis.totalOrders} text={`${projectKpis.openOrders} açık sipariş`} />
          <SummaryCard title="Eksik Malzeme" value={projectKpis.missingItems} text={`${projectKpis.receivedItems} gelen kalem`} tone={projectKpis.missingItems > 0 ? "red" : "green"} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <SummaryCard title="Gerçekleşen Maliyet" value={formatMoney(projectKpis.actualCost)} text="Sipariş + stok" />
          <SummaryCard title="Kâr / Zarar" value={formatMoney(projectKpis.profitLoss)} text="Sözleşme - maliyet" tone={projectKpis.profitLoss < 0 ? "red" : "green"} />
          <SummaryCard title="Bütçe Sapması" value={formatMoney(projectKpis.budgetVariance)} text="Gerçekleşen - tahmini" tone={projectKpis.budgetVariance > 0 ? "red" : "green"} />
          <SummaryCard title="Açık Sipariş" value={projectKpis.openOrders} text="Tamamlanmamış" tone={projectKpis.openOrders > 0 ? "blue" : "green"} />
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="flex min-w-max gap-2">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-xl px-4 py-3 text-sm font-bold ${
                  activeTab === tab ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "Genel Özet" && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
              <h2 className="text-xl font-bold text-slate-900">Proje Bilgileri</h2>
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-xs font-bold text-slate-500">Proje Sorumlusu</div>
                  <div className="mt-1 font-bold text-slate-900">{project.project_owner || "-"}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-xs font-bold text-slate-500">Tarih Aralığı</div>
                  <div className="mt-1 font-bold text-slate-900">
                    {formatDate(project.start_date)} - {formatDate(project.planned_end_date)}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 md:col-span-2">
                  <div className="text-xs font-bold text-slate-500">Açıklama</div>
                  <div className="mt-1 text-sm leading-6 text-slate-700">{project.description || "-"}</div>
                </div>
              </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900">Tahsilat Özeti</h2>
              <div className="mt-5 space-y-3">
                <SummaryCard title="Sözleşme" value={formatMoney(totals.contract)} text="Toplam bedel" />
                <SummaryCard title="Tahsil Edilen" value={formatMoney(totals.paidTotal)} text="Project payments toplamı" tone="green" />
                <SummaryCard title="Kalan Tahsilat" value={formatMoney(totals.remainingCollection)} text="Sözleşme - tahsil edilen" tone={totals.remainingCollection < 0 ? "red" : "blue"} />
              </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900">Ana Ürün / Pano Durum Takibi</h2>
              <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
                {parentItems.map((item) => {
                  const stats = panelStats(item);
                  return (
                    <div key={item.id} className="rounded-2xl border border-slate-100 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-black text-slate-900">{item.product_name}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.product_code || "-"} · {item.panel_status || item.status || "Bekliyor"}</div>
                        </div>
                        <span className={`w-max rounded-full px-3 py-1 text-xs font-bold ${itemStatusClass(item.panel_status || item.status || "Bekliyor")}`}>
                          {item.panel_status || item.status || "Bekliyor"}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs font-bold text-slate-500">Alt malzeme</div>
                          <div className="mt-1 font-black text-slate-900">{stats.total}</div>
                        </div>
                        <div className="rounded-xl bg-red-50 p-3">
                          <div className="text-xs font-bold text-red-600">Eksik</div>
                          <div className="mt-1 font-black text-red-700">{stats.missing}</div>
                        </div>
                        <div className="rounded-xl bg-purple-50 p-3">
                          <div className="text-xs font-bold text-purple-600">Üretime verilen</div>
                          <div className="mt-1 font-black text-purple-700">{stats.production}</div>
                        </div>
                        <div className="rounded-xl bg-emerald-50 p-3">
                          <div className="text-xs font-bold text-emerald-600">Tamamlanma</div>
                          <div className="mt-1 font-black text-emerald-700">%{stats.completion}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {parentItems.length === 0 && (
                  <div className="rounded-xl bg-slate-50 p-6 text-sm text-slate-500">
                    Ana ürün veya pano henüz eklenmemiş.
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === "Tahmini Ürün/Malzeme Listesi" && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.2fr]">
              <form onSubmit={addProjectItem} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-bold text-slate-900">Malzeme Ekle</h2>
                <div className="mt-5 space-y-4">
                  <select className="w-full rounded-xl border border-slate-300 p-3" value={itemForm.parent_item_id} onChange={(e) => updateItemForm("parent_item_id", e.target.value)}>
                    <option value="">Ana ürün olarak ekle</option>
                    {parentItems.map((item) => (
                      <option key={item.id} value={item.id}>{item.product_name}</option>
                    ))}
                  </select>
                  <input className="w-full rounded-xl border border-slate-300 p-3" placeholder="Ürün kodu" value={itemForm.product_code} onChange={(e) => updateItemForm("product_code", e.target.value)} />
                  <input className="w-full rounded-xl border border-slate-300 p-3" placeholder="Ürün adı" value={itemForm.product_name} onChange={(e) => updateItemForm("product_name", e.target.value)} />
                  <div className="grid grid-cols-3 gap-3">
                    <input className="rounded-xl border border-slate-300 p-3" placeholder="Birim" value={itemForm.unit} onChange={(e) => updateItemForm("unit", e.target.value)} />
                    <input type="number" className="rounded-xl border border-slate-300 p-3" placeholder="Miktar" value={itemForm.estimated_quantity} onChange={(e) => updateItemForm("estimated_quantity", e.target.value)} />
                    <input type="number" className="rounded-xl border border-slate-300 p-3" placeholder="Birim fiyat" value={itemForm.estimated_unit_price} onChange={(e) => updateItemForm("estimated_unit_price", e.target.value)} />
                  </div>
                  <select className="w-full rounded-xl border border-slate-300 p-3" value={itemForm.status} onChange={(e) => updateItemForm("status", e.target.value)}>
                    {lifecycleItemStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                  <textarea className="w-full rounded-xl border border-slate-300 p-3" rows={3} placeholder="Not" value={itemForm.note} onChange={(e) => updateItemForm("note", e.target.value)} />
                  <button type="submit" className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700">
                    Malzeme Ekle
                  </button>
                </div>
              </form>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-bold text-slate-900">Excel / PDF / Görselden Ürünleri Yükle</h2>
                <p className="mt-2 text-sm text-slate-500">Dosyadan okunan satırlar önce önizlemeye alınır, kontrol ettikten sonra projeye aktarılır.</p>
                <input
                  type="file"
                  multiple
                  accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg"
                  onChange={parseProjectItemFiles}
                  className="mt-5 w-full rounded-xl border border-dashed border-blue-300 bg-blue-50 p-4 text-sm"
                />
                {previewWarnings.length > 0 && (
                  <div className={`mt-4 rounded-xl border p-4 text-sm ${previewBlocked ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                    <div className="font-bold">{previewBlocked ? "Aktarım kilitlendi" : "Fiyatlandırma notu"}</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {previewWarnings.slice(0, 6).map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                    {previewWarnings.length > 6 && (
                      <div className="mt-2 text-xs font-bold">
                        +{previewWarnings.length - 6} ek kontrol uyarısı var.
                      </div>
                    )}
                  </div>
                )}
                {visiblePreviewSections.length > 0 && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <div className="font-bold">Kategori toplamları ürün olarak aktarılmayacak</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {visiblePreviewSections.map((section) => (
                        <span key={`${section.section_name}-${section.section_total}`} className="rounded-full bg-white px-3 py-1 text-xs font-bold">
                          {section.section_name}: {formatMoney(section.section_total)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
                  <select className="rounded-xl border border-slate-300 p-3 text-sm" value={previewParentId} onChange={(e) => setPreviewParentId(e.target.value)}>
                    <option value="">Aktarırken ana ürün olarak ekle</option>
                    {parentItems.map((item) => (
                      <option key={item.id} value={item.id}>{item.product_name} altına aktar</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={previewRows.length === 0 || isParsing || previewBlocked}
                    onClick={importPreviewRows}
                    className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-300"
                  >
                    {isParsing ? "Okunuyor..." : previewBlocked ? "Kontrol Gerekli" : "Projeye Aktar"}
                  </button>
                </div>
                {previewRows.length > 0 && (
                  <div className="mt-5 max-h-80 overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="p-3">Ürün</th>
                          <th className="p-3">Miktar</th>
                          <th className="p-3">Birim Fiyat</th>
                          <th className="p-3">Toplam</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, index) => (
                          <tr key={`${row.product_code}-${index}`} className="border-t border-slate-100">
                            <td className="p-3">
                              <div className="font-bold text-slate-900">{row.product_name}</div>
                              <div className="text-slate-500">{row.product_code || "-"}</div>
                              {row.section_name && (
                                <div className="mt-1 text-[11px] font-bold text-amber-700">
                                  {row.section_name}
                                </div>
                              )}
                            </td>
                            <td className="p-3">{row.estimated_quantity} {row.unit || "adet"}</td>
                            <td className="p-3">
                              {row.price_status === "section_total_only" ? (
                                <span className="text-xs font-bold text-amber-700">Kategori toplamında</span>
                              ) : formatMoney(row.estimated_unit_price)}
                            </td>
                            <td className="p-3 font-bold">
                              {row.price_status === "section_total_only" ? "-" : formatMoney(row.estimated_total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Tahmini Liste</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Toplam: {formatMoney(totals.itemEstimate)} · Satınalma gerekli: {purchaseRequiredItems.length}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={selectedPurchaseItemIds.length === 0}
                  onClick={createRequestFromSelectedItems}
                  className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-300"
                >
                  Seçilenlerden Talep Oluştur ({selectedPurchaseItemIds.length})
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {parentItems.map((item) => {
                  const children = childItemsByParent[item.id] || [];
                  const stock = stockWarning(item);

                  return (
                    <div key={item.id} className="rounded-2xl border border-slate-200">
                      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                        <div className="flex items-start gap-3">
                          {item.status === "Satınalma gerekli" && (
                            <input
                              type="checkbox"
                              checked={selectedPurchaseItemIds.includes(item.id)}
                              onChange={() => togglePurchaseItem(item.id)}
                              className="mt-1 h-4 w-4"
                            />
                          )}
                          <div>
                            <div className="font-black text-slate-900">{item.product_name}</div>
                            <div className="text-xs text-slate-500">{item.product_code || "-"} · {Number(item.estimated_quantity || 0)} {item.unit || "adet"}</div>
                          </div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${itemStatusClass(item.status)}`}>{item.status || "Bekliyor"}</span>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                          stock.tone === "green" ? "bg-green-100 text-green-700" :
                          stock.tone === "yellow" ? "bg-yellow-100 text-yellow-700" :
                          stock.tone === "red" ? "bg-red-100 text-red-700" :
                          "bg-slate-100 text-slate-700"
                        }`}>
                          Stok: {stock.available} · {stock.text}
                        </span>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setExpandedItems((prev) => ({ ...prev, [item.id]: !prev[item.id] }))} className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100">
                            Alt Malzemeleri Gör / Ekle
                          </button>
                          <button type="button" onClick={() => deleteProjectItem(item.id)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100">
                            Sil
                          </button>
                        </div>
                      </div>
                      {expandedItems[item.id] && (
                        <div className="border-t border-slate-100 bg-slate-50 p-4">
                          {children.length === 0 && <div className="text-sm text-slate-500">Alt malzeme yok.</div>}
                          <div className="space-y-2">
                            {children.map((child) => {
                              const childStock = stockWarning(child);
                              return (
                                <div key={child.id} className="grid grid-cols-1 gap-3 rounded-xl bg-white p-3 text-sm md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                                  <div className="flex items-start gap-3">
                                    {child.status === "Satınalma gerekli" && (
                                      <input
                                        type="checkbox"
                                        checked={selectedPurchaseItemIds.includes(child.id)}
                                        onChange={() => togglePurchaseItem(child.id)}
                                        className="mt-1 h-4 w-4"
                                      />
                                    )}
                                    <div>
                                      <div className="font-bold text-slate-900">{child.product_name}</div>
                                      <div className="text-xs text-slate-500">{child.product_code || "-"} · {Number(child.estimated_quantity || 0)} {child.unit || "adet"}</div>
                                    </div>
                                  </div>
                                  <select className="rounded-lg border border-slate-200 p-2 text-xs font-bold" value={child.status || "Bekliyor"} onChange={(e) => updateItemStatus(child.id, e.target.value)}>
                                    {lifecycleItemStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                                  </select>
                                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                                    childStock.tone === "green" ? "bg-green-100 text-green-700" :
                                    childStock.tone === "yellow" ? "bg-yellow-100 text-yellow-700" :
                                    childStock.tone === "red" ? "bg-red-100 text-red-700" :
                                    "bg-slate-100 text-slate-700"
                                  }`}>
                                    Stok: {childStock.available} · {childStock.text}
                                  </span>
                                  <button type="button" onClick={() => deleteProjectItem(child.id)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100">
                                    Sil
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {parentItems.length === 0 && (
                  <div className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">Henüz tahmini malzeme yok.</div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === "Ödemeler" && (
          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.3fr]">
            <form onSubmit={savePayment} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-slate-900">{editingPaymentId ? "Ödeme Düzenle" : "Ödeme Ekle"}</h2>
                {editingPaymentId && (
                  <button
                    type="button"
                    onClick={cancelPaymentEdit}
                    className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
                  >
                    Vazgeç
                  </button>
                )}
              </div>
              <div className="mt-5 space-y-4">
                <input type="date" className="w-full rounded-xl border border-slate-300 p-3" value={paymentForm.payment_date} onChange={(e) => updatePaymentForm("payment_date", e.target.value)} />
                <input type="number" className="w-full rounded-xl border border-slate-300 p-3" placeholder="Ödeme tutarı" value={paymentForm.amount} onChange={(e) => updatePaymentForm("amount", e.target.value)} />
                <select className="w-full rounded-xl border border-slate-300 p-3" value={paymentForm.currency} onChange={(e) => {
                  updatePaymentForm("currency", e.target.value);
                  updatePaymentForm("exchange_rate", getExchangeRate(e.target.value, companySettings));
                }}>
                  {currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}
                </select>
                <input type="number" className="w-full rounded-xl border border-slate-300 p-3" placeholder="Kur" value={paymentForm.exchange_rate} onChange={(e) => updatePaymentForm("exchange_rate", e.target.value)} />
                <select className="w-full rounded-xl border border-slate-300 p-3" value={paymentForm.payment_type} onChange={(e) => updatePaymentForm("payment_type", e.target.value)}>
                  {paymentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <textarea className="w-full rounded-xl border border-slate-300 p-3" rows={3} placeholder="Açıklama" value={paymentForm.description} onChange={(e) => updatePaymentForm("description", e.target.value)} />
                <button type="submit" className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700">
                  {editingPaymentId ? "Değişiklikleri Kaydet" : "Ödemeyi Kaydet"}
                </button>
              </div>
            </form>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900">Ödeme Geçmişi</h2>
              <div className="mt-5 overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500">
                    <tr>
                      <th className="p-3">Tarih</th>
                      <th className="p-3">Tip</th>
                      <th className="p-3">Açıklama</th>
                      <th className="p-3 text-right">Tutar</th>
                      <th className="p-3 text-right">Base</th>
                      <th className="p-3 text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id} className="border-t border-slate-100">
                        <td className="p-3 font-semibold text-slate-700">{formatDate(payment.payment_date)}</td>
                        <td className="p-3 font-bold text-slate-900">{payment.payment_type}</td>
                        <td className="p-3 text-slate-500">{payment.description || "-"}</td>
                        <td className="p-3 text-right font-black text-emerald-700">
                          {formatMoney(payment.amount)} {payment.currency || "TRY"}
                        </td>
                        <td className="p-3 text-right text-xs font-bold text-slate-500">
                          {payment.base_amount ? `${formatMoney(payment.base_amount)} ${payment.base_currency || "TRY"}` : "-"}
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => editPayment(payment)}
                              className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                            >
                              Düzenle
                            </button>
                            <button
                              type="button"
                              onClick={() => deletePayment(payment)}
                              className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                            >
                              Sil
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {payments.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-4 text-sm text-slate-500">Henüz ödeme yok.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {activeTab === "Talepler" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Proje Talepleri</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Bu projeden oluşturulan satınalma talepleri burada listelenir.
                </p>
              </div>
              <Link
                href="/dashboard/talepler"
                className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white hover:bg-blue-700"
              >
                Talepler Sayfasına Git
              </Link>
            </div>

            <div className="mt-5 space-y-3">
              {projectRequests.map((request) => (
                <div key={request.id} className="rounded-xl border border-slate-100 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-black text-slate-900">{request.ad || "Proje Talebi"}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatDate(request.created_at)} · {request.totalitems || request.items?.length || 0} kalem
                      </div>
                    </div>
                    <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-bold text-purple-700">
                      {request.durum || "Proje Talebi"}
                    </span>
                  </div>
                </div>
              ))}
              {projectRequests.length === 0 && (
                <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
                  Bu proje için henüz talep oluşturulmadı.
                </div>
              )}
            </div>
          </section>
        )}

        {!["Genel Özet", "Tahmini Ürün/Malzeme Listesi", "Ödemeler", "Talepler"].includes(activeTab) && (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">{activeTab}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-500">
              Bu sekme bir sonraki adımda mevcut modüllere proje bağlantısı eklenince otomatik dolacak.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
