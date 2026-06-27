import LegalPageShell from "../legal-page-shell";

const sections = [
  {
    title: "1. Hizmetin Kapsamı",
    paragraphs: [
      "CORVIAN Business Suite; proje, satınalma talebi, teklif karşılaştırma, sipariş, stok, belge, finans ve raporlama süreçlerini yönetmek için sunulan bir ERP/SaaS uygulamasıdır.",
      "Uygulama, kullanıcı tarafından girilen veya yüklenen veriler üzerinden operasyonel analiz ve raporlama üretir. Nihai satınalma, ödeme, teslim alma ve muhasebe kararları müşterinin yetkili kullanıcılarına aittir.",
    ],
  },
  {
    title: "2. Kullanıcı Sorumlulukları",
    items: [
      "Kullanıcı, sisteme girdiği şirket, proje, fiyat, stok, fatura, irsaliye ve ödeme bilgilerinin doğruluğundan sorumludur.",
      "Kullanıcı hesap bilgilerinin gizliliği korunmalıdır. Şifre paylaşımı yapılmamalıdır.",
      "Yetkisiz üçüncü kişilere erişim verilmemelidir.",
      "Yüklenen belgelerde kişisel veya ticari gizli veri bulunuyorsa, bu verileri paylaşmaya yetkili olunmalıdır.",
    ],
  },
  {
    title: "3. Belge ve OCR Kullanımı",
    paragraphs: [
      "Fatura, irsaliye ve teklif gibi belgeler sistemde saklanabilir ve OCR/parse işlemleriyle okunabilir. OCR sonuçları yardımcı niteliktedir.",
      "Sistem, belge kalemlerini sipariş veya proje kalemleriyle eşleştirerek öneri üretir. Stok girişi gibi kritik işlemler kullanıcı onayıyla yapılır.",
    ],
  },
  {
    title: "4. AI Asistan Kullanımı",
    paragraphs: [
      "AI Asistan yalnızca analiz ve öneri üretir. Kayıt oluşturma, değiştirme, silme, sipariş verme, stok hareketi oluşturma veya ödeme kaydetme yetkisi yoktur.",
      "OpenAI API anahtarı tanımlı değilse sistem yerel read-only analiz modunda çalışabilir. OpenAI API tanımlandığında daha gelişmiş doğal dil analizi üretilebilir.",
    ],
  },
  {
    title: "5. Veri Güvenliği ve Tenant Ayrımı",
    paragraphs: [
      "Her kullanıcı veya müşteri hesabı kendi verilerine erişecek şekilde tasarlanır. Yetki ve RLS kuralları farklı kullanıcıların birbirinin verisini görmesini engellemek için kullanılır.",
      "Müşteri, kendi kullanıcılarını ve erişim yetkilerini dikkatli yönetmelidir.",
    ],
  },
  {
    title: "6. Sorumluluk Sınırı",
    paragraphs: [
      "CORVIAN, operasyonel karar destek sistemi olarak çalışır. Finansal, vergisel, hukuki veya muhasebesel kararların nihai doğruluğu müşterinin kendi kontrol ve onay süreçlerine bağlıdır.",
      "Sistem çıktıları düzenli olarak müşteri tarafından kontrol edilmelidir.",
    ],
  },
  {
    title: "7. Destek ve İletişim",
    paragraphs: [
      "Kullanıcılar uygulama içindeki Yardım/Kılavuz sayfasını kullanabilir. Teknik destek ve hesap talepleri için hizmet sağlayıcının belirlediği destek kanalları kullanılmalıdır.",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPageShell
      title="Kullanım Şartları"
      description="Bu metin CORVIAN Business Suite uygulamasının kullanım esaslarını, kullanıcı sorumluluklarını ve hizmet kapsamını açıklar."
      updatedAt="27 Haziran 2026"
      sections={sections}
    />
  );
}
