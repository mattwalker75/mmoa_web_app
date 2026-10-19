import { WindowConfig } from './models';

/**
 * Build the inline style for a website "window" (panel) from its config in
 * HTML/windows.json (served, fully merged, by GET /api/content). Shared by
 * the landing page and the site-wide footer so both honor the same contract.
 * Returns {} until config loads, so the .panel base styles apply (graceful
 * default chrome).
 */
export function windowStyle(w: WindowConfig | undefined): Record<string, string> {
  if (!w) return {};
  const style: Record<string, string> = {
    'background': w.background || 'transparent',
    'width': `min(${w.maxWidth}px, ${w.width}%)`,
    'border-radius': `${w.radius}px`,
    'border': (w.borderWidth > 0 && w.borderStyle !== 'none')
      ? `${w.borderWidth}px ${w.borderStyle} ${w.borderColor}`
      : 'none',
  };
  if (!w.shadow) style['box-shadow'] = 'none';
  if (w.textColor) style['color'] = w.textColor;
  // Escape hatch: any raw CSS property → value from windows.json, applied
  // last so it can override the named fields above.
  return { ...style, ...(w.style || {}) };
}
