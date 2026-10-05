import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Ktebli · Your next opportunity",
  description:
    "A focused workspace for grants and procurement opportunities in Lebanon.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
