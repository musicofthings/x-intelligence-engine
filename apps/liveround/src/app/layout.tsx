import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Figtree, Newsreader } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "LiveRound — sit down, join the conversation",
  description:
    "A 15-minute lightning round for X and Reddit. Matching posts stream in. A reply is drafted in your voice. You press send. We never do.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${newsreader.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-chrome text-ink font-sans">
        {children}
        <Toaster
          theme="dark"
          toastOptions={{
            className: "bg-chrome-2 text-ink border border-line",
          }}
        />
      </body>
    </html>
  );
}
