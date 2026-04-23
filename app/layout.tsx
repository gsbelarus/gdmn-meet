import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "gdmn Meet",
  description: "Privacy-first peer-to-peer video meetings."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html translate="no" lang="en" className="h-full">
      <body className="min-h-full">
        <main className="w-full min-h-screen overflow-hidden bg-yellow-400 p-4 md:p-8">
          {children}
        </main>
      </body>
    </html>
  );
}
