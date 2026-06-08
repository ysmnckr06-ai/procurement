export function formatQuantity(value) {
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(Number(value || 0));
}

export function findParentItem(item, items = []) {
  if (!item?.parent_item_id) return null;
  return (
    items.find((candidate) => candidate.id === item.parent_item_id) || null
  );
}

export function componentRelationForItem(item, items = []) {
  const parent = findParentItem(item, items);
  const parentQuantity = Math.max(Number(parent?.estimated_quantity || 0), 0);
  const childQuantityTotal = Math.max(Number(item?.estimated_quantity || 0), 0);
  const hasValidParentQuantity = parentQuantity > 0;
  const childQuantityPerParent =
    hasValidParentQuantity ? childQuantityTotal / parentQuantity : 0;
  const producedParentQuantity = Math.max(
    Number(parent?.produced_parent_quantity ?? parent?.received_quantity ?? 0),
    0,
  );
  const consumedChildQuantity = Math.max(
    Number(item?.consumed_child_quantity ?? item?.received_quantity ?? 0),
    0,
  );
  const reservedChildQuantity = Math.max(
    Number(item?.reserved_child_quantity ?? item?.reserved_quantity ?? 0),
    0,
  );
  const expectedConsumedForProduced = Math.min(
    childQuantityTotal,
    producedParentQuantity * childQuantityPerParent,
  );
  const effectiveConsumed = Math.max(
    consumedChildQuantity,
    expectedConsumedForProduced,
  );

  return {
    parent,
    parentName: parent?.product_name || "",
    parentQuantity,
    childQuantityTotal,
    childQuantityPerParent,
    hasValidParentQuantity,
    producedParentQuantity,
    remainingParentQuantity: Math.max(
      parentQuantity - producedParentQuantity,
      0,
    ),
    consumedChildQuantity: effectiveConsumed,
    reservedChildQuantity,
    remainingChildQuantity: Math.max(childQuantityTotal - effectiveConsumed, 0),
  };
}

export function parentProcessInfo(parent) {
  const parentQuantity = Math.max(Number(parent?.estimated_quantity || 0), 0);
  const producedParentQuantity = Math.max(
    Number(parent?.produced_parent_quantity ?? parent?.received_quantity ?? 0),
    0,
  );

  return {
    parentQuantity,
    producedParentQuantity,
    remainingParentQuantity: Math.max(
      parentQuantity - producedParentQuantity,
      0,
    ),
  };
}

export function hierarchyQuantityFields(parent, childQuantity = 0) {
  const parentQuantity = Math.max(
    Number(parent?.estimated_quantity || parent?.quantity || 0),
    0,
  );
  const totalChildQuantity = Math.max(Number(childQuantity || 0), 0);

  return {
    parent_name: parent?.product_name || parent?.title || "",
    parent_quantity: parentQuantity,
    child_quantity_total: totalChildQuantity,
    child_quantity_per_parent:
      parentQuantity > 0
        ? totalChildQuantity / parentQuantity
        : 0,
    remaining_parent_quantity: parentQuantity,
    produced_parent_quantity: 0,
    reserved_child_quantity: 0,
    consumed_child_quantity: 0,
  };
}

export function buildComponentConsumptionRows(
  childRows,
  productById,
  processQuantity,
  items = [],
) {
  return childRows
    .map((child) => {
      const relation = componentRelationForItem(child, items);
      const quantityToConsume =
        Number(processQuantity || 0) * relation.childQuantityPerParent;
      const product = productById.get(child.product_id);

      return {
        child,
        relation,
        product,
        quantityToConsume,
        currentStock: Number(product?.current_stock || 0),
      };
    })
    .filter((row) => row.quantityToConsume > 0);
}

const missingStatuses = [
  "Satınalma gerekli",
  "Eksik geldi",
  "Tedarikçiden bekleniyor",
];
const inProgressStatuses = [
  "İşleme alındı",
  "İşlemde",
  "Uygulamada",
];
const completedStatuses = ["Depoda", "Tamamlandı", "Sevk edildi"];

export function mainItemStats(parent, childItemsByParent = {}) {
  const children = childItemsByParent[parent.id] || [];
  const missing = children.filter((item) =>
    missingStatuses.includes(item.status),
  ).length;
  const inProgress = children.filter((item) =>
    inProgressStatuses.includes(item.status),
  ).length;
  const completed = children.filter((item) =>
    completedStatuses.includes(item.status),
  ).length;
  const completion =
    children.length > 0 ? Math.round((completed / children.length) * 100) : 0;

  return { total: children.length, missing, inProgress, completion };
}

export function overviewStatusForMainItem(stats) {
  if (stats.completion >= 100)
    return { text: "Tamamlandı", className: "bg-emerald-100 text-emerald-700" };
  if (stats.missing > 3)
    return { text: "Riskli", className: "bg-red-100 text-red-700" };
  if (stats.missing > 0)
    return { text: "Devam Ediyor", className: "bg-blue-100 text-blue-700" };
  return { text: "İyi", className: "bg-green-100 text-green-700" };
}
