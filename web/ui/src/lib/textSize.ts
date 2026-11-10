export const TEXT_SIZES = { small: 1, default: 1.1, large: 1.2 } as const;
export type TextSize = keyof typeof TEXT_SIZES;

export function getTextSize(): TextSize {
  try {
    const v = localStorage.getItem("textSize");
    if (v && v in TEXT_SIZES) return v as TextSize;
  } catch {
    /* storage unavailable */
  }
  return "default";
}

/** Scales the whole UI, including menus and dialogs rendered outside #root. */
export function applyTextSize(size: TextSize) {
  document.documentElement.style.zoom = String(TEXT_SIZES[size]);
  try {
    localStorage.setItem("textSize", size);
  } catch {
    /* storage unavailable */
  }
}

/** Viewport width in the page's (zoomed) CSS pixels, for layout limits. */
export const viewportWidth = () => window.innerWidth / (Number(document.documentElement.style.zoom) || 1);
