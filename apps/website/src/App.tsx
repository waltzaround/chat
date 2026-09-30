import type { ReactNode } from "react";
import { Demo } from "./Demo";
import { ArrowUpRight, ChevronDown, ChevronRight, Code2, MessageSquare, Mic, Monitor, Server, Shield, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

const REPO = "https://github.com/waltzaround/chat";
const DEPLOY = `https://deploy.workers.cloudflare.com/?url=${REPO}`;

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={id} className="documentation-section">
      <div className="documentation-heading">
      <h2 className="section-title">{title}</h2>
      {intro ? <p className="mt-2 text-muted-foreground">{intro}</p> : null}</div>
      <div className="documentation-content">{children}</div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="mt-3 overflow-x-auto border border-border bg-muted p-5 text-sm"><code className="bg-transparent p-0">{children}</code></pre>;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card font-mono text-sm text-muted-foreground">{String(n).padStart(2, "0")}</span>
      <div className="min-w-0 flex-1 pb-8">
        <h3 className="font-semibold">{title}</h3>
        <div className="mt-1 space-y-2 text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

/** Native <details>: keyboard and screen-reader friendly with no script. */
function Question({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="question group border-b border-border bg-card [&_p]:text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium">
        {q}
        <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-2 pb-4">{children}</div>
    </details>
  );
}

const features = [
  { icon: MessageSquare, title: "Workspaces and DMs", text: "Channels, threads, replies, reactions, pins, search, roles and permissions." },
  { icon: Mic, title: "Voice and video", text: "Voice rooms with video and screen sharing, powered by Cloudflare RealtimeKit." },
  { icon: Smartphone, title: "Every platform", text: "Use the web app or install it as a PWA. Desktop, iOS and Android clients are available to build from source." },
  { icon: Shield, title: "Yours", text: "Your data lives in your own Cloudflare account. Moderation, backups and exports built in." },
];

const phones = [
  { src: "/screenshots/ios-home.jpg", alt: "Chat on iPhone: the server rail and a workspace's channels", label: "iOS" },
  { src: "/screenshots/ios-channel.jpg", alt: "Chat on iPhone: a channel with messages and reactions", label: "iOS" },
  { src: "/screenshots/android-home.jpg", alt: "Chat on Android: the server rail and a workspace's channels", label: "Android" },
  { src: "/screenshots/android-channel.jpg", alt: "Chat on Android: a channel with messages", label: "Android" },
];

function Screenshots() {
  return (
    <section id="screenshots" className="devices-section" aria-labelledby="screenshots-title">
      <div className="section-heading">
        <div><h2 id="screenshots-title">One server.<br /><mark>Every screen.</mark></h2></div>
        <p>Web and PWA are ready to use on your server. Desktop, iOS and Android clients can be built from source. Mobile voice, video and pinning are still in development.</p>
      </div>
      <div className="phone-grid">
        {phones.map((p, i) => (
          <figure key={p.src}>
            <figcaption><span>{p.label}</span><span>0{i + 1} <ArrowUpRight size={13} aria-hidden /></span></figcaption>
            <img src={p.src} alt={p.alt} width={900} height={1950} loading="lazy" />
          </figure>
        ))}
      </div>
    </section>
  );
}

export function App() {
  return (
    <div className="site-shell" id="top">
      <header className="site-header">
        <nav className="navigation" aria-label="Main">
          <a href="#top" className="wordmark"><MessageSquare strokeWidth={2.5} aria-hidden />Chat<span className="brand-dot" /></a>
          <div className="nav-links">
            <a href="#demo">Try it</a>
            <a href="#screenshots">Apps</a>
            <a href="#setup">Developers <ChevronDown size={12} aria-hidden /></a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="nav-actions">
            <a href={REPO} className="github-link"><Code2 size={17} aria-hidden /><span>Open source</span></a>
            <Button asChild className="nav-cta"><a href={DEPLOY}>Deploy your server <ArrowUpRight aria-hidden /></a></Button>
          </div>
          <details className="mobile-menu" onClick={(event) => { if ((event.target as HTMLElement).closest("a")) event.currentTarget.open = false; }}><summary aria-label="Open navigation"><ChevronDown size={20} /></summary><div><a href="#demo">Try it</a><a href="#screenshots">Apps</a><a href="#setup">Setup guide</a><a href="#faq">FAQ</a><a href={REPO}>GitHub</a></div></details>
        </nav>
      </header>

      <main>
        <section className="hero">

          <h1>Discord-style chat.<br /><mark>Your Cloudflare account.</mark></h1>
          <div className="hero-bottom">
            <p>Open-source community chat with channels, DMs, voice and video. Deploy it to your own Cloudflare account and invite your people.</p>
            <div className="hero-actions">
              <Button asChild size="lg"><a href={DEPLOY}>Deploy your server <ArrowUpRight aria-hidden /></a></Button>
              <Button asChild size="lg" variant="outline"><a href="#demo"><ChevronRight aria-hidden /> Try the preview</a></Button>
            </div>
          </div>
          <div className="hero-preview">
            <div className="preview-image"><img src="/screenshots/desktop.jpg" alt="Chat desktop app showing workspace channels, a conversation, and members" width={2000} height={1250} fetchPriority="high" /></div>
          </div>
          <div className="platform-strip"><div><Monitor aria-hidden /> Windows & macOS</div><div><Smartphone aria-hidden /> iOS & Android</div><div><MessageSquare aria-hidden /> Web & PWA</div></div>
        </section>

        <Demo />

        <section className="manifesto"><h2>Your community.<br />Your rules. <mark>Your server.</mark></h2><p>For project groups, developer communities and friends who want to run their own place to talk. Your database and files live in your Cloudflare account; the source is available under AGPL-3.0.</p></section>

        <section id="features" className="features-section">
          <div className="feature-intro"><h2>Everything your community needs.<br /><mark>All in one place.</mark></h2><p>From the everyday check-in to the late-night voice room.<br />Make space for the way your people connect.</p><a href="#setup" className="text-link">Explore the setup guide <ArrowUpRight size={16} aria-hidden /></a></div>
          <div className="feature-grid">{features.map(({ icon: Icon, title, text }, i) => <article key={title}><div className="feature-number"><Icon size={22} aria-hidden /><span>0{i + 1}</span></div><h3>{title}</h3><p>{text}</p></article>)}</div>
          <div className="ownership-banner"><Server size={30} aria-hidden /><div><h3>Your data stays with you.</h3><p>Your Cloudflare account. Your database. Backups and exports built in.</p></div><a href={REPO} className="text-link">Explore the source <ArrowUpRight size={16} aria-hidden /></a></div>
        </section>

        <Section id="walkthrough" title="See the real app" intro="A short recording of the web app with sample conversations.">
          <video controls preload="none" poster="/screenshots/desktop.jpg" className="walkthrough-video" aria-label="Chat web app walkthrough">
            <source src="/chat-walkthrough.mp4" type="video/mp4" />
            <track default kind="captions" src="/chat-walkthrough.vtt" srcLang="en" label="English" />
          </video>
          <p className="mt-3 text-muted-foreground">Browse channels, send a message and explore community roles. The recording uses fictional demo accounts.</p>
        </Section>

        <Screenshots />

        <Section id="availability" title="Choose your app" intro="Start in your browser. Build the other clients when you need them.">
          <ul className="list-disc space-y-3 pl-5">
            <li><strong>Web / PWA:</strong> included with every deployment. Install from your browser.</li>
            <li><a className="link" href={`${REPO}/tree/main/apps/desktop`}>Windows / macOS build instructions</a></li>
            <li><a className="link" href={`${REPO}/tree/main/apps/ios`}>iOS build instructions</a></li>
            <li><a className="link" href={`${REPO}/tree/main/apps/android`}>Android build instructions</a></li>
          </ul>
        </Section>

        <Section id="costs" title="What does it cost?" intro="The source is free. Hosting is billed by Cloudflare to your account.">
          <p>Text chat can run within Cloudflare’s free allowances. Your bill depends on requests, database usage, file storage and background jobs. We have not yet published measured costs for an active community.</p>
          <p className="mt-3">Voice and video use RealtimeKit and are metered separately. Email requires a paid Workers plan. Check the current allowances before deploying:</p>
          <div className="pricing-links">
            <a className="link" href="https://developers.cloudflare.com/workers/platform/pricing/">Workers pricing</a>
            <a className="link" href="https://developers.cloudflare.com/durable-objects/platform/pricing/">Durable Objects</a>
            <a className="link" href="https://developers.cloudflare.com/d1/platform/pricing/">D1</a>
            <a className="link" href="https://developers.cloudflare.com/r2/pricing/">R2</a>
            <a className="link" href="https://developers.cloudflare.com/queues/platform/pricing/">Queues</a>
            <a className="link" href="https://developers.cloudflare.com/realtime/realtimekit/pricing/">Voice and video</a>
          </div>
        </Section>

        <Section id="setup" title="How to set it up" intro="You need a Cloudflare account. The free plan is enough, and you can sign up along the way.">
          <h3 className="mb-6 text-lg font-semibold">Option 1: the deploy button (nothing to install)</h3>
          <ol>
            <Step n={1} title="Click Deploy to Cloudflare">
              <p>Log in to Cloudflare, or choose <strong>Sign up</strong>.</p>
              <Button asChild className="mt-2"><a href={DEPLOY}>Deploy to Cloudflare <ArrowUpRight aria-hidden /></a></Button>
            </Step>
            <Step n={2} title="Connect GitHub or GitLab">
              <p>Cloudflare copies the project into your account and creates the database, file storage and queue.</p>
            </Step>
            <Step n={3} title="Set a claim phrase">
              <p>Leave everything blank except <code>OWNER_CLAIM_TOKEN</code>: type any long random phrase, then click <strong>Deploy</strong>.</p>
            </Step>
            <Step n={4} title="Create your owner account">
              <p>Open <code>https://your-app.workers.dev/register?claim=your-phrase</code>. Create your account, name your first workspace, and share the invite link it gives you.</p>
            </Step>
          </ol>

          <h3 className="mt-4 mb-2 text-lg font-semibold">Option 2: from your terminal</h3>
          <p className="text-muted-foreground">Needs Node.js 22 or newer and git.</p>
          <Code>{`git clone ${REPO}.git chat && cd chat
npm install
npm run setup`}</Code>
          <p className="mt-3 text-muted-foreground">
            Setup logs you in to Cloudflare, shows a plan before changing anything, creates everything, deploys, and prints a one-time link for your owner account. Running it again is safe, and it's how you add extras later.
          </p>

          <h3 className="mt-10 mb-2 text-lg font-semibold">Optional extras</h3>
          <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
            <li><strong className="text-foreground">Voice, video and screen sharing:</strong> create a RealtimeKit app in the Cloudflare dashboard, then run setup again.</li>
            <li><strong className="text-foreground">Google or GitHub sign-in:</strong> an OAuth client id and secret.</li>
            <li><strong className="text-foreground">Email</strong> (password resets, confirming addresses): needs the Workers Paid plan and your own domain on Cloudflare.</li>
            <li><strong className="text-foreground">Custom domain:</strong> add it to the Worker, then run <code>npm run setup -- --app-url https://chat.example.com</code>.</li>
          </ul>

          <h3 className="mt-10 mb-2 text-lg font-semibold">Keeping it running</h3>
          <Code>{`npm run update   # get the latest version
npm run deploy   # build, migrate the database and deploy
npm run backup   # save the database to backups/`}</Code>
        </Section>

        <Section id="faq" title="FAQ">
          <div className="space-y-3">
            <Question q="How much does it cost?">
              <p>The source is free, and text chat can run within Cloudflare’s free allowances. Hosting costs depend on usage; email needs a paid Workers plan and voice/video are metered separately. See the hosting costs above.</p>
            </Question>
            <Question q="Who becomes the owner?">
              <p>The first account created. With a claim phrase set, only your claim link can create it. Without one, whoever signs up first becomes owner, so open the link straight away.</p>
            </Question>
            <Question q="Who can join my server?">
              <p>By default, only people with an invite link. The owner can open sign-up to anyone under Settings → Server. Turnstile and rate limits protect open sign-up.</p>
            </Question>
            <Question q="Can I use one app for several servers?">
              <p>Yes. The iOS, Android and desktop apps sign in to as many servers as you like, and all their workspaces share one server rail. In a browser, use “Add a server” in the rail to link another server.</p>
            </Question>
            <Question q="Do push notifications expose my messages?">
              <p>No. Pushes go through a relay that only says “wake up and ask your server”. The app then fetches the message from your server itself, so the relay, Apple and Google never see message text.</p>
            </Question>
            <Question q="How do I recover a forgotten password?">
              <p>The owner can make a one-time reset link for any member under Settings → Server. Owners can run <code>npm run recover</code>. With email set up, “Forgot password?” sends a link.</p>
            </Question>
            <Question q="How do I back up and restore?">
              <p>D1 Time Travel keeps 7 days of history automatically (30 on the paid plan). <code>npm run backup</code> saves a copy outside Cloudflare, and <code>npm run restore</code> loads it into an empty database.</p>
            </Question>
            <Question q="Can I brand my server?">
              <p>Yes. Under Settings → Server the owner can set a name, description and icon. They appear on the sign-in page and in the apps.</p>
            </Question>
          </div>
        </Section>

        <Section id="troubleshooting" title="Troubleshooting">
          <div className="space-y-3">
            <Question q="The deploy stops with an R2 error">
              <p>Open <strong>R2</strong> in the Cloudflare dashboard once to enable it. The free tier is enough, but Cloudflare asks for a payment method. Then retry the deploy.</p>
            </Question>
            <Question q="Voice rooms say “Voice is not configured on this deployment”">
              <p>Create a RealtimeKit app (dashboard → Realtime → RealtimeKit), then run <code>npm run setup</code> again and answer yes to voice. Deploy-button copies set the secrets in the dashboard and run <code>npm run realtimekit:presets</code> once.</p>
            </Question>
            <Question q="Someone else became the owner">
              <p>If no claim phrase was set, the first sign-up wins. Delete the Worker's D1 database, create a new one, redeploy with <code>OWNER_CLAIM_TOKEN</code> set, and use your claim link immediately.</p>
            </Question>
            <Question q="Sign-up shows a bot check that never finishes">
              <p>Turnstile only allows the hostnames it was created for. After adding a custom domain, run <code>npm run setup -- --app-url https://your-domain</code>.</p>
            </Question>
            <Question q="Uploads fail on a custom domain">
              <p>The R2 bucket's CORS rules need the new origin. Running setup with <code>--app-url</code> updates them.</p>
            </Question>
            <Question q="Everyone was signed out">
              <p>The auth secret changed (for example, a new <code>BETTER_AUTH_SECRET</code> or a fresh database). Everyone just needs to sign in again.</p>
            </Question>
            <Question q="The app says “That address isn't a Chat server”">
              <p>Check the address in a browser: <code>https://your-server/api/instance</code> should show <code>"software": "chat"</code>. If it doesn't load, the server is down or the address is wrong. Older servers need <code>npm run update</code> and a deploy.</p>
            </Question>
            <Question q="The update pull request never appears">
              <p>In your repo's Settings → Actions → General, turn on <strong>Allow GitHub Actions to create and approve pull requests</strong>.</p>
            </Question>
          </div>
        </Section>
      </main>

      <section className="closing-cta"><h2>Start a conversation.<br /><mark>Make it yours.</mark></h2><div className="hero-actions"><Button asChild size="lg"><a href={DEPLOY}>Deploy your server <ArrowUpRight aria-hidden /></a></Button><Button asChild size="lg" variant="outline"><a href="#setup">Read the setup guide <ChevronRight aria-hidden /></a></Button></div></section>
      <footer className="site-footer"><div><a href="#top" className="wordmark"><MessageSquare strokeWidth={2.5} aria-hidden />Chat<span className="brand-dot" /></a><p>Open source. Built for your people.</p></div><div><a href="#setup">Setup guide</a><a href="#troubleshooting">Troubleshooting</a><a href={REPO}>GitHub <ArrowUpRight size={14} aria-hidden /></a></div><span className="footer-license">AGPL-3.0</span></footer>
    </div>
  );
}
