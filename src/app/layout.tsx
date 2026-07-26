import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "FC ONLINE 전적 기반 전술 추천기",
  description: "FC ONLINE 닉네임으로 최근 공식 경기 기록을 조회하는 1차 MVP입니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
