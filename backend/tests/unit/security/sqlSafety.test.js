const fs = require("fs");
const path = require("path");

// Static guard for the 49.3 SQL/query-safety review.
//
// Prisma's tagged-template APIs parameterize every interpolation. The unsafe
// variants (`$queryRawUnsafe`, `$executeRawUnsafe`, `Prisma.raw`) bypass that
// guarantee, so they must never appear in application code. A raw call must be
// either a tagged template or `Prisma.sql` composition, never a plain string.

const SOURCE_ROOT = path.resolve(__dirname, "../../../src");

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return listJavaScriptFiles(fullPath);
    }

    return entry.isFile() && entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

function relative(file) {
  return path.relative(SOURCE_ROOT, file);
}

describe("SQL query safety", () => {
  const files = listJavaScriptFiles(SOURCE_ROOT);

  test("contains no unsafe Prisma raw APIs", () => {
    const offenders = [];

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");

      for (const pattern of [
        /\$queryRawUnsafe\b/,
        /\$executeRawUnsafe\b/,
        /\bPrisma\.raw\b/,
      ]) {
        if (pattern.test(source)) {
          offenders.push(relative(file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("every raw call is a tagged template or Prisma.sql composition", () => {
    const offenders = [];
    const rawCall = /\$(?:query|execute)Raw\s*([`(])/g;

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      let match;

      while ((match = rawCall.exec(source)) !== null) {
        if (match[1] === "`") {
          continue;
        }

        // A parenthesized call is only safe when it composes Prisma.sql.
        const lookahead = source.slice(match.index, match.index + 80);

        if (!/^\$(?:query|execute)Raw\s*\(\s*Prisma\.sql\b/.test(lookahead)) {
          offenders.push(`${relative(file)}:${match.index}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("raw SQL files use parameter placeholders rather than interpolation", () => {
    const offenders = [];

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");

      // A `${...}` inside a tagged template is a bound parameter. String
      // concatenation or a template literal built outside the tag would be
      // visible as a quoted SQL fragment with a concatenation operator.
      if (/\+\s*["'`]\s*(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(source)) {
        offenders.push(relative(file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
