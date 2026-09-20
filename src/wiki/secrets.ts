/**
 * A `:::secret` ... `:::` block convention for hiding GM-only prose from player view, without
 * touching the line-based Markdown renderer (see markdown.ts) — filtering happens on the raw body
 * text before it's ever handed to renderMarkdown. Each marker must be alone on its own line, same
 * convention style as a fenced code block. See wiki/SCHEMA.md.
 */
const SECRET_START = /^:::secret\s*$/;
const SECRET_END = /^:::\s*$/;

export interface BodySegment {
  text: string;
  secret: boolean;
}

/** Splits body text into alternating public/secret segments. An unterminated `:::secret` block
 *  (no closing `:::`) runs to the end of the document — simple, predictable, matches how an
 *  unterminated fenced code block behaves elsewhere. */
export function splitSecretSegments(body: string): BodySegment[] {
  const lines = body.split("\n");
  const segments: BodySegment[] = [];
  let current: string[] = [];
  let inSecret = false;

  const flush = (): void => {
    if (current.length) segments.push({ text: current.join("\n"), secret: inSecret });
    current = [];
  };

  for (const line of lines) {
    if (!inSecret && SECRET_START.test(line)) {
      flush();
      inSecret = true;
      continue;
    }
    if (inSecret && SECRET_END.test(line)) {
      flush();
      inSecret = false;
      continue;
    }
    current.push(line);
  }
  flush();
  return segments;
}

/** The body with every `:::secret` block removed — what a player-view render sees. */
export function stripSecrets(body: string): string {
  return splitSecretSegments(body)
    .filter(segment => !segment.secret)
    .map(segment => segment.text)
    .join("\n");
}

/** Whether this body has any `:::secret` block at all — drives a "has secret content" indicator
 *  shown only in GM view. */
export function hasSecretContent(body: string): boolean {
  return splitSecretSegments(body).some(segment => segment.secret);
}
