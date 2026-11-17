import type { Metadata, Viewport } from "next";
import { Playfair_Display } from "next/font/google";
import Script from "next/script";
import ThemeHotkey from "@/components/ThemeHotkey";
import SaveErrorNotice from "@/components/SaveErrorNotice";
import AppHost, { APP_FETCH_SCRIPT } from "@/components/AppHost";

// True only in the build that is packed into the apps (tools/app-bundle).
const APP_BUNDLE = process.env.NEXT_PUBLIC_OB_APP === "1";
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
        {APP_BUNDLE && (
          <>
            <Script id="app-fetch" strategy="beforeInteractive">{APP_FETCH_SCRIPT}</Script>
            <AppHost />
          </>
        )}
        <ThemeHotkey />
        {children}
        <SaveErrorNotice />
      </body>
    </html>
  );
}
