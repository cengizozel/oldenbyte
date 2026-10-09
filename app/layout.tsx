import type { Metadata } from "next";
import { Playfair_Display, Shantell_Sans } from "next/font/google";
import Script from "next/script";
import ThemeHotkey from "@/components/ThemeHotkey";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

// Accent face for labels and the date (the font-ui utility in globals.css).
const uiFont = Shantell_Sans({
  subsets: ["latin"],
  variable: "--font-ui",
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
    <html lang="en" className={`${playfair.variable} ${uiFont.variable}`} suppressHydrationWarning>
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
