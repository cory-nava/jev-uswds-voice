import type { Metadata } from "next";
import "@uswds/uswds/css/uswds.css";
import "./page-layout.css";

export const metadata: Metadata = {
  title: "Voice-built USWDS sites — Jev + uswds-json-render",
  description: "Talk to build USWDS pages: speech in, Jev component decisions, JSON specs out.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
