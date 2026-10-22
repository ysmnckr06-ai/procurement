"use client";

import { useEffect, useMemo, useState } from "react";

// Uzun listeleri parça parça gösterir: önce `step` kayıt, "Daha fazla göster" ile
// her seferinde `step` kayıt daha. `resetKey` (ör. arama/filtre) değişince başa döner.
export function useShowMore(items, step = 25, resetKey = "") {
  const [limit, setLimit] = useState(step);
  useEffect(() => {
    setLimit(step);
  }, [resetKey, step]);
  const list = Array.isArray(items) ? items : [];
  const visible = useMemo(() => list.slice(0, limit), [list, limit]);
  return {
    visible,
    total: list.length,
    remaining: Math.max(list.length - limit, 0),
    more: () => setLimit((current) => current + step),
    all: () => setLimit(list.length),
  };
}

export function ShowMoreButton({ pager, step = 25, className = "" }) {
  if (!pager || pager.remaining <= 0) return null;
  return (
    <div className={`flex flex-col items-center gap-2 py-3 sm:flex-row sm:justify-center ${className}`} data-testid="show-more">
      <span className="text-xs font-semibold text-slate-500">
        {pager.visible.length} / {pager.total} kayıt gösteriliyor
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={pager.more}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50"
        >
          {Math.min(step, pager.remaining)} kayıt daha göster
        </button>
        {pager.remaining > step && (
          <button
            type="button"
            onClick={pager.all}
            className="rounded-xl px-3 py-2 text-sm font-bold text-slate-500 hover:text-slate-800"
          >
            Tümünü göster
          </button>
        )}
      </div>
    </div>
  );
}
