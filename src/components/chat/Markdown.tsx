import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/**
 * Lightweight, safe Markdown. react-markdown never renders raw HTML; we
 * further restrict the element set and only allow http(s)/mailto links.
 */
const ALLOWED = ["p", "br", "strong", "em", "del", "code", "pre", "a", "blockquote", "ul", "ol", "li", "text"];

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
      {children}
    </a>
  ),
  // Headings and images are flattened to plain text/links to keep chat dense.
  h1: ({ children }) => <p>{children}</p>,
  h2: ({ children }) => <p>{children}</p>,
  h3: ({ children }) => <p>{children}</p>,
  h4: ({ children }) => <p>{children}</p>,
  h5: ({ children }) => <p>{children}</p>,
  h6: ({ children }) => <p>{children}</p>,
  img: ({ src, alt }) =>
    typeof src === "string" ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow ugc">
        {alt || src}
      </a>
    ) : null,
  hr: () => null,
  table: ({ children }) => <div className="overflow-x-auto text-xs">{children}</div>,
  input: () => null,
};

function urlTransform(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  return "";
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      allowedElements={[...ALLOWED, "h1", "h2", "h3", "h4", "h5", "h6", "img", "hr", "table", "thead", "tbody", "tr", "th", "td", "input"]}
      unwrapDisallowed
      skipHtml
      urlTransform={urlTransform}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
});
