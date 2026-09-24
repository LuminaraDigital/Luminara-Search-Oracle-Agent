// Minimal YAML subset parser for self-hosted eval cases. Node stdlib only.
//
// Supported constructs (intentionally narrow, do not extend casually):
//   - A top-level list of maps: each item starts with "- key: value".
//   - String scalar values (inline). Double-quoted strings support \n escapes.
//   - Multi-line block scalars introduced by "|" with consistent indentation.
//   - One level of nested maps, only for the "provider:" and "expect:" keys.
//   - Nested-list values for "evidenceNumbers:" (ints) and
//     "mustContain:" / "mustNotContain:" (strings) inside a case or expect map.
// Everything else (anchors, flow maps, multi-doc, booleans beyond true/false,
// nesting deeper than one level) is unsupported and will throw.

function dequote(raw) {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1);
  }
  return s;
}

function scalar(raw) {
  const s = raw.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (s === '[]') return [];
  return dequote(s);
}

function indentOf(line) {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

export function parseYamlSubset(source) {
  const lines = String(source).replace(/\r\n/g, '\n').split('\n');
  const items = [];
  let i = 0;

  const NESTED_MAP_KEYS = new Set(['provider', 'expect']);
  const LIST_VALUE_KEYS = new Set(['evidenceNumbers', 'mustContain', 'mustNotContain']);

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const m = /^- ([^:]+):\s*(.*)$/.exec(line.trimEnd());
    if (!m) {
      throw new Error(`Unsupported YAML subset syntax at line ${i + 1}: ${line}`);
    }
    const item = {};
    // Parse the first key of this item plus following keys at same indent.
    const itemIndent = indentOf(line);
    let cur = { key: m[1].trim(), raw: m[2] };
    i++;
    let pending = cur;

    const readValue = (key, raw, keyIndent) => {
      if (raw.trim() === '|') {
        // Block scalar: consume following more-indented lines.
        const block = [];
        let blockIndent = -1;
        while (i < lines.length) {
          const bl = lines[i];
          if (bl.trim() === '') {
            block.push('');
            i++;
            continue;
          }
          const bi = indentOf(bl);
          if (bi <= keyIndent) break;
          if (blockIndent === -1) blockIndent = bi;
          block.push(bl.slice(Math.min(blockIndent, bl.length)));
          i++;
        }
        // Trim trailing blank lines only.
        while (block.length && block[block.length - 1] === '') block.pop();
        return block.join('\n');
      }
      if (raw.trim() === '') {
        // Could be a nested map (provider/expect) or a list value.
        if (NESTED_MAP_KEYS.has(key)) {
          const map = {};
          while (i < lines.length) {
            const nl = lines[i];
            if (nl.trim() === '') {
              i++;
              continue;
            }
            const ni = indentOf(nl);
            if (ni <= keyIndent) break;
            const km = /^([^:]+):\s*(.*)$/.exec(nl.trim());
            if (!km) throw new Error(`Bad nested map line ${i + 1}: ${nl}`);
            const nKey = km[1].trim();
            const nRaw = km[2];
            i++;
            if (nRaw.trim() === '' && LIST_VALUE_KEYS.has(nKey)) {
              const list = [];
              while (i < lines.length) {
                const ll = lines[i];
                if (ll.trim() === '') {
                  i++;
                  continue;
                }
                const li = ll.trim();
                if (li.startsWith('- ') && indentOf(ll) > ni) {
                  list.push(scalar(li.slice(2)));
                  i++;
                } else break;
              }
              map[nKey] = list;
            } else {
              map[nKey] = readValue(nKey, nRaw, ni);
            }
          }
          return map;
        }
        if (LIST_VALUE_KEYS.has(key)) {
          const list = [];
          while (i < lines.length) {
            const ll = lines[i];
            if (ll.trim() === '') {
              i++;
              continue;
            }
            if (ll.trim().startsWith('- ') && indentOf(ll) > keyIndent) {
              list.push(scalar(ll.trim().slice(2)));
              i++;
            } else break;
          }
          return list;
        }
        throw new Error(`Empty value for key "${key}" at line ${i + 1} is not a supported nested construct.`);
      }
      return scalar(raw);
    };

    item[cur.key] = readValue(cur.key, cur.raw, itemIndent + 2);

    // Remaining keys of the same item (same indent as the dash line content).
    while (i < lines.length) {
      const nl = lines[i];
      if (nl.trim() === '' || nl.trim().startsWith('#')) {
        i++;
        continue;
      }
      if (nl.trim().startsWith('- ')) break; // next item
      if (indentOf(nl) <= itemIndent) break;
      const km = /^([^:]+):\s*(.*)$/.exec(nl.trim());
      if (!km) throw new Error(`Bad key line ${i + 1}: ${nl}`);
      const key = km[1].trim();
      const raw = km[2];
      const keyIndent = indentOf(nl);
      i++;
      item[key] = readValue(key, raw, keyIndent);
    }

    items.push(item);
  }

  return items;
}
