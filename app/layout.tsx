import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme";

export const metadata: Metadata = {
  title: `${process.env.NEXT_PUBLIC_PANEL_NAME || "Caaqil"} — AI Hosting Panel`,
  description: "A fast, AI-native hosting control panel.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#070b10" },
  ],
};

// Runs before the page paints so the correct theme class is present on the
// very first frame. Defaults to the OS preference; an explicit choice in
// localStorage always wins.
const THEME_SCRIPT = `(function(){try{var k='caaqil-theme';var s=localStorage.getItem(k);var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=(s==='light'||s==='dark')?s:(m?'dark':'light');var c=document.documentElement.classList;c.remove('light','dark');c.add(r);document.documentElement.style.colorScheme=r;}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
