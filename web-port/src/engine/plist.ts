// Minimal plist (XML property list) parser — dependency-free so it runs in
// both the browser and node tests. Returns plain JS values.
export type PlistValue = string | number | boolean | PlistValue[] | { [k: string]: PlistValue };

export function parsePlist(xml: string): PlistValue {
  let i = 0;
  const skipWs = () => { while (i < xml.length && /\s/.test(xml[i])) i++; };
  const error = (msg: string): never => { throw new Error(`plist parse @${i}: ${msg}`); };

  function parseTag(): { name: string; selfClose: boolean } {
    skipWs();
    if (xml[i] !== "<") error("expected <");
    // skip declarations / comments / doctype
    while (xml.startsWith("<?", i) || xml.startsWith("<!--", i) || xml.startsWith("<!", i)) {
      const end = xml.indexOf(">", i);
      i = end + 1;
      skipWs();
    }
    if (xml[i] !== "<") error("expected <");
    const end = xml.indexOf(">", i);
    if (end < 0) error("unclosed tag");
    const inner = xml.slice(i + 1, end).trim();
    i = end + 1;
    return { name: inner.replace(/\/$/, "").trim(), selfClose: inner.endsWith("/") };
  }

  function parseText(): string {
    const end = xml.indexOf("<", i);
    const text = xml.slice(i, end < 0 ? xml.length : end);
    i = end < 0 ? xml.length : end;
    return decodeEntities(text.trim());
  }

  function parseValue(): PlistValue {
    const { name, selfClose } = parseTag();
    switch (name) {
      case "true": return true;
      case "false": return false;
      case "string":
      case "data": {
        if (selfClose) return "";
        const t = parseText();
        closeTag(name);
        return t;
      }
      case "integer": {
        const t = parseText();
        closeTag(name);
        return parseInt(t, 10);
      }
      case "real": {
        const t = parseText();
        closeTag(name);
        return parseFloat(t);
      }
      case "array": {
        if (selfClose) return [];
        const arr: PlistValue[] = [];
        while (true) {
          skipWs();
          if (xml.startsWith("</array>", i)) { i += 8; return arr; }
          arr.push(parseValue());
        }
      }
      case "dict": {
        if (selfClose) return {};
        const obj: { [k: string]: PlistValue } = {};
        while (true) {
          skipWs();
          if (xml.startsWith("</dict>", i)) { i += 7; return obj; }
          const keyTag = parseTag();
          if (keyTag.name !== "key") error(`expected <key>, got <${keyTag.name}>`);
          const key = parseText();
          closeTag("key");
          obj[key] = parseValue();
        }
      }
      default:
        return error(`unknown tag <${name}>`);
    }
  }

  function closeTag(name: string) {
    skipWs();
    if (!xml.startsWith(`</${name}>`, i)) error(`expected </${name}>`);
    i += name.length + 3;
  }

  // skip xml prolog/doctype, find <plist>
  while (true) {
    skipWs();
    if (xml.startsWith("<plist", i)) {
      i = xml.indexOf(">", i) + 1;
      break;
    }
    i = xml.indexOf(">", i) + 1;
    if (i <= 0) error("no <plist> root");
  }
  skipWs();
  return parseValue();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}
