/**
 * Parsing for CHANGELOG.md, used by the updater to show what an update
 * contains before the user installs it.
 */

export type ChangelogSection = {
  version: string;
  title: string;
  body: string;
};

const HEADING = /^##\s+v?(\d+(?:\.\d+){1,3})\s*(?:[—–-]\s*)?(.*)$/;

/** Extract the first (newest) `## <version> — <title>` section. */
export function parseLatestSection(markdown: string): ChangelogSection | null {
  if (!markdown) return null;
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  let start = -1;
  let version = "";
  let title = "";
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(HEADING);
    if (match) {
      start = i;
      version = match[1];
      title = match[2].trim();
      break;
    }
  }
  if (start === -1) return null;

  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    body.push(lines[i]);
  }

  return { version, title, body: body.join("\n").trim() };
}

/**
 * Turn the section body into display lines. Only top-level bullets are kept
 * (wrapped continuation lines are folded into the previous bullet), and
 * inline backticks are removed for plain rendering.
 */
export function changelogBullets(body: string, limit = 8): string[] {
  const out: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      out.push(bullet[1].replace(/\*\*/g, "").replace(/__/g, "").replace(/`/g, "").trim());
    } else if (out.length && /^\s{2,}/.test(raw)) {
      out[out.length - 1] = `${out[out.length - 1]} ${line}`.replace(/`/g, "").trim();
    }
  }
  return out.slice(0, limit);
}
