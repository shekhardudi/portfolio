import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="container-tight py-32 text-center">
      <h1 className="text-3xl font-bold">404</h1>
      <p className="mt-2 text-muted-foreground">That solution doesn&apos;t exist (yet).</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
      >
        Back home
      </Link>
    </section>
  );
}
