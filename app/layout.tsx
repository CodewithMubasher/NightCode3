import "@fontsource-variable/geist/wght.css"
import "@fontsource-variable/geist-mono/wght.css"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { SettingsApplier } from "@/components/settings-applier"
import { Toaster } from "@/components/ui/sonner"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "NightCode",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark antialiased">
      <head>
        <script dangerouslySetInnerHTML={{
          __html: `!function(){try{var s=JSON.parse(localStorage.getItem("nightcode-store")||"{}");var st=s&&s.state&&s.state.settings;if(st){if(st.primaryColor){document.documentElement.style.setProperty("--primary-color",st.primaryColor);document.documentElement.style.setProperty("--primary",st.primaryColor)}if(st.reducedMotion){document.documentElement.classList.add("reduce-motion")}}}catch(e){}}()`
        }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <SettingsApplier />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
