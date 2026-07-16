"use client";

import Link from "next/link";

function CorvianMark() {
  return (
    <div className="flex items-center gap-4">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-400/30 bg-blue-500/10 shadow-[0_0_45px_rgba(37,99,235,0.35)]">
        <div className="absolute inset-2 rounded-xl border border-blue-300/30" />
        <div className="h-8 w-8 rounded-full border-[7px] border-blue-400 border-r-transparent" />
      </div>
      <div>
        <div className="text-2xl font-black tracking-[0.28em] text-white">CORVIAN</div>
        <div className="mt-1 text-xs font-black tracking-[0.34em] text-blue-400">BUSINESS SUITE</div>
      </div>
    </div>
  );
}

function NetworkPattern() {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-y-0 right-0 h-full w-2/3 opacity-45"
      viewBox="0 0 520 760"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
    >
      <path d="M78 125L183 210L301 152L440 268L360 430L210 374L92 502L245 620L418 545" stroke="#2563EB" strokeOpacity="0.34" />
      <path d="M183 210L210 374L360 430M301 152L210 374M92 502L360 430M245 620L360 430" stroke="#38BDF8" strokeOpacity="0.18" />
      {[78, 183, 301, 440, 360, 210, 92, 245, 418].map((x, index) => {
        const y = [125, 210, 152, 268, 430, 374, 502, 620, 545][index];
        return <circle key={`${x}-${y}`} cx={x} cy={y} r="4" fill="#2563EB" />;
      })}
      <path d="M384 84C425 169 438 236 425 286C413 336 369 375 293 404C338 322 368 215 384 84Z" fill="url(#panelGlow)" opacity="0.28" />
      <path d="M420 126C455 203 464 264 447 309C430 355 390 388 328 409C365 324 396 230 420 126Z" fill="url(#panelGlow)" opacity="0.18" />
      <defs>
        <linearGradient id="panelGlow" x1="344" y1="84" x2="426" y2="424" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E0F2FE" />
          <stop offset="1" stopColor="#2563EB" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function FeatureIcon({ type }) {
  const common = "h-5 w-5";
  if (type === "report") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="M8 16v-5" />
        <path d="M12 16V8" />
        <path d="M16 16v-3" />
      </svg>
    );
  }
  if (type === "secure") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3l7 3v5c0 4.4-2.8 8.3-7 10-4.2-1.7-7-5.6-7-10V6l7-3Z" />
        <path d="M9 12l2 2 4-5" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
      <path d="M8 5v4" />
      <path d="M15 10v4" />
      <path d="M11 15v4" />
    </svg>
  );
}

function BrandPanel() {
  const features = [
    {
      icon: "report",
      title: "Akıllı Raporlama",
      text: "Verilerinizi anlık takip edin, doğru kararlar alın.",
    },
    {
      icon: "secure",
      title: "Güvenli Altyapı",
      text: "Verilerinizi yüksek güvenlik standartlarıyla koruyun.",
    },
    {
      icon: "manage",
      title: "Merkezi Yönetim",
      text: "Tüm iş süreçlerinizi tek yerden kolayca yönetin.",
    },
  ];

  return (
    <aside className="relative overflow-hidden bg-[radial-gradient(circle_at_10%_20%,rgba(37,99,235,0.28),transparent_28%),linear-gradient(135deg,#020617,#0B1220_48%,#0F172A)] p-6 text-white sm:p-8 lg:p-14">
      <NetworkPattern />
      <div className="relative z-10 flex min-h-[340px] flex-col sm:min-h-[520px] lg:min-h-[680px]">
        <CorvianMark />

        <div className="mt-10 max-w-xl sm:mt-16 lg:mt-24">
          <h1 className="text-3xl font-black leading-tight tracking-normal text-white sm:text-4xl lg:text-5xl">
            İş süreçlerinizi
            <br />
            <span className="text-blue-400">tek platformda</span> yönetin.
          </h1>
          <p className="mt-4 max-w-lg text-sm font-semibold leading-7 text-slate-200 sm:mt-6 sm:text-base sm:leading-8">
            Projelerden tekliflere, stoktan finansa tüm iş akışlarınızı tek ekranda, güvenli ve verimli şekilde yönetin.
          </p>
          <div className="mt-6 h-0.5 w-16 bg-blue-500 sm:mt-8" />
        </div>

        <div className="mt-12 hidden gap-5 sm:grid md:grid-cols-3 lg:mt-auto">
          {features.map((feature) => (
            <div key={feature.title} className="border-white/10 md:border-l md:pl-6">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-blue-400/60 bg-blue-500/10 text-blue-300">
                <FeatureIcon type={feature.icon} />
              </div>
              <div className="text-sm font-black text-white">{feature.title}</div>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-300">{feature.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 hidden text-xs font-semibold text-slate-400 sm:block lg:mt-10">
          © 2026 Corvian Business Suite. Tüm hakları saklıdır.
        </div>
      </div>
    </aside>
  );
}

export function AuthShell({ children }) {
  return (
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-48px)] max-w-7xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.12)] lg:grid-cols-2">
        <BrandPanel />
        <section className="flex items-center justify-center bg-white px-5 py-10 sm:px-8 lg:px-14">
          <div className="w-full max-w-xl">{children}</div>
        </section>
      </div>
    </main>
  );
}

