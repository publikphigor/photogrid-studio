import { useEffect } from "react";
import {
  ArrowRight,
  Eye,
  Github,
  Image as ImageIcon,
  Layers,
  Layout,
  LockKeyhole,
  MousePointer2,
  Save,
  Shapes,
  Sliders,
  Type,
} from "lucide-react";

const REPO_URL = "https://github.com/publikphigor/photogrid-studio";
const DEV_URL = "https://github.com/publikphigor";
const GIT_SHA = import.meta.env.VITE_GIT_SHA ?? "dev";

export function Landing() {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  return (
    <div className="min-h-screen w-full bg-bg text-text font-sans antialiased">
      <Nav />
      <Hero />
      <Features />
      <Cta />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header
      className="sticky top-0 z-40 bg-bg/85 backdrop-blur"
      style={{
        boxShadow: "0 1px 0 rgba(0,0,0,0.6), 0 6px 18px rgba(0,0,0,0.35)",
      }}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <a
          href="/"
          className="flex items-center gap-2.5 text-[14px] font-semibold tracking-tight"
        >
          <Mark />
          PhotoGrid Studio
        </a>
        <div className="flex items-center gap-1.5">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 text-[13px] text-text-2 transition hover:border-line-strong hover:text-text sm:inline-flex"
          >
            <Github size={15} />
            GitHub
          </a>
          <a
            href="/app"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[13px] font-semibold text-[color:var(--primary-fg)] transition hover:bg-accent-2"
          >
            Launch app
            <ArrowRight size={15} />
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-24 sm:pt-28 sm:pb-32">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Open source · MIT
        </span>

        <h1 className="mt-6 max-w-3xl text-[44px] font-semibold leading-[1.05] tracking-[-0.02em] text-text sm:text-[64px]">
          Photo grids that
          <br />
          <span className="text-accent">keep your photos sharp.</span>
        </h1>

        <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-text-2 sm:text-[18px]">
          Arrange your photos into a grid in the browser. When you export, you
          get an image at the original size of your photos — not a scaled-down
          screenshot of what you see on screen.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a
            href="/app"
            className="inline-flex h-11 items-center gap-2 rounded-md bg-accent px-5 text-[14px] font-semibold text-[color:var(--primary-fg)] transition hover:bg-accent-2"
            style={{ boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }}
          >
            Launch the editor
            <ArrowRight size={16} />
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-panel px-5 text-[14px] text-text transition hover:border-line-strong"
          >
            <Github size={16} />
            View source
          </a>
        </div>

        <div className="mt-6 flex items-start gap-2 text-[13px] text-text-3">
          <LockKeyhole size={14} className="mt-[3px] flex-none text-text-2" />
          <p>
            No sign-up. Photos clear themselves from the temporary cache after a
            day, and you can run the whole thing on your own machine if you
            want.
          </p>
        </div>

        <HeroPreview />
      </div>
    </section>
  );
}

function HeroPreview() {
  return (
    <div className="relative mt-16 sm:mt-20">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-panel shadow-2 sm:rounded-3xl">
        <div className="flex items-center gap-1.5 border-b border-line bg-panel-2 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-4 font-mono text-[11px] text-text-3">
            photogrid.studio / editor
          </span>
        </div>
        <div className="grid grid-cols-[160px_1fr_180px] gap-0">
          <FakeLeftPanel />
          <FakeStage />
          <FakeInspector />
        </div>
      </div>
    </div>
  );
}

function FakeLeftPanel() {
  return (
    <div className="hidden border-r border-line bg-panel p-4 sm:block">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-3">
        Presets
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded border border-line bg-panel-2"
          />
        ))}
      </div>
    </div>
  );
}

function FakeStage() {
  return (
    <div className="relative aspect-[4/3] bg-[#0e0e10] sm:aspect-[5/4]">
      <div className="absolute inset-6 sm:inset-10">
        <div
          className="grid h-full w-full gap-1.5"
          style={{
            gridTemplateColumns: "1.4fr 1fr 1fr",
            gridTemplateRows: "1fr 1fr 1fr",
          }}
        >
          <Cell
            color="#e8a96a"
            style={{ gridColumn: "1", gridRow: "1 / span 3" }}
          />
          <Cell color="#5f89c6" />
          <Cell color="#9d72c0" />
          <Cell
            color="#d96c63"
            style={{ gridColumn: "2 / span 2", gridRow: "2" }}
          />
          <Cell color="#6cb697" />
          <Cell color="#e0b25c" />
        </div>
      </div>
    </div>
  );
}

function Cell({
  color,
  style,
}: {
  color: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="overflow-hidden rounded-[3px]"
      style={{ background: color, ...style }}
    />
  );
}

