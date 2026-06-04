import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Cold Call Condenser",
  description: "Upload a long cold calling recording and remove the dead air."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
