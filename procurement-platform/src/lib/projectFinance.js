// Proje maliyet / kâr hesabının tek kaynağı. Proje detay sayfası, Finans raporu ve
// Kontrol Merkezi aynı tanımları kullanır; böylece aynı proje her ekranda aynı
// rakamı gösterir. Tüm tutarlar baz para biriminde gelir.
//
//   Gerçekleşen maliyet  = onaylı faturalar + ek giderler + stoktan kullanılan malzeme
//   Beklenen maliyet     = max(faturalar, sipariş payı) + ek giderler + stoktan kullanılan
//                          (fatura gelene kadar sipariş de maliyettir; ikisi aynı alımı
//                          anlattığı için büyük olanı alınır, çift sayılmaz)
//   Kâr / zarar          = sözleşme − beklenen maliyet
//   Bütçe farkı          = bütçe − beklenen maliyet  (eksi: bütçe aşıldı)

const CANCELLED_ORDER_STATUSES = new Set(["İptal", "Iptal", "İptal Edildi"]);

// İptal edilen sipariş proje maliyetine girmez.
export function isCancelledOrder(order) {
  return CANCELLED_ORDER_STATUSES.has(String(order?.status || "").trim());
}

export function orderBaseValue(order) {
  return Number(order?.order_total_base || order?.base_amount || order?.total_amount || 0);
}

function allocationQuantityFor(item, projectId) {
  return (Array.isArray(item?.allocations) ? item.allocations : [])
    .filter((allocation) => String(allocation.projectId || allocation.project_id || "") === String(projectId))
    .reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0);
}

// Siparişin bu projeye düşen tutarı (baz para): doğrudan proje siparişi tamamı,
// çok projeli siparişte kalem dağıtım (allocation) oranı kadar.
export function orderProjectAllocationValue(order, projectId) {
  if (!order) return 0;
  if (String(order.project_id || "") === String(projectId)) return orderBaseValue(order);
  const fullBase = orderBaseValue(order);
  const fullOriginal = Number(order.total_amount || 0);
  const rate = fullOriginal > 0 && fullBase > 0 ? fullBase / fullOriginal : Number(order.exchange_rate || 1) || 1;
  return (Array.isArray(order.items) ? order.items : []).reduce((sum, item) => {
    const quantity = Number(item.quantity || 0);
    if (quantity <= 0) return sum;
    const projectQuantity = allocationQuantityFor(item, projectId);
    if (projectQuantity <= 0) return sum;
    const itemTotal = Number(item.total || 0) || quantity * Number(item.netUnitPrice || item.unitPrice || 0);
    return sum + itemTotal * rate * Math.min(projectQuantity / quantity, 1);
  }, 0);
}

export function orderProjectShare(order, projectId) {
  if (!order) return 0;
  if (String(order.project_id || "") === String(projectId)) return 1;
  const fullValue = orderBaseValue(order);
  return fullValue > 0 ? Math.min(orderProjectAllocationValue(order, projectId) / fullValue, 1) : 0;
}

export function orderBelongsToProject(order, projectId) {
  if (String(order?.project_id || "") === String(projectId)) return true;
  return (Array.isArray(order?.items) ? order.items : []).some((item) => allocationQuantityFor(item, projectId) > 0);
}

export function contractBaseAmount(project) {
  return Number(project?.contract_base_amount ?? project?.contract_amount ?? 0) || 0;
}

export function budgetBaseAmount(project) {
  return Number(project?.estimated_budget_base_amount ?? project?.estimated_budget ?? 0) || 0;
}

export function rowBaseAmount(row) {
  return Number(row?.base_amount ?? row?.amount ?? 0) || 0;
}

export function projectProfitSummary({
  contractAmount = 0,
  estimatedBudget = 0,
  orderCommitment = 0,
  invoiceTotal = 0,
  manualExpenses = 0,
  stockUsageCost = 0,
}) {
  const actualCost = invoiceTotal + manualExpenses + stockUsageCost;
  const expectedCost = Math.max(invoiceTotal, orderCommitment) + manualExpenses + stockUsageCost;
  const profitLoss = contractAmount - expectedCost;
  return {
    actualCost,
    expectedCost,
    profitLoss,
    profitMargin: contractAmount > 0 ? (profitLoss / contractAmount) * 100 : 0,
    budgetVariance: estimatedBudget - expectedCost,
    budgetExceeded: estimatedBudget > 0 && expectedCost > estimatedBudget,
    costRealizationRate: estimatedBudget > 0 ? (actualCost / estimatedBudget) * 100 : null,
  };
}

// Sipariş başına onaylı fatura toplamı (baz para). documents: fatura satırları,
// links: {document_id, order_id}. Reddedilen faturalar sayılmaz.
export function invoiceTotalsByOrder(documents, links, toBase) {
  const orderByDocument = new Map();
  for (const link of links || []) {
    if (link?.document_id && link?.order_id) orderByDocument.set(String(link.document_id), String(link.order_id));
  }
  const totals = new Map();
  for (const document of documents || []) {
    if (String(document.document_type || "") !== "fatura") continue;
    if (String(document.approval_status || "") === "reddedildi") continue;
    const orderId = orderByDocument.get(String(document.id));
    if (!orderId) continue;
    const amount = toBase(Number(document.invoice_total || 0), document.currency, document.exchange_rate);
    totals.set(orderId, (totals.get(orderId) || 0) + amount);
  }
  return totals;
}
