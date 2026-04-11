import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl bg-white shadow-md rounded-2xl p-10 text-center">
        <h1 className="text-4xl font-bold text-slate-800">
          Tedarik Platformu
        </h1>

        <p className="mt-4 text-slate-600 text-lg">
          Satın alma analiz ve raporlama sistemine hoş geldiniz.
        </p>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/login"
            className="bg-slate-800 text-white p-4 rounded-xl text-center hover:bg-slate-700"
          >
            Giriş Yap
          </Link>

          <Link
            href="/register"
            className="bg-slate-800 text-white p-4 rounded-xl text-center hover:bg-slate-700"
          >
            Kayıt Ol
          </Link>
        </div>
      </div>
    </main>
  );
}