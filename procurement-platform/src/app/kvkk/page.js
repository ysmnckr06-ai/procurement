import LegalPageShell from "../legal-page-shell";

const sections = [
  {
    title: "1. Veri Sorumlusu ve Veri İşleyen Rolleri",
    paragraphs: [
      "CORVIAN kullanımında müşteri şirket, kendi çalışanları ve iş süreçlerine ait kişisel veriler açısından veri sorumlusu olabilir. CORVIAN hizmet sağlayıcısı, müşteri adına uygulama altyapısını işleten veri işleyen konumunda olabilir.",
      "Gerçek rol dağılımı müşteri sözleşmesi ve hizmet modeline göre ayrıca düzenlenmelidir.",
    ],
  },
  {
    title: "2. İşlenen Kişisel Veri Kategorileri",
    items: [
      "Kullanıcı e-posta adresi ve oturum bilgileri.",
      "İş ortağı yetkili kişi adı, telefon, e-posta ve adres bilgileri.",
      "Fatura, irsaliye, teklif veya proje belgelerinde yer alabilecek kişisel veriler.",
      "Destek, hata ve işlem kayıtlarında yer alabilecek teknik bilgiler.",
    ],
  },
  {
    title: "3. İşleme Amaçları",
    items: [
      "ERP/SaaS hizmetinin sunulması.",
      "Satınalma, stok, proje, finans ve belge yönetimi süreçlerinin yürütülmesi.",
      "Müşteri destek, güvenlik, yedekleme ve hata giderme faaliyetleri.",
      "Yasal yükümlülüklerin yerine getirilmesi.",
    ],
  },
  {
    title: "4. Aktarım ve Altyapı",
    paragraphs: [
      "Veriler, uygulamanın çalışması için Supabase, Vercel, Railway ve gerektiğinde OpenAI gibi altyapı veya API sağlayıcıları üzerinde işlenebilir.",
      "OpenAI entegrasyonu kullanılacaksa, hangi verilerin gönderileceği müşteriyle açıkça belirlenmeli ve gerekli onay/metinler tamamlanmalıdır.",
    ],
  },
  {
    title: "5. Saklama Süresi",
    paragraphs: [
      "Veriler, hizmet ilişkisi sürdüğü müddetçe ve yasal saklama yükümlülükleri kapsamında saklanabilir. Müşteri talebiyle silme veya anonimleştirme süreçleri ayrıca yürütülür.",
    ],
  },
  {
    title: "6. İlgili Kişi Hakları",
    items: [
      "Kişisel verisinin işlenip işlenmediğini öğrenme.",
      "İşlenmişse buna ilişkin bilgi talep etme.",
      "Eksik veya yanlış işlenmiş verilerin düzeltilmesini isteme.",
      "KVKK kapsamında silme veya yok etme talep etme.",
      "Aktarım yapılan üçüncü kişileri öğrenme.",
      "Kanunda belirtilen diğer hakları kullanma.",
    ],
  },
  {
    title: "7. Başvuru",
    paragraphs: [
      "KVKK kapsamındaki başvurular müşteri şirketin belirlediği veri sorumlusu iletişim kanalı veya hizmet sağlayıcının destek adresi üzerinden alınmalıdır. Canlı kullanıma geçmeden önce bu iletişim adresi şirket bilgileriyle güncellenmelidir.",
    ],
  },
];

export default function KvkkPage() {
  return (
    <LegalPageShell
      title="KVKK Aydınlatma Metni"
      description="Bu metin CORVIAN kullanımı sırasında kişisel verilerin işlenmesine ilişkin temel bilgilendirme şablonudur."
      updatedAt="27 Haziran 2026"
      sections={sections}
    />
  );
}