export function AuthCard({ title, description, children, footerHref, footerPrompt, footerLabel }) {
  return (
    <div className="rounded-[22px] border border-slate-100 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.10)] sm:p-8 lg:p-10">
      <div className="text-center">
        <h2 className="text-3xl font-black tracking-normal text-slate-950">{title}</h2>
        <p className="mt-3 text-sm font-semibold text-slate-500">{description}</p>
      </div>
      {children}
      {footerHref && (
        <p className="mt-7 text-center text-sm font-semibold text-slate-600">
          {footerPrompt}{" "}
          <Link href={footerHref} className="font-black text-blue-700 hover:text-blue-800">
            {footerLabel}
          </Link>
        </p>
      )}
    </div>
  );
}

export function AuthInput({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required = false,
  autoComplete,
  icon,
  rightElement,
  inputMode,
  maxLength,
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <div className="flex h-[52px] items-center rounded-xl border border-[#DDE3EA] bg-white px-4 shadow-sm transition focus-within:border-blue-600 focus-within:ring-4 focus-within:ring-blue-100">
        {icon && <span className="mr-3 text-slate-500">{icon}</span>}
        <input
          id={id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
          inputMode={inputMode}
          maxLength={maxLength}
          className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-400"
        />
        {rightElement}
      </div>
    </label>
  );
}

export function AuthButton({ loading, loadingText, children }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="group relative flex h-[52px] w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-5 text-sm font-black text-white shadow-[0_14px_24px_rgba(37,99,235,0.25)] transition hover:from-blue-500 hover:to-blue-700 disabled:cursor-not-allowed disabled:from-slate-400 disabled:to-slate-500"
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          {loadingText}
        </span>
      ) : (
        <>
          <span>{children}</span>
          <span className="absolute right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-blue-700 transition group-hover:translate-x-0.5">
            →
          </span>
        </>
      )}
    </button>
  );
}

export function FieldIcon({ type }) {
  if (type === "lock") {
    return (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V8a4 4 0 0 1 8 0v2" />
      </svg>
    );
  }
  if (type === "user") {
    return (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M20 21a8 8 0 0 0-16 0" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    );
  }
  if (type === "building") {
    return (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 21V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v15" />
        <path d="M16 9h2a2 2 0 0 1 2 2v10" />
        <path d="M8 8h4M8 12h4M8 16h4" />
      </svg>
    );
  }
  if (type === "eye") {
    return (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (type === "eye-off") {
    return (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 3l18 18" />
        <path d="M10.6 10.6A2 2 0 0 0 13.4 13.4" />
        <path d="M9.5 5.3A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-3.1 4.1" />
        <path d="M6.6 6.7C3.6 8.7 2 12 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.1-.8" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6h16v12H4z" />
      <path d="M4 7l8 6 8-6" />
    </svg>
  );
}
