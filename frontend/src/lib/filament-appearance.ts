function normalizeDisplayHex(value?: string | null): string | null {
  if (typeof value !== "string") return null;

  const raw = value.trim().replace(/^#/, "");
  if (!raw) return null;

  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .split("")
      .map((ch) => ch + ch)
      .join("")
      .toUpperCase()}`;
  }

  if (/^[0-9a-fA-F]{4}$/.test(raw)) {
    return `#${raw
      .slice(1)
      .split("")
      .map((ch) => ch + ch)
      .join("")
      .toUpperCase()}`;
  }

  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toUpperCase()}`;
  }

  // Future-proof for AARRGGBB values by using the visible RGB portion.
  if (/^[0-9a-fA-F]{8}$/.test(raw)) {
    return `#${raw.slice(2).toUpperCase()}`;
  }

  return null;
}

function hexToRgba(value: string, alpha: number): string {
  const hex = normalizeDisplayHex(value);
  if (!hex) return `rgba(100, 116, 139, ${alpha})`;

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getVisibleHexColor(
  value?: string | null,
  fallback = "var(--border)",
): string {
  return normalizeDisplayHex(value) || fallback;
}

export function buildFilamentHeroStyle(
  filament:
    | {
        colors?: Array<{ color?: { hex_code?: string | null } }>;
        multi_color_style?: string | null;
      }
    | null
    | undefined,
  fallbackStyle = "background: var(--bg-soft); border: 1px solid var(--border);",
): string {
  const hexes = (filament?.colors || [])
    .map((fc) => normalizeDisplayHex(fc.color?.hex_code))
    .filter((hex): hex is string => Boolean(hex));

  if (hexes.length === 0) return fallbackStyle;

  if (hexes.length === 1) {
    const hex = hexes[0];
    return [
      `background-color: ${hexToRgba(hex, 0.12)}`,
      `background-image: linear-gradient(135deg, ${hexToRgba(hex, 0.24)} 0%, ${hexToRgba(hex, 0.1)} 55%, rgba(15, 23, 42, 0.08) 100%)`,
      `border: 1px solid ${hexToRgba(hex, 0.5)}`,
    ].join("; ");
  }

  if (filament?.multi_color_style === "gradient") {
    const step = hexes.length === 1 ? 100 : 100 / (hexes.length - 1);
    const stops = hexes
      .map(
        (hex, index) => `${hexToRgba(hex, 0.22)} ${(index * step).toFixed(2)}%`,
      )
      .join(", ");

    return [
      "background-color: color-mix(in srgb, var(--bg-soft) 82%, transparent)",
      `background-image: linear-gradient(to bottom, ${stops})`,
      `border: 1px solid ${hexToRgba(hexes[0], 0.5)}`,
    ].join("; ");
  }

  const segmentSize = 100 / hexes.length;
  const stops = hexes
    .map((hex, index) => {
      const start = (index * segmentSize).toFixed(2);
      const end = ((index + 1) * segmentSize).toFixed(2);
      const rgba = hexToRgba(hex, 0.2);
      return `${rgba} ${start}% ${end}%`;
    })
    .join(", ");

  return [
    "background-color: color-mix(in srgb, var(--bg-soft) 82%, transparent)",
    `background-image: linear-gradient(to right, ${stops})`,
    `border: 1px solid ${hexToRgba(hexes[0], 0.5)}`,
  ].join("; ");
}
