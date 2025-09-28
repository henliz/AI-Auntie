// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { Montserrat, Playfair_Display } from "next/font/google";

export const metadata: Metadata = { title: "Auntie", description: "Hackathon demo" };

const mont = Montserrat({ subsets: ["latin"], variable: "--font-sans" });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-serif" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${mont.variable} ${playfair.variable}`} style={{ fontFamily: "var(--font-sans)" }}>
        {children}
      </body>
    </html>
  );
}

