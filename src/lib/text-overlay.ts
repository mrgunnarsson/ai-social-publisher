export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const TEXT_OVERLAY_SAFE_MARGIN = 60;
export const TEXT_OVERLAY_MAX_WIDTH =
  REEL_WIDTH - TEXT_OVERLAY_SAFE_MARGIN * 2;
export const TEXT_OVERLAY_FONT_FAMILY =
  "Arial, Helvetica, sans-serif";
export const TEXT_OVERLAY_FONT_WEIGHT = 700;
export const TEXT_OVERLAY_LINE_HEIGHT = 1.25;
export const TEXT_OVERLAY_STROKE_WIDTH = 6;

const LEGACY_PREVIEW_WIDTH = 384;

export type LegacyTextPosition =
  | "top"
  | "center"
  | "bottom";

export type TextOverlayPosition = {
  x: number;
  y: number;
};

export type CanonicalTextOverlay = {
  version: 2;
  x: number;
  y: number;
  fontSize: number;
};

export type TextOverlayLine = {
  text: string;
  width: number;
  y: number;
};

export type TextOverlayLayout = {
  centerX: number;
  centerY: number;
  fontSize: number;
  lineHeight: number;
  lines: TextOverlayLine[];
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.min(max, Math.max(min, value));
}

export function getPresetOverlayPosition(
  position: LegacyTextPosition
): TextOverlayPosition {
  switch (position) {
    case "top":
      return { x: 0.5, y: 0.16 };
    case "center":
      return { x: 0.5, y: 0.5 };
    case "bottom":
    default:
      return { x: 0.5, y: 0.82 };
  }
}

export function legacyFontSizeToCanonical(
  fontSize: number
) {
  return (
    clamp(Number(fontSize) || 48, 20, 96) *
    (REEL_WIDTH / LEGACY_PREVIEW_WIDTH)
  );
}

export function createCanonicalTextOverlay({
  position,
  fontSize,
}: {
  position: TextOverlayPosition;
  fontSize: number;
}): CanonicalTextOverlay {
  return {
    version: 2,
    x: clamp(position.x, 0, 1),
    y: clamp(position.y, 0, 1),
    fontSize: legacyFontSizeToCanonical(fontSize),
  };
}

export function resolveCanonicalTextOverlay({
  overlay,
  legacyPosition,
  legacyFontSize,
}: {
  overlay?: Partial<CanonicalTextOverlay> | null;
  legacyPosition: LegacyTextPosition;
  legacyFontSize: number;
}): CanonicalTextOverlay {
  if (
    overlay?.version === 2 &&
    Number.isFinite(overlay.x) &&
    Number.isFinite(overlay.y) &&
    Number.isFinite(overlay.fontSize)
  ) {
    return {
      version: 2,
      x: clamp(Number(overlay.x), 0, 1),
      y: clamp(Number(overlay.y), 0, 1),
      fontSize: clamp(
        Number(overlay.fontSize),
        legacyFontSizeToCanonical(20),
        legacyFontSizeToCanonical(96)
      ),
    };
  }

  const position =
    getPresetOverlayPosition(legacyPosition);

  return createCanonicalTextOverlay({
    position,
    fontSize: legacyFontSize,
  });
}

