import type { Metadata } from "next";
import "./globals.css";
import { getSiteUrl } from "@/lib/site-url";

const siteName = "GDMN Meet";
const siteUrl = getSiteUrl();
const siteTitle = "Free Privacy-First True P2P Video Conferencing | GDMN Meet";
const siteDescription =
  "GDMN Meet is a free privacy-first true P2P video conferencing and video call solution built on WebRTC for direct browser-to-browser meetings.";
const siteKeywords = [
  "free privacy-first video conferencing",
  "true p2p video call solution",
  "peer-to-peer video conferencing",
  "webrtc video meetings",
  "browser video calls",
  "private online meetings",
  "secure video conferencing",
  "gdmn meet"
];
const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: siteName,
  applicationCategory: "CommunicationApplication",
  operatingSystem: "Web Browser",
  url: siteUrl,
  description: siteDescription,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD"
  },
  featureList: [
    "True peer-to-peer WebRTC video calls",
    "Privacy-first browser-based meetings",
    "Direct room-based video conferencing",
    "No download required"
  ],
  keywords: siteKeywords.join(", ")
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteTitle,
    template: "%s | GDMN Meet"
  },
  description: siteDescription,
  applicationName: siteName,
  keywords: siteKeywords,
  authors: [{ name: siteName, url: siteUrl }],
  creator: siteName,
  publisher: siteName,
  alternates: {
    canonical: "/"
  },
  category: "technology",
  classification: "video conferencing",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1
    }
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    title: siteTitle,
    description: siteDescription,
    siteName
  },
  twitter: {
    card: "summary",
    title: siteTitle,
    description: siteDescription
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" }
    ],
    shortcut: "/favicon.ico"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html translate="no" lang="en" className="h-full">
      <body className="min-h-full">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData).replace(/</g, "\\u003c")
          }}
        />
        <main className="w-full min-h-screen overflow-hidden bg-yellow-400 p-4 md:p-8">
          {children}
        </main>
      </body>
    </html>
  );
}
