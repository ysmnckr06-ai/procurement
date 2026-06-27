import Link from "next/link";

export default function LegalPageShell({ title, description, updatedAt, sections }) {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <Link href="/" className="text-sm font-bold text-blue-700 hover:text-blue-900">
          CORVIAN ana sayfaya dön
        </Link>

        <div className="mt-6 border-b border-slate-200 pb-6">
          <p className="text-xs font-black uppercase tracking-wide text-blue-700">
            Yasal bilgilendirme
          </p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">{title}</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
            {description}
          </p>
          <p className="mt-3 text-xs font-bold text-slate-500">
            Son güncelleme: {updatedAt}
          </p>
        </div>

        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-black text-slate-950">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm font-semibold leading-7 text-slate-700">
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.items && (
                  <ul className="list-disc space-y-2 pl-5">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
          Bu metin operasyonel bir başlangıç şablonudur. İlk ücretli müşteri öncesi
          şirket bilgileri, veri işleme rolleri ve KVKK yükümlülükleri için hukuk
          danışmanı tarafından gözden geçirilmelidir.
        </div>
      </div>
    </main>
  );
}
