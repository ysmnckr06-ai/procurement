import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                Hoş geldin Yasemin Çakar 👋
              </h1>
              <p className="mt-2 text-slate-600">ysmnckr06@icloud.com</p>
            </div>

            <button className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white">
              Çıkış Yap
            </button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">Talepler</h2>
            <p className="mt-3 text-slate-600">
              Müşteriden veya departmanlardan gelen talepleri yönetin.
            </p>
            <Link
              href="/dashboard/talepler"
              className="mt-5 inline-block text-sm font-medium text-slate-800 hover:underline"
            >
              Bölüme git →
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">Teklifler</h2>
            <p className="mt-3 text-slate-600">
              Tedarikçi tekliflerini toplayın ve karşılaştırın.
            </p>
            <Link
              href="/dashboard/teklifler"
              className="mt-5 inline-block text-sm font-medium text-slate-800 hover:underline"
            >
              Bölüme git →
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">Siparişler</h2>
            <p className="mt-3 text-slate-600">
              Onaylanan tekliflerden sipariş oluşturun.
            </p>
            <Link
              href="/dashboard/siparisler"
              className="mt-5 inline-block text-sm font-medium text-slate-800 hover:underline"
            >
              Bölüme git →
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">Raporlar</h2>
            <p className="mt-3 text-slate-600">
              Satın alma süreçlerini özetleyen raporları görüntüleyin.
            </p>
            <Link
              href="/dashboard/raporlar"
              className="mt-5 inline-block text-sm font-medium text-slate-800 hover:underline"
            >
              Bölüme git →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}