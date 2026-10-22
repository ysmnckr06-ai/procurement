import Link from "next/link";

export const metadata = {
  title: "CORVIAN · Proje bazlı üretim için satınalma, stok ve proje maliyeti",
  description:
    "Proje bazlı çalışan üretim firmaları için: malzeme listesinden teklif mukayesesine, siparişten depo teslimine ve proje kârlılığına kadar tek program. 14 gün ücretsiz deneyin.",
  openGraph: {
    title: "CORVIAN · Proje bazlı üretim için satınalma ve maliyet takibi",
    description:
      "Malzeme listesi → teklif → mukayese → sipariş → teslim → proje maliyeti. Excel dosyaları arasında kaybolmadan.",
    locale: "tr_TR",
    type: "website",
  },
};

const priceLabel = process.env.NEXT_PUBLIC_SUBSCRIPTION_PRICE_LABEL || "Aylık abonelik";

const PAINS = [
  ["Aynı malzeme iki kez sipariş ediliyor", "Depoda olan malzeme görünmediği için yeniden satın alınıyor, proje maliyeti şişiyor."],
  ["Teklif karşılaştırma saatler sürüyor", "Her tedarikçinin Excel'i farklı; fiyat, iskonto, kur ve termin elle yan yana getiriliyor."],
  ["Projenin gerçek maliyeti iş bitince belli oluyor", "Sipariş, ödeme ve kur farkları dağınık; hangi projenin kâr ettiği sonradan anlaşılıyor."],
  ["Kim neyi, ne zaman sipariş etti belli değil", "Termin kaçıyor, teslim alınan malzeme projeye işlenmiyor, takip telefonla yapılıyor."],
];

const FLOW = [
  ["1", "Proje ve malzeme listesi", "Projeyi açın, Excel veya PDF malzeme listesini yükleyin. Stokta olanlar ayrılır, eksikler satınalma talebine dönüşür."],
  ["2", "Talep", "Projeden ya da elle açılan ihtiyaçlar tek havuzda toplanır; teklif toplamaya hazırdır."],
  ["3", "Teklif ve mukayese", "Tedarikçi tekliflerini olduğu gibi yükleyin. Fiyat, iskonto, kur, vade ve termin okunur; mukayese raporu kendiliğinden hazırlanır."],
  ["4", "Sipariş", "Her kalem için en uygun teklif işaretlenir; tek tıkla tedarikçi bazında sipariş oluşur."],
  ["5", "Teslim alma ve stok", "Gelen malzemeyi siparişin içinden teslim alın. Stok ve projeye ayrılan miktar kendiliğinden güncellenir."],
  ["6", "Proje maliyeti ve kâr", "Sözleşme bedeli, siparişler, ödemeler ve kur farkıyla her projenin güncel maliyetini ve tahmini kârını görün."],
];

const FEATURES = [
  ["📄", "Excel ve PDF'ten okuma", "Malzeme listeleri ve tedarikçi teklifleri yeniden yazılmadan sisteme alınır."],
  ["⚖️", "Otomatik mukayese raporu", "Kalem kalem en uygun teklif, toplam tasarruf ve PDF/Excel çıktısı."],
  ["📦", "Stoktan karşılama", "Yeni projenin ihtiyacı önce depodan karşılanır; yalnız eksik olan satın alınır."],
  ["💱", "Döviz ve proje kuru", "Güncel kurlar otomatik gelir; proje kurunu sabitleyip kur farkını izleyin."],
  ["📊", "Proje finansı", "Maliyet, tahsilat, kalan ödeme ve kârlılık tek ekranda."],
  ["🤝", "Tedarikçi performansı", "Termine uyum, fiyat ve geçmiş siparişlerle iş ortaklarınızı karşılaştırın."],
];

const SECTORS = [
  "Makine ve ekipman imalatı",
  "Çelik konstrüksiyon",
  "Elektrik pano ve taahhüt",
  "Mobilya ve dekorasyon projeleri",
  "Endüstriyel tesis ve montaj",
  "Proje bazlı atölyeler",
];