function FakeInspector() {
  return (
    <div className="hidden flex-col gap-3 border-l border-line bg-panel p-4 sm:flex">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-3">
        Inspector
      </div>
      <Row label="Width" value="3000 px" />
      <Row label="Height" value="3000 px" />
      <Row label="Aspect" value="1:1" />
      <Row label="Format" value="PNG" />
      <div className="mt-2 h-px bg-line" />
      <Row label="Gap" value="12 px" />
      <Row label="Radius" value="6 px" />
      <Row label="Border" value="2 px" />
      <div className="mt-2 h-9 rounded-md bg-accent text-center font-semibold leading-9 text-[color:var(--primary-fg)]">
        Export
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-text-3">{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}

const FEATURES = [
  {
    icon: ImageIcon,
    title: "Original-quality exports",
    body: "Your photos go out at their full size. No downscaling, no fuzzy edges — the exported image is as sharp as the files you put in.",
  },
  {
    icon: Eye,
    title: "Sharp on-screen, too",
    body: "The canvas shows your photos at their real resolution, so what you arrange is what you get. Zoom in to check details before you save.",
  },
  {
    icon: Layout,
    title: "Free-form layouts",
    body: "Pick a preset or build your own. Drag photos around, swap them, merge cells together, or split one into halves. Resize any cell from any edge.",
  },
  {
    icon: Shapes,
    title: "Shapes and borders",
    body: "Crop the whole canvas — or any single cell — to a circle, heart, hexagon and more. Add gaps, rounded corners, and outlines to taste.",
  },
  {
    icon: Sliders,
    title: "Color and filters",
    body: "Tune brightness, contrast, saturation, blur and a few more per cell. What you see on the canvas is what you get in the file.",
  },
  {
    icon: Type,
    title: "Text and watermarks",
    body: "Drop captions, titles or watermarks anywhere. Pick a font, change the color, rotate it, fade it. Place text behind or in front of your photos.",
  },
  {
    icon: ImageIcon,
    title: "Backgrounds",
    body: "Add a background photo, blur it, dim it, tint it. Useful for collages, moodboards, or putting your subject against a softer backdrop.",
  },
  {
    icon: MousePointer2,
    title: "Select many, edit once",
    body: "Shift-click to pick a range of cells, ⌘-click to add or remove from the selection, then change a setting to apply it to every selected cell.",
  },
  {
    icon: Save,
    title: "Save your layouts",
    body: "Templates save to your browser so you can come back to the same arrangement later. Sixty steps of undo and redo keep experiments safe.",
  },
  {
    icon: LockKeyhole,
    title: "No accounts, no tracking",
    body: "Nothing to sign up for. No analytics. Photos are kept in a temporary cache while you work and clear themselves out after a day.",
  },
  {
    icon: Layers,
    title: "Works with big photos",
    body: "Phone shots and DSLR raw exports both work. The app keeps full-resolution sources around so you can export huge prints when you need to.",
  },
  {
    icon: Github,
    title: "Open source",
    body: "MIT licensed. Fork it, change it, host it on your own server — the source is on GitHub and the deploy is a couple of commands.",
  },
];

function Features() {
  return (
    <section id="features" className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="max-w-2xl">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
            What you can do
          </div>
          <h2 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.015em] text-text sm:text-[40px]">
            A small editor with real output.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-text-2 sm:text-[16px]">
            Everything you need to put a few photos together and walk away with
            something you can actually print or post.
          </p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="flex flex-col gap-3 bg-panel p-6 transition hover:bg-panel-2"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-panel-2 text-accent">
                <f.icon size={18} />
              </div>
              <h3 className="text-[15px] font-semibold tracking-tight text-text">
                {f.title}
              </h3>
              <p className="text-[13.5px] leading-relaxed text-text-2">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="relative overflow-hidden rounded-3xl border border-line bg-panel p-10 sm:p-14">
          <div className="relative flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl">
              <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.015em] text-text sm:text-[36px]">
                Make something at full size.
              </h2>
              <p className="mt-3 text-[14.5px] leading-relaxed text-text-2 sm:text-[16px]">
                No sign-up. Works in your browser. Bring your own photos.
              </p>
            </div>
            <a
              href="/app"
              className="inline-flex h-12 items-center gap-2 whitespace-nowrap rounded-md bg-accent px-6 text-[15px] font-semibold text-[color:var(--primary-fg)] transition hover:bg-accent-2"
              style={{ boxShadow: "0 12px 32px rgba(0,0,0,0.45)" }}
            >
              Launch the editor
              <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 text-[13px] text-text-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Mark />
          <span className="text-text-2">PhotoGrid Studio</span>
          <span className="text-text-4">· MIT licensed</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <a
            href={`${REPO_URL}/commit/${GIT_SHA}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-mono transition hover:text-text"
            title="Open this build's commit on GitHub"
          >
            build {GIT_SHA}
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 transition hover:text-text"
          >
            <Github size={14} />
            Source repo
          </a>
          <a
            href={DEV_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 transition hover:text-text"
          >
            Built by @publikphigor
          </a>
          <a href="/app" className="transition hover:text-text">
            Open the app →
          </a>
        </nav>
      </div>
    </footer>
  );
}

function Mark() {
  return (
    <span
      aria-hidden
      className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] bg-accent"
    >
      <svg viewBox="0 0 22 22" className="h-4 w-4">
        <rect x="3" y="3" width="16" height="16" rx="2" fill="#fff" />
        <g stroke="rgba(0,0,0,0.55)" strokeWidth="0.7">
          <path d="M3 8.5h16M3 13.5h16M8.5 3v16M13.5 3v16" />
        </g>
      </svg>
    </span>
  );
}
