import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "mapbox-gl/dist/mapbox-gl.css";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Grootguard",
  description: "Active fire monitoring for Spain",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