const FAQ = [
  ["Mevcut Excel dosyalarımızı kullanabilir miyiz?", "Evet. Malzeme listeleri, stok kartları ve tedarikçi teklifleri Excel veya PDF olarak yüklenir; baştan yazmanız gerekmez."],
  ["Deneme için kredi kartı gerekiyor mu?", "Hayır. 14 günlük deneme kayıt olur olmaz başlar, kart bilgisi istenmez."],
  ["Önce örnek verilerle görebilir miyim?", "Evet. Boş hesapta tek tıkla örnek proje, teklif ve sipariş verisi yükleyip programı gezebilir, sonra tek tıkla silebilirsiniz."],
  ["Verilerimiz güvende mi?", "Her firmanın verisi ayrı tutulur ve yalnız o firmanın kullanıcıları erişebilir. Kişisel veriler KVKK kapsamında işlenir."],
];

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-[0_8px_24px_rgba(37,99,235,0.35)]">
        <div className="h-5 w-5 rounded-full border-[5px] border-white border-r-transparent" />
      </div>
      <div>
        <div className="text-lg font-black tracking-[0.22em] text-slate-950">CORVIAN</div>
        <div className="-mt-0.5 text-[10px] font-black tracking-[0.3em] text-blue-600">BUSINESS SUITE</div>
      </div>
    </div>
  );
}

