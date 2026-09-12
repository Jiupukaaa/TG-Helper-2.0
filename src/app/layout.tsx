import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TG Helper",
  description: "Personal Telegram assistant — notes & reminders",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
