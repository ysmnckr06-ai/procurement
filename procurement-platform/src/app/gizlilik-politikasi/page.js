import LegalPageShell from "../legal-page-shell";

const sections = [
  {
    title: "1. İşlenen Veri Türleri",
    items: [
      "Kullanıcı hesabı bilgileri: e-posta, kullanıcı kimliği ve oturum bilgileri.",
      "Şirket ve ayar bilgileri: firma adı, vergi bilgisi, para birimi, kur ve bildirim tercihleri.",
      "Operasyon verileri: projeler, proje kalemleri, talepler, teklifler, siparişler, stok kartları, stok hareketleri, finans kayıtları ve raporlar.",
      "Belgeler: teklif Excel dosyaları, fatura PDF'leri, irsaliyeler, OCR metinleri ve belge eşleşme sonuçları.",
    ],
  },
  {
    title: "2. Verilerin Kullanım Amaçları",
    items: [
      "Satınalma, stok, proje, sipariş ve finans süreçlerini yönetmek.",
      "Fatura/irsaliye/teklif belgelerini analiz etmek ve kullanıcıya eşleşme önerisi sunmak.",
      "Dashboard, rapor ve karar destek özetleri üretmek.",
      "Güvenlik, hata analizi, destek ve yedekleme süreçlerini yürütmek.",
    ],
  },
  {
    title: "3. Saklama ve Altyapı",
    paragraphs: [
      "Uygulama verileri Supabase veritabanı ve Supabase Storage üzerinde saklanabilir. Uygulama arayüzü Vercel üzerinde yayınlanabilir. Backend servisleri Railway veya benzeri güvenli altyapı sağlayıcılarında çalıştırılabilir.",
      "Belgeler herkese açık bağlantı olarak yayınlanmamalıdır. Belge erişimleri kimlik doğrulama, tenant kontrolü ve gerektiğinde süreli signed URL yaklaşımıyla yönetilmelidir.",
    ],
  },
  {
    title: "4. Üçüncü Taraf Hizmetler",
    paragraphs: [
      "OpenAI API anahtarı tanımlanırsa, AI Asistan için özet operasyon verileri OpenAI hizmetine gönderilebilir. Hassas verilerin AI kullanım politikası müşteriyle ayrıca netleştirilmelidir.",
      "OpenAI API anahtarı tanımlı değilse AI Asistan yerel read-only analiz modunda çalışır ve OpenAI'a veri göndermez.",
    ],
  },
  {
    title: "5. Yetki ve Erişim",
    paragraphs: [
      "Kullanıcılar kendi hesaplarına ve tenant verilerine erişir. Service role anahtarları frontend veya public ortam değişkenlerinde tutulmamalıdır.",
      "Müşteri, kullanıcı hesaplarını, şifrelerini ve yetkilendirme süreçlerini kendi şirket politikalarına uygun yönetmelidir.",
    ],
  },
  {
    title: "6. Silme ve Düzeltme Talepleri",
    paragraphs: [
      "Müşteri, kendi verilerinin düzeltilmesini, dışa aktarılmasını veya silinmesini talep edebilir. Silme işlemlerinde yasal saklama yükümlülükleri ve backup süreçleri dikkate alınır.",
    ],
  },
  {
    title: "7. Güvenlik Önlemleri",
    items: [
      "RLS ve kullanıcı/tenant filtreleriyle veri izolasyonu.",
      "Service role anahtarlarının server-side saklanması.",
      "Belge bucket'larının public olmaması.",
      "Düzenli production backup kontrolü.",
      "Kritik işlemlerde kullanıcı onayı ve işlem sonrası kayıt doğrulaması.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPageShell
      title="Gizlilik Politikası"
      description="Bu metin CORVIAN içinde hangi verilerin hangi amaçlarla işlendiğini ve nasıl korunduğunu açıklar."
      updatedAt="27 Haziran 2026"
      sections={sections}
    />
  );
}