function getCharacterWidthFactor(
  character: string
) {
  if (/\s/.test(character)) return 0.34;
  if (/[ilI1|!.,'`:;]/.test(character)) return 0.3;
  if (/[MW@#%&QG]/.test(character)) return 0.92;
  if (/[mw]/.test(character)) return 0.82;
  if (/[A-ZÅÄÖ]/.test(character)) return 0.7;
  if (/[0-9]/.test(character)) return 0.58;
  if (/[-_()[\]{}?/\\+*=]/.test(character)) return 0.44;
  return 0.58;
}

export function estimateTextWidth(
  text: string,
  fontSize: number
) {
  return Array.from(text).reduce(
    (width, character) =>
      width +
      getCharacterWidthFactor(character) *
        fontSize,
    0
  );
}

function splitLongWord(
  word: string,
  fontSize: number,
  maxWidth: number
) {
  const pieces: string[] = [];
  let piece = "";

  for (const character of Array.from(word)) {
    const candidate = piece + character;

    if (
      piece &&
      estimateTextWidth(candidate, fontSize) >
        maxWidth
    ) {
      pieces.push(piece);
      piece = character;
    } else {
      piece = candidate;
    }
  }

  if (piece) pieces.push(piece);
  return pieces;
}

function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number
) {
  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/);

    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    let line = "";

    for (const word of words) {
      const pieces =
        estimateTextWidth(word, fontSize) >
        maxWidth
          ? splitLongWord(
              word,
              fontSize,
              maxWidth
            )
          : [word];

      for (const piece of pieces) {
        const candidate = line
          ? `${line} ${piece}`
          : piece;

        if (
          line &&
          estimateTextWidth(candidate, fontSize) >
            maxWidth
        ) {
          lines.push(line);
          line = piece;
        } else {
          line = candidate;
        }
      }
    }

    lines.push(line);
  }

  return lines.length ? lines : [""];
}

function getFittedText(
  text: string,
  requestedFontSize: number
) {
  const maxLineWidth =
    TEXT_OVERLAY_MAX_WIDTH -
    TEXT_OVERLAY_STROKE_WIDTH * 2;
  const maxHeight =
    REEL_HEIGHT - TEXT_OVERLAY_SAFE_MARGIN * 2;

  let fontSize = requestedFontSize;
  let lines = wrapText(
    text,
    fontSize,
    maxLineWidth
  );

  for (let attempt = 0; attempt < 12; attempt++) {
    const lineHeight =
      fontSize * TEXT_OVERLAY_LINE_HEIGHT;
    const height =
      (lines.length - 1) * lineHeight +
      fontSize +
      TEXT_OVERLAY_STROKE_WIDTH * 2;

    if (height <= maxHeight) break;

    fontSize = Math.max(
      1,
      fontSize * (maxHeight / height) * 0.98
    );
    lines = wrapText(
      text,
      fontSize,
      maxLineWidth
    );
  }

  return { fontSize, lines };
}

export function layoutTextOverlay(
  text: string,
  overlay: CanonicalTextOverlay
): TextOverlayLayout {
  const fitted = getFittedText(
    text,
    overlay.fontSize
  );
  const lineHeight =
    fitted.fontSize * TEXT_OVERLAY_LINE_HEIGHT;
  const lineWidths = fitted.lines.map((line) =>
    Math.min(
      TEXT_OVERLAY_MAX_WIDTH -
        TEXT_OVERLAY_STROKE_WIDTH * 2,
      estimateTextWidth(line, fitted.fontSize)
    )
  );
  const textWidth = Math.max(0, ...lineWidths);
  const boundsWidth =
    textWidth + TEXT_OVERLAY_STROKE_WIDTH * 2;
  const boundsHeight =
    (fitted.lines.length - 1) * lineHeight +
    fitted.fontSize +
    TEXT_OVERLAY_STROKE_WIDTH * 2;
  const requestedCenterX =
    overlay.x * REEL_WIDTH;
  const requestedCenterY =
    overlay.y * REEL_HEIGHT;
  const centerX = clamp(
    requestedCenterX,
    TEXT_OVERLAY_SAFE_MARGIN + boundsWidth / 2,
    REEL_WIDTH -
      TEXT_OVERLAY_SAFE_MARGIN -
      boundsWidth / 2
  );
  const centerY = clamp(
    requestedCenterY,
    TEXT_OVERLAY_SAFE_MARGIN + boundsHeight / 2,
    REEL_HEIGHT -
      TEXT_OVERLAY_SAFE_MARGIN -
      boundsHeight / 2
  );
  const firstLineY =
    centerY -
    ((fitted.lines.length - 1) * lineHeight) /
      2;

  return {
    centerX,
    centerY,
    fontSize: fitted.fontSize,
    lineHeight,
    lines: fitted.lines.map((line, index) => ({
      text: line,
      width: lineWidths[index],
      y: firstLineY + index * lineHeight,
    })),
    bounds: {
      x: centerX - boundsWidth / 2,
      y: centerY - boundsHeight / 2,
      width: boundsWidth,
      height: boundsHeight,
    },
  };
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildTextOverlaySvg({
  text,
  overlay,
  color,
}: {
  text: string;
  overlay: CanonicalTextOverlay;
  color: "white" | "black";
}) {
  const layout = layoutTextOverlay(text, overlay);
  const strokeColor =
    color === "white"
      ? "rgba(0,0,0,0.85)"
      : "rgba(255,255,255,0.7)";
  const lines = layout.lines
    .map(
      (line) => `
      <text
        x="${layout.centerX}"
        y="${line.y}"
        textLength="${Math.max(1, line.width)}"
        lengthAdjust="spacingAndGlyphs"
        xml:space="preserve"
      >${escapeXml(line.text || " ")}</text>`
    )
    .join("");

  return `<svg
    width="${REEL_WIDTH}"
    height="${REEL_HEIGHT}"
    viewBox="0 0 ${REEL_WIDTH} ${REEL_HEIGHT}"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g
      font-family="${TEXT_OVERLAY_FONT_FAMILY}"
      font-size="${layout.fontSize}"
      font-weight="${TEXT_OVERLAY_FONT_WEIGHT}"
      font-style="normal"
      text-anchor="middle"
      dominant-baseline="central"
      fill="${color}"
      stroke="${strokeColor}"
      stroke-width="${TEXT_OVERLAY_STROKE_WIDTH}"
      stroke-linejoin="round"
      paint-order="stroke fill"
    >${lines}
    </g>
  </svg>`;
}

export function textOverlaySvgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    svg
  )}`;
}
