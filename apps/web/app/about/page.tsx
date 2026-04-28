export default function AboutPage() {
  return (
    <section className="container-tight py-20">
      <h1 className="text-3xl font-bold">About</h1>
      <p className="mt-4 text-muted-foreground max-w-2xl">
        I build production ML systems — vector search, agentic workflows, multi-modal
        retrieval, and the boring infra that holds it all together. This site is a working
        portfolio: every demo is a real service running on the same EC2 box, exposed through
        CloudFront. Open the dev tools, watch the network tab — there&apos;s no fakery.
      </p>

      <h2 className="mt-12 text-xl font-semibold">Stack</h2>
      <ul className="mt-3 grid gap-2 text-muted-foreground sm:grid-cols-2">
        <li>Backend: Python (FastAPI), LangGraph, CrewAI, OpenSearch, pgvector</li>
        <li>Frontend: Next.js 14, Tailwind, shadcn/ui, React Flow</li>
        <li>Infra: Terraform, AWS (EC2, CloudFront, Amplify, Route 53), Docker Compose</li>
        <li>Observability: OpenTelemetry, Prometheus, Grafana, Jaeger</li>
      </ul>

      <h2 className="mt-12 text-xl font-semibold">Contact</h2>
      <p className="mt-3 text-muted-foreground">
        <a className="underline hover:text-foreground" href="mailto:shekhar.dudi@gmail.com">
          shekhar.dudi@gmail.com
        </a>{' '}
        ·{' '}
        <a
          className="underline hover:text-foreground"
          href="https://www.linkedin.com/in/shekhardudi"
          target="_blank"
          rel="noopener"
        >
          LinkedIn
        </a>
      </p>
    </section>
  );
}
