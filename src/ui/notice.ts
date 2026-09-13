import { link } from "../router";

/**
 * The full-screen text layer the pixi routes show before they have anything
 * to draw: "loading", or why they never will.
 *
 * Plain DOM rather than pixi because it has to work when booting the canvas
 * is exactly what has not happened. Styled by `.boot-notice` in
 * `public/style.css`, which those routes already load.
 */
export function addNotice(root: HTMLElement, message: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "boot-notice";
  el.textContent = message;
  root.appendChild(el);
  return el;
}

/** Replace a notice with a failure the reader can act on. */
export function failNotice(
  el: HTMLElement,
  heading: string,
  detail: string,
): void {
  el.textContent = "";

  const title = document.createElement("strong");
  title.textContent = heading;

  const body = document.createElement("span");
  body.textContent = detail;

  const links = document.createElement("span");
  const game = document.createElement("a");
  game.href = link("/");
  game.textContent = "the host console";
  const creator = document.createElement("a");
  creator.href = link("/creator");
  creator.textContent = "the creator";
  links.append(game, document.createTextNode("  ·  "), creator);

  el.append(title, body, links);
}
