// Font Awesome icons rendered as inline SVG at build time (the site's CSP
// does not allow icon fonts from CDNs). Matches the original site's icons.
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

export function faSvg(d: IconDefinition, cls = 'fa'): string {
  const [w, h, , , path] = d.icon;
  const p = Array.isArray(path) ? path.join(' ') : path;
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" style="width:${(w / h).toFixed(4)}em;height:1em" aria-hidden="true" focusable="false"><path fill="currentColor" d="${p}"/></svg>`;
}
