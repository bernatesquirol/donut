import { useState } from "preact/hooks";
import { absoluteLink } from "../router";

interface Props {
  /** Base-relative path, e.g. `/play?id=…`. */
  path: string;
  /** What the link is for. */
  label: string;
}

/**
 * One shareable link: followable, readable, and copyable.
 *
 * The full URL is on show rather than hidden behind the button because these
 * get read out and retyped as often as they get pasted, and because a host
 * about to send one wants to see which machine it points at.
 */
export function CopyLink({ path, label }: Props) {
  const href = absoluteLink(path);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access needs a secure context and can be refused outright;
      // the URL is on screen either way, so this is not worth an error.
      setCopied(false);
    }
  }

  return (
    <li>
      <a href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
      <span class="grow" />
      <code class="muted link-url">{href}</code>
      <button class="sm" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </li>
  );
}
