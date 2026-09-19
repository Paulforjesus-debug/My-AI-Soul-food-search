import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "mise — 개인 맛집 탐색",
  description: "출처와 확인일을 보여주는 개인용 글로벌 맛집 탐색 도구",
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
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
