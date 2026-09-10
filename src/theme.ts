/**
 * Central palette + metrics, shared by the pixi scene and the pixi widgets in
 * `src/ui`. The DOM screens keep their own copy of these values in
 * `src/creator/creator.css` — keep the two in step if you restyle.
 */
export const theme = {
  bg: 0x0b0d11,

  panelBg: 0x12151c,
  panelBorder: 0x222836,

  trackBg: 0x1a1f29,
  trackBorder: 0x2a3140,

  accent: 0x2fbfa8,
  danger: 0xff5c8a,

  textDim: 0x6b7686,
  textBright: 0xe8edf5,
} as const;

export const metrics = {
  panelPad: 18,
  radius: 10,
} as const;

export const fonts = {
  ui: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const;
