import type { ReactNode } from "react";
import { ChevronDown, Code2, MessageSquare, Mic, Server, Shield, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

const REPO = "https://github.com/waltzaround/beacon";
const DEPLOY = `https://deploy.workers.cloudflare.com/?url=${REPO}`;

function Section({ id, eyebrow, title, intro, children }: { id: string; eyebrow: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16">
      <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h2>
      {intro ? <p className="mt-2 text-muted-foreground">{intro}</p> : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted p-4 text-sm"><code className="bg-transparent p-0">{children}</code></pre>;
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
    <details className="group rounded-lg border border-border bg-card px-4 [&_p]:text-muted-foreground">
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
  { icon: Smartphone, title: "Every platform", text: "Web, installable PWA, Windows and macOS apps, and native iOS and Android apps." },
  { icon: Shield, title: "Yours", text: "Your data lives in your own Cloudflare account. Moderation, backups and exports built in." },
];

export function App() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3 text-sm" aria-label="Main">
          <a href="#" className="flex items-center gap-2 font-semibold"><Server className="size-5" aria-hidden />Beacon Chat</a>
          <div className="ml-auto flex items-center gap-5 font-mono text-xs text-muted-foreground max-sm:hidden">
            <a href="#setup" className="hover:text-foreground">Setup</a>
            <a href="#faq" className="hover:text-foreground">FAQ</a>
            <a href="#troubleshooting" className="hover:text-foreground">Troubleshooting</a>
          </div>
          <Button asChild size="sm" variant="secondary" className="max-sm:ml-auto"><a href={REPO}><Code2 aria-hidden />GitHub</a></Button>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-4 pt-20 pb-12 text-center">
          <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">Self-hosted · Open source · Cloudflare</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">Your own community chat</h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            A Discord-style chat server you run yourself on Cloudflare. It fits in the free plan, and there's nothing to configure.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg"><a href={DEPLOY}>Deploy to Cloudflare</a></Button>
            <Button asChild size="lg" variant="secondary"><a href="#setup">Read the setup guide</a></Button>
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-4 px-4 pb-8 sm:grid-cols-2 lg:grid-cols-4" aria-label="Features">
          {features.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-5">
              <Icon className="size-5 text-muted-foreground" aria-hidden />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </section>

        <Section id="setup" eyebrow="Setup" title="How to set it up" intro="You need a Cloudflare account. The free plan is enough, and you can sign up along the way.">
          <h3 className="mb-6 text-lg font-semibold">Option 1: the deploy button (nothing to install)</h3>
          <ol>
            <Step n={1} title="Click Deploy to Cloudflare">
              <p>Log in to Cloudflare, or choose <strong>Sign up</strong>.</p>
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
          <Code>{`git clone ${REPO}.git && cd beacon
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

        <Section id="faq" eyebrow="Questions" title="FAQ">
          <div className="space-y-3">
            <Question q="How much does it cost?">
              <p>Nothing for most communities: it runs on Cloudflare's free plan. Email needs the Workers Paid plan ($5 a month). Voice and video are billed by RealtimeKit usage.</p>
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

        <Section id="troubleshooting" eyebrow="Help" title="Troubleshooting">
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
              <p>Check the address in a browser: <code>https://your-server/api/instance</code> should show <code>beacon-chat</code>. If it doesn't load, the server is down or the address is wrong. Older servers need <code>npm run update</code> and a deploy.</p>
            </Question>
            <Question q="The update pull request never appears">
              <p>In your repo's Settings → Actions → General, turn on <strong>Allow GitHub Actions to create and approve pull requests</strong>.</p>
            </Question>
          </div>
        </Section>
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        Open source. <a href={REPO} className="link hover:text-foreground">View on GitHub</a>
      </footer>
    </div>
  );
}
