export function SiteFooter() {
  return (
    <footer className="border-t border-border py-8 text-sm text-foreground/70">
      <div className="container-tight flex flex-wrap items-center justify-between gap-2">
        <span>© {new Date().getFullYear()} Shekhar Dudi</span>
        <span>
          Built with Next.js 14 · deployed on AWS Amplify + EC2 · sources on{' '}
          <a className="underline hover:text-foreground" href="https://github.com/shekhardudi">
            GitHub
          </a>
          .
        </span>
      </div>
    </footer>
  );
}
