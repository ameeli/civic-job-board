import type { Metadata, Viewport } from "next";
import { Fraunces, Public_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces" });
const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
});

export const metadata: Metadata = {
  title: "Civic Job Board",
  description:
    "One inbox for civic tech and tech-for-good jobs from job boards and newsletters.",
};

export const viewport: Viewport = {
  themeColor: "#f4efe5",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${publicSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
