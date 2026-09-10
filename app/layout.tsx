import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Материальный учёт",
  description: "Реестр основных средств, сверка бухгалтерских файлов и учёт выдачи",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
