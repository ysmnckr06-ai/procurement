"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// İlk girişte kullanıcıya satınalma akışını adım adım, ilgili ekranı oklarla
// göstererek anlatan tanıtım turu. Bitirildiğinde kullanıcı profiline işlenir;
// sol menüdeki "Tanıtım turu" ile istenildiği zaman yeniden başlatılabilir.

export const TOUR_START_EVENT = "corvian:start-tour";
const TOUR_VERSION = 1;

const steps = [
  {
    title: "CORVIAN'a hoş geldiniz 👋",
    text: "Bir dakikada temel akışı gösterelim: proje → malzeme listesi → teklif → mukayese → sipariş. Her adımda ok ile nereye tıklayacağınızı göstereceğiz.",
  },
  {
    path: "/dashboard/tedarikciler",
    target: "menu:/dashboard/tedarikciler",
    title: "1. İş Ortakları",
    text: "Müşteri ve tedarikçileriniz burada tutulur. Önceden girmek zorunda değilsiniz: proje veya sipariş açarken firma adını yazmanız yeterli, kart otomatik oluşur.",
  },
  {
    path: "/dashboard/projeler",
    target: "yeni-proje",
    fallbackTarget: "menu:/dashboard/projeler",
    title: "2. Proje oluşturun",
    text: "\"Yeni Proje\" ile başlayın. Proje adı, müşteri, sorumlu ve tarihler yeterli; sözleşme bedeli girerseniz kârlılık otomatik hesaplanır.",
  },
  {
    path: "/dashboard/projeler",
    target: "menu:/dashboard/projeler",
    title: "3. Malzeme listesini yükleyin",
    text: "Projeyi açın → \"Malzeme Listesi\" sekmesinde Excel/PDF listenizi yükleyip \"Projeye Aktar\"a basın. Sistem stokta olanları ayırır, eksikleri satınalma talebine dönüştürür.",
  },
  {
    path: "/dashboard/talepler",
    target: "menu:/dashboard/talepler",
    title: "4. Talepler",
    text: "Projeden ya da elle açılan satınalma ihtiyaçları burada toplanır. Oluşturulduğu anda teklif toplamaya hazırdır; ek onay adımı yoktur.",
  },
  {
    path: "/dashboard/teklifler",
    target: "teklif-yukle",
    fallbackTarget: "menu:/dashboard/teklifler",
    title: "5. Teklifleri yükleyin",
    text: "Talebi seçin, tedarikçilerden gelen Excel/PDF teklif dosyalarını buraya bırakın. Fiyat, iskonto, kur, vade ve termin okunup mukayese raporu otomatik hazırlanır.",
  },
  {
    path: "/dashboard/raporlar",
    target: "menu:/dashboard/raporlar",
    title: "6. Mukayese ve sipariş",
    text: "Raporda her kalem için en uygun teklif işaretlenir. Seçimleri kontrol edip tek tıkla tedarikçi bazında sipariş oluşturursunuz.",
  },
  {
    path: "/dashboard/siparisler",
    target: "menu:/dashboard/siparisler",
    title: "7. Teslim alma ve ödeme",
    text: "Siparişin içinden gelen malzemeyi teslim alın ve ödemeleri girin. Stok ve proje maliyeti kendiliğinden güncellenir.",
  },
  {
    path: "/dashboard/finans",
    target: "menu:/dashboard/finans",
    title: "8. Finans",
    text: "Tüm projelerin maliyet, ödeme ve tahmini kâr durumunu tek ekranda izleyin.",
  },
  {
    title: "Hazırsınız 🎉",
    text: "İlk projenizi oluşturarak başlayabilirsiniz. Bu turu istediğiniz zaman sol menünün altındaki \"Tanıtım turu\" ile yeniden açabilirsiniz. Takıldığınız yerde Destek Merkezi'nden bize yazın.",
  },
];

function storageKey(userId) {
  return `corvian_tour_v${TOUR_VERSION}_${userId}`;
}

function readStored(userId) {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey(userId)) || "null");
  } catch {
    return null;
  }
}

function writeStored(userId, value) {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(value));
  } catch {
    // Depolama kapalıysa tur yine çalışır, yalnızca ilerleme hatırlanmaz.
  }
}

function findVisibleTarget(name) {
  if (!name || typeof document === "undefined") return null;
  const nodes = document.querySelectorAll(`[data-tour="${name}"]`);
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return node;
  }
  return null;
}

