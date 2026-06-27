import Link from "next/link";

const quickStart = [
  {
    title: "1. Firma ayarlarını yapın",
    text: "Ayarlar ekranında şirket adı, vergi bilgisi, baz para birimi, kur ve varsayılan vade değerlerini kaydedin.",
    href: "/dashboard/ayarlar",
  },
  {
    title: "2. İş ortaklarını ekleyin",
    text: "Müşteri ve tedarikçileri İş Ortakları ekranında oluşturun. Aynı tenant içinde aynı firma adının tekrar açılması engellenir.",
    href: "/dashboard/tedarikciler",
  },
  {
    title: "3. Stok kartlarını hazırlayın",
    text: "Ürün kodu, ürün adı, birim, mevcut stok, kritik stok ve son fiyat bilgilerini girin.",
    href: "/dashboard/stok",
  },
  {
    title: "4. Proje açın",
    text: "Müşteri, sözleşme tutarı, tahmini bütçe ve proje kalemleriyle projenizi başlatın.",
    href: "/dashboard/projeler",
  },
  {
    title: "5. Talep ve teklif sürecini yürütün",
    text: "Eksik kalemleri talebe alın, tedarikçi tekliflerini yükleyin ve mukayese raporuyla en uygun teklifi seçin.",
    href: "/dashboard/teklifler",
  },
  {
    title: "6. Sipariş, belge ve teslimi takip edin",
    text: "Sipariş oluşturun, fatura/irsaliye belgelerini bağlayın, OCR eşleşmelerini kontrol edin ve güvenli önerileri onaylayarak teslim alın.",
    href: "/dashboard/siparisler",
  },
];

const workflows = [
  {
    title: "Satınalma akışı",
    steps: [
      "Proje kalemlerini oluşturun.",
      "Stoktan karşılanan ve satınalma gereken miktarları kontrol edin.",
      "Talep oluşturun.",
      "Teklif dosyalarını yükleyin.",
      "Mukayese raporunda fiyat, vade, termin ve riskleri karşılaştırın.",
      "Seçilen tekliften sipariş oluşturun.",
    ],
  },
  {
    title: "Teslim alma ve belge akışı",
    steps: [
      "Sipariş detayına girin.",
      "Belgeler sekmesinden irsaliye veya fatura PDF'ini yükleyin.",
      "OCR analizini çalıştırın veya mevcut OCR kalemlerini kontrol edin.",
      "Otomatik Teslim Alma Önerileri bölümünde güven skoru yüksek eşleşmeleri inceleyin.",
      "Otomatik Teslim Al butonuyla kullanıcı onayı verin.",
      "Order receipts, stock movements, ürün stoğu ve proje kalemi teslim durumunu kontrol edin.",
    ],
  },
  {
    title: "Finans ve raporlama akışı",
    steps: [
      "Sipariş ödemelerini sipariş detayından girin.",
      "Müşteri tahsilatlarını proje detayından ekleyin.",
      "Ek giderleri proje detayından kaydedin.",
      "Finans ekranında sözleşme, tahsilat, tedarikçi borcu ve kâr/zarar özetlerini izleyin.",
      "Dashboard üzerinde açık iş, geciken sipariş, kritik stok ve ödeme uyarılarını kontrol edin.",
    ],
  },
];

const faq = [
  {
    question: "Fatura veya irsaliye yükleyince stok otomatik artar mı?",
    answer:
      "Hayır. Sistem önce OCR kalemlerini sipariş satırlarıyla eşleştirir ve öneri üretir. Stok girişi yalnızca kullanıcı Otomatik Teslim Al ile onay verirse işlenir.",
  },
  {
    question: "AI Asistan veri değiştirir mi?",
    answer:
      "Hayır. AI Asistan read-only çalışır. Analiz ve öneri üretir; sipariş, stok, ödeme veya proje kaydı oluşturmaz, silmez ya da güncellemez.",
  },
  {
    question: "Fatura toplamı siparişten farklıysa ne olur?",
    answer:
      "Sipariş detayındaki Fatura Kontrolü bölümü sipariş toplamı, fatura toplamı, fark ve fark yüzdesini gösterir. Fark varsa manuel inceleme yapılmalıdır.",
  },
  {
    question: "Başka kullanıcı benim verimi görebilir mi?",
    answer:
      "Sistem tenant/user_id ayrımı ve RLS kurallarıyla çalışır. Her kullanıcı yalnızca kendi yetkili olduğu verileri görmelidir.",
  },
  {
    question: "Yanlış teslim aldım, ne yapmalıyım?",
    answer:
      "Sipariş detayında teslimat kayıtlarını ve stok hareketlerini kontrol edin. Kritik düzeltmelerde önce mevcut kayıtları dışa aktarın veya destek ekibinden yardım alın.",
  },
];

export default function HelpPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-wide text-blue-700">
          Kullanım kılavuzu
        </p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">
          CORVIAN Yardım Merkezi
        </h1>
        <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
          Bu sayfa, yeni bir kullanıcının sistemi baştan sona kullanabilmesi için
          hazırlanmıştır. Takıldığınızda önce ilgili akışı buradan kontrol edin.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {quickStart.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md"
          >
            <h2 className="text-base font-black text-slate-950">{item.title}</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {item.text}
            </p>
            <span className="mt-4 inline-block text-sm font-black text-blue-700">
              Ekrana git
            </span>
          </Link>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-black text-slate-950">Temel İş Akışları</h2>
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          {workflows.map((workflow) => (
            <div key={workflow.title} className="rounded-xl border border-slate-100 bg-slate-50 p-5">
              <h3 className="text-base font-black text-slate-900">{workflow.title}</h3>
              <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm font-semibold leading-6 text-slate-700">
                {workflow.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-black text-slate-950">Sık Sorulan Sorular</h2>
        <div className="mt-5 divide-y divide-slate-100">
          {faq.map((item) => (
            <div key={item.question} className="py-4">
              <h3 className="text-base font-black text-slate-900">{item.question}</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                {item.answer}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-blue-100 bg-blue-50 p-6 text-sm font-semibold leading-6 text-blue-950">
        <h2 className="text-lg font-black">Destek öncesi kontrol listesi</h2>
        <p className="mt-2">
          Destek talebi açmadan önce ilgili proje kodunu, sipariş numarasını,
          yüklenen belge adını ve ekranda görünen hata mesajını not edin. Bu bilgiler
          destek süresini ciddi şekilde kısaltır.
        </p>
      </section>
    </main>
  );
}
