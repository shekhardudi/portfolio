export function SiteFooter() {
  return (
    <footer className="border-t border-border py-8 text-sm text-foreground/70">
      <div className="container-tight flex flex-wrap items-center justify-between gap-2">
        <span>© {new Date().getFullYear()} Shekhar Dudi</span>
      </div>
    </footer>
  );
}
