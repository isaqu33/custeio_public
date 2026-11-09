import { Toaster } from '@/components/ui/sonner';
import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from 'next-themes';
import { Inter } from 'next/font/google';
import type { CSSProperties } from 'react';
import '../globals.css';

import { auth } from '@/app/lib/auth';
import { UnauthorizedError } from '@/app/lib/errors';
import { sessionHasSystemAccess } from '@/app/lib/authorization';
import { hexToHslChannels } from '@/app/lib/colors';
import { OrganizationWorkspaceFrame } from '@/components/organization-workspace-frame';
import connectDB from '@/app/lib/connect-db';
import { I18nProvider } from '@/app/lib/i18n/client';
import { getCopy } from '@/app/lib/i18n/dictionary';
import { normalizeLocale, type SupportedLocale } from '@/app/lib/i18n/locales';
import { DEFAULT_BRAND_PALETTE } from '@/app/lib/system-settings';
import UsersDB from '@/app/models/users';
import { AppSidebar } from '@/components/app-sidebar';
import AuthProvider from '@/components/auth-provider';
import { SiteHeader } from '@/components/site-header';
import { UiDensityProvider } from '@/components/ui-density';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Resolves the locale for server-rendered protected pages.
 *
 * The cookie wins because a profile language change lands there immediately,
 * while the auth JWT may still carry the previous value until it refreshes.
 * Unsupported cookie values fall through to the stored user preference, then
 * to the session, then to the default locale.
 */
async function resolveProtectedLayoutLocale(
  userId: string | undefined,
  sessionLanguage: SupportedLocale | undefined,
  cookieLanguage: string | undefined,
) {
  const normalizedCookieLanguage = normalizeLocale(cookieLanguage);
  if (cookieLanguage && normalizedCookieLanguage === cookieLanguage) {
    return normalizedCookieLanguage;
  }
  if (!userId) return normalizeLocale(sessionLanguage);
  try {
    await connectDB();
    const user = await UsersDB.findById(userId)
      .select('language')
      .lean<{ language?: string } | null>();
    return normalizeLocale(user?.language ?? sessionLanguage);
  } catch {
    return normalizeLocale(sessionLanguage);
  }
}

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'Custeio',
  description: 'Custeio — conciliação invisível de estoque e CMV',
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const cookieStore = await cookies();
  const locale = await resolveProtectedLayoutLocale(
    session?.user?.id,
    session?.user?.language,
    cookieStore.get('app_locale')?.value,
  );
  const copy = getCopy(locale);
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

  if (!session) {
    return redirect('/login');
  }

  if (session.user?.mustChangePassword) {
    return redirect('/change-password');
  }

  // Resolved once here rather than per nav entry: the sidebar is a client
  // component and cannot query the database itself. `null` means System/Support,
  // who bypass feature checks; nothing today grants a feature to anyone else
  // (see NAV_REQUIRED_FEATURE), so a real session carries an empty set.
  //
  // The authorization helpers refuse an account that was deactivated or deleted
  // after its session cookie was issued. That is a dead end, not a crash: send
  // it to a page that explains and offers sign-out.
  let hasSystemAccess: boolean;
  try {
    hasSystemAccess = await sessionHasSystemAccess(session);
  } catch (err) {
    if (err instanceof UnauthorizedError) return redirect('/account-inactive');
    throw err;
  }
  const sessionFeatures = hasSystemAccess ? null : new Set<string>();

  return (
    <html lang={locale} data-scroll-behavior="smooth" suppressHydrationWarning style={paletteStyle}>
      <body className={`${inter.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <I18nProvider locale={locale} copy={copy}>
            {/* SessionProvider has to sit above the sidebar: NavUser's profile
                modal calls useSession() to refresh the JWT after a language
                change, and it renders inside AppSidebar. */}
            <AuthProvider>
              <UiDensityProvider />
              <SidebarProvider>
                <AppSidebar
                  variant="floating"
                  features={sessionFeatures ? Array.from(sessionFeatures) : null}
                  hasSystemAccess={hasSystemAccess}
                />
                {/* `variant="floating"` above makes the *sidebar* its own rounded
                    card (see ui/sidebar.tsx); SidebarInset's own floating classes
                    are conditioned on the sidebar being `variant="inset"`, which
                    it no longer is, so they're repeated explicitly here to keep
                    the main panel floating too — two cards on the page background,
                    matching the reference layout. No left margin: the sidebar's
                    own edge padding already provides that gap. */}
                <SidebarInset className="md:my-3 md:mr-3 md:rounded-2xl md:shadow">
                  <SiteHeader />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="@container/main flex min-w-0 flex-1 flex-col gap-2">
                      <OrganizationWorkspaceFrame hasSystemAccess={hasSystemAccess}>
                        {children}
                      </OrganizationWorkspaceFrame>
                      <Toaster position="top-center" />
                    </div>
                  </div>
                </SidebarInset>
              </SidebarProvider>
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
