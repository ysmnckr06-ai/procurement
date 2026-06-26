"use client";

import { useMemo, useState } from "react";

const answerHeadings = [
  "Proje Özeti",
  "Stoktan Karşılanabilirler",
  "Satınalma Gerekenler",
  "Maliyet Riski",
  "Önerilen Aksiyon",
];

const promptCards = [
  {
    title: "Satınalma ihtiyacı",
    text: "Bu projede satınalma ihtiyacı nedir?",
    tone: "blue",
  },
  {
    title: "Stok uygunluğu",
    text: "Stoktan karşılanabilecek kalemler hangileri?",
    tone: "emerald",
  },
  {
    title: "Maliyet riski",
    text: "Bu projede maliyet riski var mı?",
    tone: "amber",
  },
  {
    title: "Pahalı kalemler",
    text: "En pahalı kalemler hangileri?",
    tone: "slate",
  },
  {
    title: "Teklif aksiyonu",
    text: "Hangi kalemler için teklif alınmalı?",
    tone: "indigo",
  },
];

const toneClasses = {
  blue: "border-blue-100 bg-blue-50 text-blue-800 hover:bg-blue-100",
  emerald: "border-emerald-100 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
  amber: "border-amber-100 bg-amber-50 text-amber-800 hover:bg-amber-100",
  slate: "border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100",
  indigo: "border-indigo-100 bg-indigo-50 text-indigo-800 hover:bg-indigo-100",
};

function normalizeLine(line) {
  return String(line || "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*•]\s*/, "")
    .trim();
}

function parseAnswer(answer) {
  const text = String(answer || "").trim();
  if (!text) return [];

  const sections = answerHeadings.map((heading, index) => {
    const start = text.indexOf(heading);
    if (start < 0) return { heading, lines: [] };

    const nextStarts = answerHeadings
      .slice(index + 1)
      .map((nextHeading) => text.indexOf(nextHeading, start + heading.length))
      .filter((position) => position >= 0);
    const end = nextStarts.length ? Math.min(...nextStarts) : text.length;
    const body = text.slice(start + heading.length, end);
    const lines = body
      .split("\n")
      .map(normalizeLine)
      .filter(Boolean);

    return { heading, lines };
  });

  const hasStructuredSections = sections.some((section) => section.lines.length > 0);
  if (hasStructuredSections) return sections;

  return [
    {
      heading: "Yanıt",
      lines: text.split("\n").map(normalizeLine).filter(Boolean),
    },
  ];
}

function LoadingAnswer() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
        <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-blue-100" />
        <div className="min-w-0 flex-1">
          <div className="h-4 w-48 animate-pulse rounded bg-slate-200" />
          <div className="mt-2 h-3 w-72 max-w-full animate-pulse rounded bg-slate-100" />
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {answerHeadings.map((heading) => (
          <div key={heading} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div className="h-4 w-36 animate-pulse rounded bg-slate-200" />
            <div className="mt-4 space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-white" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-white" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-white" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyAnswer() {
  return (
    <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
      <div>
        <div className="text-lg font-black text-slate-900">Analiz için hazır</div>
        <p className="mt-2 max-w-xl text-sm font-semibold text-slate-500">
          Proje kodu veya proje adı yazın; asistan stok, eksik miktar, teklif ve sipariş özetlerinden yönetici özeti oluştursun.
        </p>
      </div>
    </div>
  );
}

function AnswerBlock({ answer, loading }) {
  const sections = useMemo(() => parseAnswer(answer), [answer]);

  if (loading) return <LoadingAnswer />;
  if (!answer) return <EmptyAnswer />;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-950">AI Satınalma Yanıtı</h2>
          <p className="mt-1 text-xs font-bold text-slate-500">
            AI Asistan sadece analiz ve öneri üretir, sistem kayıtlarını değiştirmez.
          </p>
        </div>
        <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
          Read-only
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map((section) => (
          <section key={section.heading} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-900">
              {section.heading}
            </h3>
            {section.lines.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {section.lines.map((line, index) => (
                  <li key={`${section.heading}-${index}`} className="flex gap-2 text-sm font-semibold leading-6 text-slate-700">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">
                Bu başlık için net bulgu oluşmadı.
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

export default function AiAssistantPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [matchedProject, setMatchedProject] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function askAssistant(event, nextQuestion = question) {
    event?.preventDefault();
    const trimmedQuestion = String(nextQuestion || "").trim();
    if (!trimmedQuestion || loading) return;

    setQuestion(trimmedQuestion);
    setLoading(true);
    setError("");
    setAnswer("");
    setMatchedProject(null);

    try {
      const response = await fetch("/api/ai/procurement-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmedQuestion }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Analiz alınamadı.");
      }

      setAnswer(payload.answer || "");
      setMatchedProject(payload.matchedProject || null);
    } catch {
      setError("Analiz alınamadı. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-950">AI Satınalma Asistanı</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold text-slate-500">
              Proje, stok, teklif ve sipariş özetlerinden demo için okunabilir satınalma analizi üretir.
            </p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-black leading-5 text-emerald-800">
            AI Asistan sadece analiz ve öneri üretir, sistem kayıtlarını değiştirmez.
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {promptCards.map((card) => (
            <button
              key={card.text}
              type="button"
              disabled={loading}
              onClick={() => askAssistant(null, card.text)}
              className={`min-h-28 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClasses[card.tone]}`}
            >
              <div className="text-xs font-black uppercase tracking-wide opacity-75">
                {card.title}
              </div>
              <div className="mt-2 text-sm font-black leading-5">{card.text}</div>
            </button>
          ))}
        </div>

        <form onSubmit={askAssistant} className="mt-5 space-y-4">
          <label className="block text-sm font-black text-slate-800">
            Sorunuz
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={4}
              maxLength={1200}
              placeholder="Örn: PRJ-00012 projesinde hangi ürünler stoktan karşılanabilir, hangileri satınalma gerektirir?"
              className="mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-white p-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs font-bold text-slate-500">
              Proje kodu veya proje adını soruya eklerseniz asistan ilgili projeyi bulur.
            </div>
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {loading ? "Analiz ediliyor..." : "Analiz Et"}
            </button>
          </div>
        </form>

        {matchedProject && (
          <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            Eşleşen proje: {matchedProject.code || "-"} · {matchedProject.name || "-"}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}
      </section>

      <AnswerBlock answer={answer} loading={loading} />
    </main>
  );
}
