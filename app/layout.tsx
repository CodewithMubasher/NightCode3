import "@fontsource-variable/geist/wght.css"
import "@fontsource-variable/geist-mono/wght.css"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { SettingsApplier } from "@/components/settings-applier"

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark antialiased">
      <body>
        <ThemeProvider>
          <SettingsApplier />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
