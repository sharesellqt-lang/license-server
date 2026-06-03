const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

/* =========================================
CONFIG
========================================= */

const ROOT_DIR =
  path.join(
    __dirname,
    "../knowledge/raw/javascript/core/execution-model"
  );

const OUTPUT_DIR =
  path.join(
    __dirname,
    "../knowledge/fixed"
  );

/* =========================================
HELPERS
========================================= */

function walk(dir) {

  let results = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  for (const file of fs.readdirSync(dir)) {

    const full =
      path.join(dir, file);

    const stat =
      fs.statSync(full);

    if (stat.isDirectory()) {

      results =
        results.concat(
          walk(full)
        );

    } else if (
      file.endsWith(".md")
    ) {

      results.push(full);

    }
  }

  return results;
}

/* =========================================
MARKDOWN REPAIR
========================================= */

function normalizeLineEndings(md) {

  return md
    .replace(/\r/g, "")
    .replace(/\t/g, "  ");
}

function removeDuplicateFrontmatter(md) {

  return md.replace(
    /^---\n([\s\S]*?)\n---\n(?:---\n)+/m,
    "---\n$1\n---\n"
  );
}

function normalizeHeadingDepth(md) {

  return md.replace(
    /^(#{7,})\s+/gm,
    "###### "
  );
}

function repairCodeFences(md) {

  const count =
    (md.match(/```/g) || [])
      .length;

  if (count % 2 !== 0) {

    md += "\n```";
  }

  return md;
}

function normalizeLists(md) {

  return md.replace(
    /^\*\s+/gm,
    "- "
  );
}

function normalizeKnowledgeSections(md) {

  const mapping = [

    [/^#{3,}\s*Memory Basics/im,
      "## Definition"],

    [/^#{3,}\s*Reachability/im,
      "## Intuition"],

    [/^#{3,}\s*Execution Flow/im,
      "## Execution Flow"],

    [/^#{3,}\s*Mark and Sweep/im,
      "## Deep Dive"],

    [/^#{3,}\s*Common Mistake/im,
      "## Common Mistakes"],

    [/^#{3,}\s*Performance/im,
      "## Performance"],

    [/^#{3,}\s*Edge Cases/im,
      "## Edge Cases"],

    [/^#{3,}\s*Engine Internals/im,
      "## Engine Internals"],

    [/^#{3,}\s*Real World/im,
      "## Real World"],

    [/^#{3,}\s*Security/im,
      "## Security"],

    [/^#{3,}\s*Related Concepts/im,
      "## Related Concepts"],

    [/^#{3,}\s*Learn Next/im,
      "## Learn Next"],

    [/^#{3,}\s*Summary/im,
      "## Summary"]

  ];

  for (const [regex, replace] of mapping) {

    md = md.replace(
      regex,
      replace
    );
  }

  return md;
}

function normalizeYamlValues(yaml) {

  yaml = yaml.replace(
    /^estimated_time:\s*(.+)$/gm,
    'estimated_time: "$1"'
  );

  yaml = yaml.replace(
    /^importance:\s*high$/gm,
    "importance: 5"
  );

  yaml = yaml.replace(
    /^importance:\s*medium$/gm,
    "importance: 3"
  );

  yaml = yaml.replace(
    /^importance:\s*low$/gm,
    "importance: 1"
  );

  return yaml;
}

/* =========================================
FRONTMATTER REPAIR
========================================= */

function repairFrontmatter(md) {

  if (!md.startsWith("---")) {
    return md;
  }

  const match =
    md.match(
      /^---\n([\s\S]*?)\n---\n?/
    );

  if (!match) {
    return md;
  }

  let yaml =
    match[1];

  yaml =
    normalizeYamlValues(
      yaml
    );

  const body =
    md.slice(
      match[0].length
    );

  const ROOT_FIELDS =
    new Set([
      "id",
      "title",
      "category",
      "tags",
      "summary",
      "difficulty",
      "importance",
      "estimated_time",
      "access",
      "prerequisites",
      "related",
      "next"
    ]);

  const out = [];

  let mode = null;

  for (let raw of yaml.split("\n")) {

    raw =
      raw.replace(
        /\s+$/,
        ""
      );

    const trimmed =
      raw.trim();

    if (!trimmed) {

      out.push("");

      continue;
    }

    const field =
      trimmed.match(
        /^([a-zA-Z_]+):/
      );

    if (
      field &&
      ROOT_FIELDS.has(
        field[1]
      )
    ) {

      mode =
        field[1];

      out.push(
        trimmed
      );

      continue;
    }

    if (
      mode === "tags"
    ) {

      if (
        /^\*/.test(
          trimmed
        )
      ) {

        out.push(
          "  - " +
          trimmed.replace(
            /^\*\s*/,
            ""
          )
        );

        continue;
      }

      if (
        /^-\s/.test(
          trimmed
        )
      ) {

        out.push(
          "  " +
          trimmed
        );

        continue;
      }
    }

    if (
      mode === "summary"
    ) {

      out.push(
        "  " +
        trimmed
      );

      continue;
    }

    out.push(
      trimmed
    );
  }

  return [
    "---",
    out.join("\n"),
    "---",
    body
  ].join("\n");
}

/* =========================================
PIPELINE
========================================= */

function repairMarkdown(md) {

  md =
    normalizeLineEndings(
      md
    );

  md =
    removeDuplicateFrontmatter(
      md
    );

  md =
    normalizeHeadingDepth(
      md
    );

  md =
    normalizeKnowledgeSections(
      md
    );

  md =
    normalizeLists(
      md
    );

  md =
    repairCodeFences(
      md
    );

  md =
    repairFrontmatter(
      md
    );

  return md;
}

/* =========================================
VALIDATE
========================================= */

function validate(md) {

  try {

    matter(md);

    return true;

  } catch {

    return false;
  }
}

/* =========================================
WRITE
========================================= */

function writeOutput(
  inputPath,
  content
) {

  const relative =
    path.relative(
      ROOT_DIR,
      inputPath
    );

  const output =
    path.join(
      OUTPUT_DIR,
      relative
    );

  fs.mkdirSync(
    path.dirname(
      output
    ),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    output,
    content,
    "utf8"
  );
}

/* =========================================
RUN
========================================= */

function run() {

  const files =
    walk(ROOT_DIR);

  let fixed = 0;

  for (const file of files) {

    try {

      const raw =
        fs.readFileSync(
          file,
          "utf8"
        );

      const repaired =
        repairMarkdown(
          raw
        );

      const ok =
        validate(
          repaired
        );

      writeOutput(
        file,
        repaired
      );

      console.log(
        ok
          ? "✅"
          : "⚠️",
        file
      );

      if (
        raw !== repaired
      ) {

        fixed++;
      }

    } catch(err) {

      console.error(
        "❌",
        file
      );

      console.error(
        err.message
      );
    }
  }

  console.log(
    "\nFILES FIXED:",
    fixed
  );
}

run();