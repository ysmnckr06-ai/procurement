function stripTurkishMarks(value) {
  return String(value || "")
    .replaceAll("İ", "i")
    .replaceAll("I", "i")
    .replaceAll("ı", "i")
    .replaceAll("Ğ", "g")
    .replaceAll("ğ", "g")
    .replaceAll("Ü", "u")
    .replaceAll("ü", "u")
    .replaceAll("Ş", "s")
    .replaceAll("ş", "s")
    .replaceAll("Ö", "o")
    .replaceAll("ö", "o")
    .replaceAll("Ç", "c")
    .replaceAll("ç", "c");
}

export function normalizeProductCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isProjectSeriesCode(value) {
  return /^PRJ-\d{3,}$/i.test(String(value || "").trim());
}

function normalizeMatchProductCode(value) {
  const code = normalizeProductCode(value);
  return isProjectSeriesCode(code) ? "" : code;
}

export function normalizeProductText(value) {
  return stripTurkishMarks(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

export function productTextSimilarity(left, right) {
  const a = normalizeProductText(left);
  const b = normalizeProductText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.65 ? 0.92 : 0.78;
  }
  return Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length));
}

function productIdOf(value) {
  return value?.product_id || value?.productId || value?.id || "";
}

export function scoreProductMatch(candidate, input) {
  const inputLinkedId = input?.product_id || input?.productId;
  if (inputLinkedId && String(candidate?.id) === String(inputLinkedId)) {
    return { product: candidate, type: "exact", score: 1, reason: "product_id" };
  }

  const inputCode = normalizeMatchProductCode(input?.normalized_product_code || input?.product_code || input?.productCode);
  const candidateCode = normalizeMatchProductCode(candidate?.normalized_product_code || candidate?.product_code || candidate?.productCode);
  const inputName = input?.product_name || input?.productName || input?.description || input?.name;
  const candidateName = candidate?.product_name || candidate?.productName || candidate?.description || candidate?.name;
  const nameScore = productTextSimilarity(candidateName, inputName);

  if (inputCode) {
    if (candidateCode === inputCode) {
      if (inputName && candidateName && nameScore < 0.5) {
        return { product: candidate, type: "conflict", score: Math.max(0.5, nameScore), reason: "same_code_different_product" };
      }
      return { product: candidate, type: "exact", score: 1, reason: "normalized_product_code" };
    }

    if (!inputName || !candidateName) return null;
    const inputBrand = input?.brand || "";
    const candidateBrand = candidate?.brand || "";
    const inputUnit = normalizeProductText(input?.unit || "adet");
    const candidateUnit = normalizeProductText(candidate?.unit || "adet");
    const brandScore = inputBrand || candidateBrand ? productTextSimilarity(candidateBrand, inputBrand) : 1;
    const unitScore = inputUnit === candidateUnit ? 1 : 0;
    const score = nameScore * 0.75 + brandScore * 0.15 + unitScore * 0.1;
    return score >= 0.78
      ? { product: candidate, type: "probable", score, reason: "different_code_similar_identity" }
      : null;
  }

  if (!inputName) return null;
  const inputBrand = input?.brand || "";
  const candidateBrand = candidate?.brand || "";
  const inputUnit = normalizeProductText(input?.unit || "adet");
  const candidateUnit = normalizeProductText(candidate?.unit || "adet");
  const brandScore = inputBrand || candidateBrand ? productTextSimilarity(candidateBrand, inputBrand) : 1;
  const unitScore = inputUnit === candidateUnit ? 1 : 0;
  const score = nameScore * 0.72 + brandScore * 0.18 + unitScore * 0.1;
  if (score < 0.62) return null;
  const exactIdentity = nameScore === 1 && brandScore === 1 && unitScore === 1;
  return {
    product: candidate,
    type: exactIdentity ? "exact" : "probable",
    score,
    reason: exactIdentity ? "name_brand_unit" : "similar_name_brand_unit",
  };
}

export function findProductMatches(products, input, { limit = 5 } = {}) {
  return (products || [])
    .map((product) => scoreProductMatch(product, input))
    .filter(Boolean)
    .sort((left, right) => {
      const priority = { conflict: 3, exact: 2, probable: 1 };
      return priority[right.type] - priority[left.type] || right.score - left.score;
    })
    .slice(0, limit);
}

export function matchProduct(products, input) {
  const matches = findProductMatches(products, input);
  const conflicts = matches.filter((match) => match.type === "conflict");
  const exactMatches = matches.filter((match) => match.type === "exact");
  const probableMatches = matches.filter((match) => match.type === "probable");

  if (conflicts.length > 0 || exactMatches.length > 1) {
    return { type: "conflict", match: conflicts[0] || exactMatches[0], suggestions: matches };
  }
  if (exactMatches.length === 1) return { type: "exact", match: exactMatches[0], suggestions: matches };
  if (probableMatches.length > 0) return { type: "probable", match: probableMatches[0], suggestions: matches };
  return { type: "new", match: null, suggestions: [] };
}

export function productMatchLabel(result) {
  if (!result?.match?.product) return "Yeni ürün kartı";
  const product = result.match.product;
  return [product.product_code, product.product_name].filter(Boolean).join(" · ") || String(productIdOf(product));
}
