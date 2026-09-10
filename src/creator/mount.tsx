import { render } from "preact";
import "../screens.css";
import { CreatorApp } from "./CreatorApp";

export function mount(root: HTMLElement): void {
  render(<CreatorApp />, root);
}
