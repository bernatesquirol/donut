import { render } from "preact";
import "../screens.css";
import { ViewerApp } from "./ViewerApp";

export function mount(root: HTMLElement): void {
  render(<ViewerApp />, root);
}
