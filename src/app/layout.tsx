import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { APP_FULL_NAME, APP_NAME } from '@/lib/constants';
import './globals.css';

// Inter for dense UI text and tables, Plus Jakarta Sans for headings and
// figures, JetBrains Mono for references and hashes. Self-hosted at build time.
const body = Inter({ variable: '--font-body', subsets: ['latin'], display: 'swap' });
const heading = Plus_Jakarta_Sans({ variable: '--font-heading', subsets: ['latin'], display: 'swap', weight: ['500', '600', '700', '800'] });
const code = JetBrains_Mono({ variable: '--font-code', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_FULL_NAME,
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Reading request headers renders every route per request, which is what
  // lets Next.js stamp the per-request CSP nonce on its scripts.
  await headers();
  // The theme choice lives in a cookie so the server renders the right theme
  // straight away (no flash, and no inline script needed under the strict CSP).
  const stored = (await cookies()).get('cirp_theme')?.value;
  const theme = stored === 'light' || stored === 'dark' ? stored : undefined;
  return (
    <html lang="en" data-theme={theme} className={`${body.variable} ${heading.variable} ${code.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground">{children}</body>
    </html>
  );
}
