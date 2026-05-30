import "./globals.css";

export const metadata = {
  title: "Satınalma Yönetim Sistemi",
  description: "Satınalma talep, teklif, rapor ve sipariş yönetimi",
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
