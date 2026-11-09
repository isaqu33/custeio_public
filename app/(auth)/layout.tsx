import { auth } from '@/app/lib/auth';
import { hexToHslChannels } from '@/app/lib/colors';
import { DEFAULT_BRAND_PALETTE } from '@/app/lib/system-settings';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#000000', // App background color (mobile top bar)
  width: 'device-width',
  initialScale: 1,
};

import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from 'next-themes';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Custeio',
  description: 'Authentication',
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const paletteStyle = {
    '--brand-light-primary': hexToHslChannels(DEFAULT_BRAND_PALETTE.light.primary, '217 90% 58%'),
    '--brand-light-secondary': hexToHslChannels(
      DEFAULT_BRAND_PALETTE.light.secondary,
      '220 14.3% 95.9%',
    ),
    '--brand-light-accent': hexToHslChannels(DEFAULT_BRAND_PALETTE.light.accent, '220 14.3% 95.9%'),
    '--brand-dark-primary': hexToHslChannels(DEFAULT_BRAND_PALETTE.dark.primary, '217 90% 58%'),
    '--brand-dark-secondary': hexToHslChannels(
      DEFAULT_BRAND_PALETTE.dark.secondary,
      '215 27.9% 16.9%',
    ),
    '--brand-dark-accent': hexToHslChannels(DEFAULT_BRAND_PALETTE.dark.accent, '215 27.9% 16.9%'),
  } as CSSProperties;

  if (session) {
    return redirect('/');
  }
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning style={paletteStyle}>
      <body className={`${inter.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
