import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = { title: 'Noskov Fitness', description: 'CrossFit programming and tracking for the Noskov family' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/calendar" className="brand">Noskov Fitness</Link>
          <nav aria-label="Main">
            <Link href="/calendar">Calendar</Link>
            <Link href="/analysis">Analysis</Link>
            <Link href="/benchmarks">Benchmarks</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
