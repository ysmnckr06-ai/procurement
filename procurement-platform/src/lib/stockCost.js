// Stoktan projeye ayrılan malzemenin maliyeti. Öncelik:
//   1) ayırma hareketine yazılan alış fiyatı (ayırma anındaki son alış fiyatı)
//   2) ürün kartının son alış fiyatı (yoksa elle girilen fiyat)
//   3) son çare: proje kalemindeki teklif/BOM fiyatı
// Tutar baz para birimine toBase(amount, currency) ile çevrilir.

function normalize(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i");
}

export function isStockReservationMovement(movement) {
  const source = normalize(movement?.source);
  // Projeler arası aktarımda veren kaleme eksi, alana artı rezerv yazılır; maliyet
  // böylece malzemeyle birlikte projeden projeye taşınır.
  return movement?.movement_type === "out" && (source.includes("stoktan karsiland") || source.includes("projeler arasi aktarim"));
}

export function stockReservationCost(movement, { item, product, toBase }) {
  const quantity = Number(movement?.reserved_quantity || 0);
  if (quantity === 0) return { amount: 0, basis: "none" };

  const movementPrice = Number(movement?.unit_price || 0);
  if (movementPrice > 0) {
    return { amount: toBase(quantity * movementPrice, movement.currency || "TRY"), basis: "alis" };
  }
  const productPrice = Number(product?.last_unit_price || 0) || Number(product?.manual_unit_price || 0);
  if (productPrice > 0) {
    return { amount: toBase(quantity * productPrice, product.last_currency || "TRY"), basis: "alis" };
  }
  const itemPrice = Number(item?.resolved_unit_price || item?.estimated_unit_price || 0);
  if (itemPrice > 0) {
    const currency = String(item?.currency || "TRY").toUpperCase();
    const itemRate = Number(item?.exchange_rate || 0);
    const amount = currency !== "TRY" && itemRate > 0 ? quantity * itemPrice * itemRate : toBase(quantity * itemPrice, currency);
    return { amount, basis: "tahmin" };
  }
  return { amount: 0, basis: "fiyatsiz" };
}

export function projectStockUsage(movements, { itemById, productById, toBase }) {
  return (movements || []).reduce(
    (summary, movement) => {
      if (!isStockReservationMovement(movement)) return summary;
      const item = itemById.get(String(movement.project_item_id || ""));
      const product = productById?.get(String(movement.product_id || item?.product_id || ""));
      const cost = stockReservationCost(movement, { item, product, toBase });
      summary.total += cost.amount;
      if (cost.basis === "tahmin") summary.estimated += cost.amount;
      if (cost.basis === "fiyatsiz") summary.unpriced += 1;
      return summary;
    },
    { total: 0, estimated: 0, unpriced: 0 },
  );
}
