import type { Metadata, Viewport } from "next";
import { Playfair_Display } from "next/font/google";
import Script from "next/script";
import ThemeHotkey from "@/components/ThemeHotkey";
import SaveErrorNotice from "@/components/SaveErrorNotice";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});


export const metadata: Metadata = {
  title: "oldenbyte. a place to settle",
  applicationName: "oldenbyte",
  // Installed to an iPhone's home screen it opens full screen, under this name.
  // (Android and desktop browsers read app/manifest.ts instead.)
  appleWebApp: { capable: true, title: "oldenbyte", statusBarStyle: "default" },
};

// The browser's own bars take the page color of the theme in use.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={playfair.variable} suppressHydrationWarning>
      <body>
        {/* Apply the saved theme before paint to avoid a flash of the wrong mode. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var c=document.documentElement.classList;var t=localStorage.getItem('theme');var th=(t==='dark'||t==='grey')?t:'light';if(th!=='light'){c.add('dark');if(th==='grey')c.add('grey')}var g={};try{g=JSON.parse(localStorage.getItem('glow')||'{}')||{}}catch(e){}var on=typeof g[th]==='boolean'?g[th]:th!=='light';if(on)c.add('glow')}catch(e){}})()`}
        </Script>
        <ThemeHotkey />
        {children}
        <SaveErrorNotice />
      </body>
    </html>
  );
}