function AppPreview() {
  const rows = [
    ["Sac levha 3 mm", "Demir A.Ş.", "₺ 412.500", "En uygun"],
    ["Rulman 6205", "Teknik Ltd.", "€ 1.840", "En uygun"],
    ["Hidrolik silindir", "Akış Hid.", "₺ 96.300", "2. teklif"],
  ];
  return (
    <div className="relative mx-auto w-full max-w-xl" aria-hidden="true">
      <div className="absolute -inset-6 rounded-[36px] bg-blue-500/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
          <span className="ml-3 text-xs font-bold text-slate-500">Mukayese raporu · PRJ-0042 Konveyör hattı</span>
        </div>
        <div className="grid grid-cols-3 gap-2 p-4">
          {[["Teklif", "4 firma"], ["Kalem", "38"], ["Tasarruf", "₺ 61.200"]].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 p-3">
              <div className="text-[11px] font-bold text-slate-500">{k}</div>
              <div className="mt-1 text-sm font-black text-slate-900 sm:text-base">{v}</div>
            </div>
          ))}
        </div>
        <div className="px-4 pb-4">
          <div className="overflow-hidden rounded-xl border border-slate-100">
            {rows.map(([item, firm, price, tag]) => (
              <div key={item} className="grid grid-cols-[1.3fr_1fr_0.9fr_auto] items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-[11px] first:border-t-0 sm:text-xs">
                <span className="truncate font-bold text-slate-800">{item}</span>
                <span className="truncate text-slate-500">{firm}</span>
                <span className="font-black text-slate-900">{price}</span>
                <span className={`rounded-full px-2 py-0.5 font-black ${tag === "En uygun" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{tag}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-blue-600 px-4 py-3 text-xs font-black text-white">
            <span>3 tedarikçiye sipariş oluştur</span>
            <span>→</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm font-bold text-slate-600 md:flex">
            <a href="#nasil" className="hover:text-slate-950">Nasıl çalışır</a>
            <a href="#ozellikler" className="hover:text-slate-950">Özellikler</a>
            <a href="#fiyat" className="hover:text-slate-950">Fiyat</a>
            <a href="#sss" className="hover:text-slate-950">Sorular</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-xl px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-100">Giriş</Link>
            <Link href="/register" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-blue-700">Ücretsiz dene</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden bg-[radial-gradient(circle_at_15%_10%,rgba(37,99,235,0.35),transparent_35%),linear-gradient(135deg,#020617,#0B1220_55%,#0F172A)] text-white">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-24">
            <div>
              <div className="inline-flex rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-200">
                Proje bazlı üretim firmaları için
              </div>
              <h1 className="mt-5 text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
                Satınalma, stok ve proje maliyeti <span className="text-blue-400">tek yerde.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base font-medium leading-7 text-slate-300 sm:text-lg sm:leading-8">
                Malzeme listesinden tedarikçi teklifine, siparişten depo teslimine ve projenin kârına kadar her adım birbirine bağlı. Excel dosyaları arasında kaybolmadan.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/register" className="rounded-xl bg-blue-600 px-6 py-3.5 text-center text-base font-black text-white shadow-[0_14px_30px_rgba(37,99,235,0.35)] hover:bg-blue-500">
                  14 gün ücretsiz deneyin
                </Link>
                <a href="#nasil" className="rounded-xl border border-white/20 px-6 py-3.5 text-center text-base font-black text-white hover:bg-white/10">
                  Nasıl çalışır?
                </a>
              </div>
              <p className="mt-4 text-sm font-semibold text-slate-400">Kredi kartı gerekmez · Örnek verilerle hemen gezin</p>
            </div>
            <AppPreview />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Tanıdık geliyor mu?</h2>
          <p className="mt-3 max-w-2xl text-slate-600">Proje bazlı üretimde para çoğu zaman satınalma ve stokta kaybolur.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {PAINS.map(([title, text]) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                <div className="text-base font-black text-slate-900">✕ {title}</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="nasil" className="scroll-mt-20 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Projenin baştan sona akışı</h2>
            <p className="mt-3 max-w-2xl text-slate-600">Her adım bir öncekinin verisini kullanır; aynı bilgiyi iki kez yazmazsınız.</p>
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {FLOW.map(([n, title, text]) => (
                <div key={n} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-sm font-black text-white">{n}</div>
                  <div className="mt-4 text-lg font-black text-slate-900">{title}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="ozellikler" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 lg:py-20">
          <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Satınalmacının işini kısaltan özellikler</h2>
          <div className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([icon, title, text]) => (
              <div key={title} className="flex gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-xl">{icon}</div>
                <div>
                  <div className="font-black text-slate-900">{title}</div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-slate-950 text-white">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="text-2xl font-black sm:text-3xl">Kimler için?</h2>
            <p className="mt-2 text-slate-400">Her işi bir proje olan, malzemesini projeye göre satın alan firmalar için.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              {SECTORS.map((sector) => (
                <span key={sector} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200">{sector}</span>
              ))}
            </div>
          </div>
        </section>

        <section id="fiyat" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 lg:py-20">
          <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 p-8 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="text-sm font-black uppercase tracking-widest text-blue-600">Fiyat</div>
            <div className="mt-3 text-3xl font-black text-slate-900">{priceLabel}</div>
            <p className="mt-3 text-slate-600">Tüm modüller dahil: projeler, talepler, teklif ve mukayese, siparişler, stok, finans, raporlar.</p>
            <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm font-semibold text-slate-700">
              <li>✓ 14 gün ücretsiz, kredi kartı gerekmez</li>
              <li>✓ Excel ve PDF'ten veri aktarımı</li>
              <li>✓ Destek merkezi üzerinden yardım</li>
              <li>✓ İstediğiniz zaman iptal</li>
            </ul>
            <Link href="/register" className="mt-8 block rounded-xl bg-blue-600 px-6 py-3.5 text-base font-black text-white hover:bg-blue-700">
              Ücretsiz denemeyi başlat
            </Link>
          </div>
        </section>

        <section id="sss" className="scroll-mt-20 bg-slate-50">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-20">
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Sık sorulanlar</h2>
            <div className="mt-8 space-y-3">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group rounded-2xl border border-slate-200 bg-white p-5">
                  <summary className="cursor-pointer list-none font-black text-slate-900">
                    <span className="mr-2 text-blue-600 group-open:hidden">+</span>
                    <span className="mr-2 hidden text-blue-600 group-open:inline">−</span>
                    {q}
                  </summary>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
          <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Bir sonraki projenizi CORVIAN&apos;da açın.</h2>
          <p className="mt-3 text-slate-600">Örnek verilerle 5 dakikada gezin, kendi malzeme listenizle deneyin.</p>
          <Link href="/register" className="mt-8 inline-block rounded-xl bg-blue-600 px-8 py-4 text-base font-black text-white shadow-[0_14px_30px_rgba(37,99,235,0.3)] hover:bg-blue-700">
            14 gün ücretsiz deneyin
          </Link>
        </section>
      </main>

      <footer className="border-t border-slate-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© 2026 Corvian Business Suite</span>
          <div className="flex flex-wrap gap-5 font-semibold">
            <Link href="/kvkk" className="hover:text-slate-900">KVKK</Link>
            <Link href="/gizlilik-politikasi" className="hover:text-slate-900">Gizlilik</Link>
            <Link href="/kullanim-sartlari" className="hover:text-slate-900">Kullanım şartları</Link>
            <Link href="/login" className="hover:text-slate-900">Giriş</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
