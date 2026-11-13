import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dump",
  description: "Save anything. Dump sorts it for you.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
