import Link from 'next/link';

// Simple 404 page with a button to go home and a button to contact support
// Show a cute SVG with your primary color
export default function Custom404() {
  return (
    <section className="relative flex h-screen w-full flex-col items-center justify-center gap-8 bg-background p-10 text-foreground">
      <div className="flex flex-col items-center gap-4">
        <span className="text-7xl">404</span>
        <Link href="/" className="flex items-center gap-2 rounded-lg border px-3 py-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="size-5"
          >
            <path
              fillRule="evenodd"
              d="M9.293 2.293a1 1 0 011.414 0l7 7A1 1 0 0117 11h-1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-3a1 1 0 00-1-1H9a1 1 0 00-1 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-6H3a1 1 0 01-.707-1.707l7-7z"
              clipRule="evenodd"
            />
          </svg>
          Home
        </Link>
      </div>
    </section>
  );
}
