import "./globals.css";

export const metadata = {
  title: "CORVIAN Business Suite",
  description: "CORVIAN Business Suite",
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