export default function OnboardingTour() {
  const router = useRouter();
  const pathname = usePathname();
  const [userId, setUserId] = useState("");
  const [stepIndex, setStepIndex] = useState(-1);
  const [rect, setRect] = useState(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const step = stepIndex >= 0 ? steps[stepIndex] : null;

  // Turun daha önce bitirilip bitirilmediğini kontrol et.
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      const user = data?.user;
      if (!mounted || !user) return;
      setUserId(user.id);
      const stored = readStored(user.id);
      const finished = stored?.done || Number(user.user_metadata?.onboarding_tour_version || 0) >= TOUR_VERSION;
      if (!finished) setStepIndex(Number.isInteger(stored?.step) ? stored.step : 0);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Menüdeki "Tanıtım turu" butonu turu baştan başlatır.
  useEffect(() => {
    function start() {
      setStepIndex(0);
    }
    window.addEventListener(TOUR_START_EVENT, start);
    return () => window.removeEventListener(TOUR_START_EVENT, start);
  }, []);

  useEffect(() => {
    if (userId && stepIndex >= 0) writeStored(userId, { step: stepIndex, done: false });
  }, [userId, stepIndex]);

  // Adımın ekranı farklıysa oraya git.
  useEffect(() => {
    if (step?.path && pathname !== step.path) router.push(step.path);
  }, [step, pathname, router]);

  // Hedef öğenin konumunu izle (sayfa yüklenirken birkaç kez dener).
  useLayoutEffect(() => {
    if (!step) return undefined;
    let frame = 0;
    let attempts = 0;
    let timer = null;

    function measure() {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      const node = findVisibleTarget(step.target) || findVisibleTarget(step.fallbackTarget);
      if (node) {
        const box = node.getBoundingClientRect();
        if (box.top < 80 || box.bottom > window.innerHeight - 80) {
          node.scrollIntoView({ block: "center", behavior: "instant" });
        }
        const next = node.getBoundingClientRect();
        setRect({ top: next.top, left: next.left, width: next.width, height: next.height });
      } else {
        setRect(null);
        if (attempts < 20 && step.target) {
          attempts += 1;
          timer = window.setTimeout(() => {
            frame = window.requestAnimationFrame(measure);
          }, 250);
        }
      }
    }

    frame = window.requestAnimationFrame(measure);
    const onResize = () => {
      attempts = 20;
      measure();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [step, pathname]);

  const finish = useCallback(async () => {
    setStepIndex(-1);
    setRect(null);
    if (!userId) return;
    writeStored(userId, { step: 0, done: true });
    try {
      await supabase.auth.updateUser({ data: { onboarding_tour_version: TOUR_VERSION } });
    } catch {
      // Profil güncellenemezse yerel kayıt yeterli.
    }
  }, [userId]);

  if (!step) return null;

  const isLast = stepIndex === steps.length - 1;
  const pad = 8;
  const cardWidth = Math.min(360, Math.max(viewport.width - 32, 260));

  // Kartı hedefin sağına (menü için) ya da altına/üstüne yerleştir.
  let cardStyle = { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: cardWidth };
  let arrow = null;
  if (rect && viewport.width) {
    const spaceRight = viewport.width - (rect.left + rect.width);
    if (spaceRight > cardWidth + 40 && rect.left < viewport.width / 2) {
      const top = Math.min(Math.max(rect.top + rect.height / 2 - 90, 16), viewport.height - 260);
      cardStyle = { left: rect.left + rect.width + 28, top, width: cardWidth };
      arrow = { side: "left", top: rect.top + rect.height / 2 - top - 10 };
    } else {
      const below = rect.top + rect.height + 28;
      const left = Math.min(Math.max(rect.left + rect.width / 2 - cardWidth / 2, 16), viewport.width - cardWidth - 16);
      if (below + 240 < viewport.height) {
        cardStyle = { left, top: below, width: cardWidth };
        arrow = { side: "top", left: rect.left + rect.width / 2 - left - 10 };
      } else {
        cardStyle = { left, top: Math.max(rect.top - 268, 16), width: cardWidth };
        arrow = { side: "bottom", left: rect.left + rect.width / 2 - left - 10 };
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Tanıtım turu">
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-2xl ring-4 ring-amber-400 transition-all duration-200"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.55)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-slate-950/55" />
      )}

      <div className="fixed rounded-2xl bg-white p-5 shadow-2xl" style={cardStyle}>
        {arrow?.side === "left" && (
          <span className="absolute -left-3 h-0 w-0 border-y-[10px] border-r-[12px] border-y-transparent border-r-white" style={{ top: Math.max(arrow.top, 12) }} />
        )}
        {arrow?.side === "top" && (
          <span className="absolute -top-3 h-0 w-0 border-x-[10px] border-b-[12px] border-x-transparent border-b-white" style={{ left: Math.max(arrow.left, 12) }} />
        )}
        {arrow?.side === "bottom" && (
          <span className="absolute -bottom-3 h-0 w-0 border-x-[10px] border-t-[12px] border-x-transparent border-t-white" style={{ left: Math.max(arrow.left, 12) }} />
        )}
        {rect && arrow?.side === "left" && (
          <span className="absolute -left-12 animate-pulse text-2xl text-amber-400" style={{ top: Math.max(arrow.top - 6, 6) }} aria-hidden="true">⬅</span>
        )}
        <div className="text-xs font-black uppercase tracking-wider text-blue-700">
          Adım {stepIndex + 1} / {steps.length}
        </div>
        <h2 className="mt-1 text-lg font-black text-slate-950">{step.title}</h2>
        <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{step.text}</p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          {isLast ? <span /> : (
            <button type="button" onClick={finish} className="rounded-lg px-2 py-2 text-xs font-bold text-slate-500 hover:text-slate-800">
              Turu atla
            </button>
          )}
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button type="button" onClick={() => setStepIndex((current) => Math.max(current - 1, 0))} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                Geri
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? finish() : setStepIndex((current) => current + 1))}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700"
              autoFocus
            >
              {isLast ? "Başlayalım" : stepIndex === 0 ? "Turu başlat" : "İleri"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
