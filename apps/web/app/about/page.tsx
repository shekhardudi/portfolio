import Image from 'next/image';
import Link from 'next/link';
import { Github, Linkedin, Mail, MapPin } from 'lucide-react';

const LINKEDIN_URL = 'https://www.linkedin.com/in/shekhar-dudi-17283717/';
const GITHUB_URL = 'https://github.com/shekhardudi';
const EMAIL = 'shekhar.dudi@gmail.com';

const TOOLBOX = [
  {
    title: 'Languages',
    items: ['Python', 'Java'],
  },
  {
    title: 'AI & ML',
    items: ['LLMs', 'RAG', 'CrewAI', 'LangChain', 'LangGraph', 'LlamaIndex', 'PyTorch', 'TensorFlow', 'scikit-learn', 'NLP'],
  },
  {
    title: 'Platform',
    items: ['Azure', 'AWS', 'Kubernetes', 'Docker', 'Terraform', 'Kafka', 'OpenSearch', 'PostgreSQL', 'MongoDB'],
  },
];

const WHAT_I_BUILD = [
  {
    title: 'Generative AI & Agentic Systems',
    description:
      'LLMs, RAG, semantic search, multi-agent orchestration, tool use, prompt engineering, guardrails, and human-in-the-loop workflows.',
  },
  {
    title: 'AI Platforms & MLOps',
    description:
      'Cloud-native AI platforms, CI/CD for ML systems, observability, evaluation pipelines, monitoring, cost controls, and scalable deployment patterns.',
  },
  {
    title: 'Architecture & Engineering Leadership',
    description:
      'Technical strategy, solution architecture, engineering governance, stakeholder alignment, team mentoring, and translating business ambiguity into working systems.',
  },
];

export default function AboutPage() {
  return (
    <section className="container-tight py-20">
      {/* Header */}
      <div className="flex max-w-3xl flex-col items-start gap-8 sm:flex-row sm:items-start">
        {/* Profile photo — drop your image at apps/web/public/profile.jpg */}
        <div className="shrink-0">
          <div className="relative h-36 w-36 overflow-hidden rounded-2xl border border-border shadow-md sm:h-44 sm:w-44">
            <Image
              src="/profile.jpg"
              alt="Shekhar Dudi"
              fill
              sizes="(max-width: 640px) 9rem, 11rem"
              className="object-cover"
              priority
            />
          </div>
        </div>

        {/* Text side */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
            About
          </p>
          <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
            Shekhar Dudi
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">
            Lead AI Engineer building production-grade GenAI, agentic systems, and AI
            platforms that survive beyond the demo.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Melbourne, Australia
            </span>
            <a
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
              href={`mailto:${EMAIL}`}
            >
              <Mail className="h-3.5 w-3.5" /> Email
            </a>
            <a
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
              href={LINKEDIN_URL}
              target="_blank"
              rel="noopener"
            >
              <Linkedin className="h-3.5 w-3.5" /> LinkedIn
            </a>
            <a
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
              href={GITHUB_URL}
              target="_blank"
              rel="noopener"
            >
              <Github className="h-3.5 w-3.5" /> GitHub
            </a>
          </div>
        </div>
      </div>

      {/* Lead */}
      <div className="mt-16 max-w-3xl">
        <p className="text-xl font-semibold leading-snug text-foreground sm:text-2xl">
          I&rsquo;m an AI engineering leader with 13+ years of experience building
          scalable and production-grade software, machine learning, and  Generative
          AI systems.
        </p>

        <div className="mt-6 space-y-4 text-[0.9375rem] leading-[1.75] text-muted-foreground">
          <p>
            My work sits at the intersection of architecture, hands-on engineering, and
            technical leadership &mdash; turning ambitious AI ideas into systems people
            actually use, trust, and rely on.
          </p>

          {/* Callout */}
          <p className="border-l-2 border-blue-400/60 pl-4 text-foreground font-medium">
            I don&rsquo;t just build AI demos. I build AI that works at 3&nbsp;AM on a
            Tuesday.
          </p>

          <p>
            Over the last decade, I&rsquo;ve led and delivered solutions across enterprise
            virtual agents, RAG systems, multi-agent workflows, compliance automation, NLP
            products, MLOps platforms, and cloud-native AI infrastructure. My focus is on
            closing the gap between a promising prototype and a reliable product: strong
            retrieval, clear guardrails, structured outputs, observability, cost control,
            and engineering discipline from day one.
          </p>
          <p>
            I&rsquo;ve built and led AI teams from zero to one, partnered with executives
            and product teams, and mentored engineers to think beyond code &mdash; toward
            systems, outcomes, and long-term maintainability. My work has supported
            large-scale enterprise environments, including AI solutions serving
            240,000+ users, reducing operational tickets by 40%, building search engines
            and multi-agent workflows.
          </p>
        </div>
      </div>

      {/* How I think */}
      <div className="mt-16 max-w-3xl">
        <h2 className="text-xl font-semibold">How I think about AI</h2>
        <div className="mt-4 border-l-2 border-blue-400/60 pl-5 space-y-2 text-muted-foreground leading-relaxed">
          <p>A demo proves that a model can answer.</p>
          <p>
            A product proves that it can fail safely, recover gracefully, and keep
            delivering value.
          </p>
          <p className="font-semibold text-foreground pt-1">
            That&rsquo;s the bar I build for.
          </p>
        </div>
        <p className="mt-5 text-[0.9375rem] leading-[1.75] text-muted-foreground">
          I care about AI systems that are useful, measurable, governed, and
          maintainable. That means designing with humans in the loop where needed,
          grounding outputs in the right data, tracing what happens under the hood, and
          making sure the system is cost-aware before it becomes expensive to operate.
        </p>
      </div>

      {/* What I build */}
      <div className="mt-16 max-w-5xl">
        <h2 className="text-xl font-semibold">What I build</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          I design and ship AI systems across:
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {WHAT_I_BUILD.map((area) => (
            <div
              key={area.title}
              className="rounded-xl border border-border bg-background/40 p-5"
            >
              <h3 className="text-sm font-semibold text-foreground">{area.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {area.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Toolbox */}
      <div className="mt-16 max-w-5xl">
        <h2 className="text-xl font-semibold">Toolbox</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {TOOLBOX.map((group) => (
            <div
              key={group.title}
              className="rounded-xl border border-border bg-background/40 p-4"
            >
              <h3 className="text-sm font-semibold text-foreground">{group.title}</h3>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {group.items.map((item) => (
                  <span
                    key={item}
                    className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Off the clock */}
      <div className="mt-16 max-w-3xl">
        <h2 className="text-xl font-semibold">Off the clock</h2>
        <p className="mt-3 text-[0.9375rem] leading-[1.75] text-muted-foreground">
          Outside the terminal, I&rsquo;m usually planning the next trip, gaming, or
          tinkering with another side build that started as &ldquo;just a quick
          idea.&rdquo; I like building things &mdash; products, teams, systems, and
          occasionally overly ambitious travel itineraries.
        </p>
      </div>

      {/* CTA */}
      <div className="mt-12 flex flex-wrap gap-3">
        <a
          href={LINKEDIN_URL}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:bg-foreground/90"
        >
          <Linkedin className="h-4 w-4" /> Connect on LinkedIn
        </a>
        <a
          href={`mailto:${EMAIL}`}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          <Mail className="h-4 w-4" /> Send an email
        </a>
        <Link
          href="/#solutions"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          See the work
        </Link>
      </div>
    </section>
  );
}
