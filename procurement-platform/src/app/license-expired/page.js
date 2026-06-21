import LicenseExpiredActions from "./LicenseExpiredActions";

export const metadata = {
  title: "Lisans Süresi Doldu | CORVIAN",
};

export default function LicenseExpiredPage() {
  const email =
    process.env.NEXT_PUBLIC_LICENSE_CONTACT_EMAIL || "destek@corvian.com";
  const whatsapp =
    process.env.NEXT_PUBLIC_LICENSE_CONTACT_WHATSAPP || "Satış ekibi";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <section className="w-full max-w-xl rounded-3xl bg-white p-8 text-center shadow-2xl sm:p-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-3xl">
          ⏳
        </div>
        <p className="mt-6 text-sm font-black uppercase tracking-[0.2em] text-blue-600">
          CORVIAN Business Suite
        </p>
        <h1 className="mt-3 text-3xl font-black text-slate-950 sm:text-4xl">
          Demo süreniz sona erdi
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          Kullanıma devam etmek için bizimle iletişime geçin. Verileriniz
          korunmaya devam eder; lisansınız etkinleştirildiğinde kaldığınız
          yerden çalışabilirsiniz.
        </p>
        <LicenseExpiredActions email={email} whatsapp={whatsapp} />
      </section>
    </main>
  );
}
