import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Productica",
  description: "Train and reuse product recognition.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/mark.png",
    shortcut: "/mark.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
