import { useEffect, useRef, useState } from "react";

type Message = { id: number; author: string; text: string; liked?: boolean };
const examples: Record<string, Message[]> = {
  general: [
    { id: 1, author: "Sarah", text: "Welcome to the workshop 👋 What are you making this week?" },
    { id: 2, author: "James", text: "A little community for our weekend projects. Channels are ready!" },
    { id: 3, author: "Priya", text: "Try switching channels, sending a message, or adding a reaction below." },
  ],
  projects: [
    { id: 4, author: "James", text: "The first prototype is ready for a look. Bring your ideas to Friday’s meetup." },
    { id: 5, author: "Sarah", text: "I’ll bring the sketches. Let’s collect feedback here." },
  ],
  introductions: [{ id: 6, author: "Diego", text: "Hi! I build small things on the web. Happy to meet you all." }],
};

export function Demo() {
  const [channel, setChannel] = useState("general");
  const [messages, setMessages] = useState(examples);
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const scrollOnUpdate = useRef(false);
  useEffect(() => {
    if (scrollOnUpdate.current) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, channel]);
  function reset() {
    scrollOnUpdate.current = false;
    setMessages(examples); setChannel("general"); setDraft("");
  }
  return (
    <section id="demo" className="demo-section" aria-labelledby="demo-title">
      <div className="section-heading">
        <div><h2 id="demo-title">Take a look.<br /><mark>Make yourself at home.</mark></h2></div>
        <p>No account needed. This interactive preview runs in your browser. Messages are private to this tab and disappear on refresh. Voice, uploads and invitations are available on your own server.</p>
      </div>
      <div className="demo-window">
        <aside className="demo-sidebar">
          <strong>The workshop</strong><span>Sample community</span>
          <nav aria-label="Preview channels">{Object.keys(examples).map(name => (
            <button key={name} type="button" aria-pressed={channel === name} onClick={() => { scrollOnUpdate.current = false; setChannel(name); setDraft(""); }}># {name}</button>
          ))}</nav>
          <button className="demo-reset" type="button" onClick={reset}>Reset preview</button>
        </aside>
        <div className="demo-conversation">
          <h3># {channel}</h3>
          <div className="demo-messages" role="log" aria-label={`${channel} messages`} aria-live="polite">
            {messages[channel].map(message => (
              <article key={message.id}>
                <span className="demo-avatar" aria-hidden="true">{message.author[0]}</span>
                <div><strong>{message.author}</strong><p>{message.text}</p>
                  <button type="button" aria-label={`Like message from ${message.author}`} aria-pressed={Boolean(message.liked)} onClick={() => {
                    scrollOnUpdate.current = false;
                    setMessages(current => ({ ...current, [channel]: current[channel].map(m => m.id === message.id ? { ...m, liked: !m.liked } : m) }));
                  }}>♡ {message.liked ? 1 : 0}</button>
                </div>
              </article>
            ))}<div ref={end} />
          </div>
          <form onSubmit={event => {
            event.preventDefault();
            if (!draft.trim()) return;
            scrollOnUpdate.current = true;
            setMessages(current => ({ ...current, [channel]: [...current[channel], { id: Date.now(), author: "You", text: draft.trim() }].slice(-100) }));
            setDraft("");
          }}>
            <label className="sr-only" htmlFor="demo-message">Message in preview</label>
            <input id="demo-message" value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} placeholder={`Message #${channel}`} autoComplete="off" />
            <button type="submit" disabled={!draft.trim()}>Send</button>
          </form>
        </div>
      </div>
      <p className="demo-caption">A simplified preview of text chat. <a href="#walkthrough">Watch the real app in action ↓</a></p>
    </section>
  );
}
