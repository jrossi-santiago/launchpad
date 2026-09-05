import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HeatCheck",
  description: "Find your next customers on X, before your competitors do.",
  appleWebApp: {
    // iOS reads this rather than the manifest: it is what makes the icon
    // on the home screen open standalone instead of in a Safari tab.
    capable: true,
    title: "HeatCheck",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // `cover` lets the page paint under the notch and the home indicator,
  // which is only safe because the tab bar and the reply sheet both pad
  // themselves with env(safe-area-inset-bottom).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
