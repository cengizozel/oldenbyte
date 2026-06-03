import type { Metadata } from "next";
import { Playfair_Display, DM_Mono } from "next/font/google";
import Script from "next/script";
import ThemeHotkey from "@/components/ThemeHotkey";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "oldenbyte. a place to settle",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${playfair.variable} ${dmMono.variable}`} suppressHydrationWarning>
      <body>
        {/* Apply the saved theme before paint to avoid a flash of the wrong mode. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}})()`}
        </Script>
        <ThemeHotkey />
        {children}
      </body>
    </html>
  );
}
