"use client";

import { useMemo, useState } from "react";

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replace(/\s+/g, "");
}

export default function ProductCodeInput({
  value = "",
  onChange,
  onSelect,
  products = [],
  className = "",
  placeholder = "Ürün kodu",
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const suggestions = useMemo(() => {
    const needle = normalizeCode(value);
    if (!needle) return [];
    return (products || [])
      .filter((product) => normalizeCode(product.normalized_product_code || product.product_code).startsWith(needle))
      .sort((left, right) => String(left.product_code || "").localeCompare(String(right.product_code || ""), "tr"))
      .slice(0, 8);
  }, [products, value]);

  return (
    <div className="relative">
      <input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          onChange?.(event.target.value);
          setOpen(true);
        }}
        className={className}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {suggestions.map((product) => (
            <button
              key={product.id || product.product_code}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                onChange?.(product.product_code || "");
                onSelect?.(product);
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-xs font-bold text-slate-900 hover:bg-blue-50"
            >
              <span className="block break-all">{product.product_code || "Kodsuz"}</span>
              <span className="mt-0.5 block font-semibold text-slate-500">
                {[product.product_name, product.brand, product.unit].filter(Boolean).join(" · ") || "Stok kartı"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
