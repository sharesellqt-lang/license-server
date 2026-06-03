const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

const ROOT_DIR = path.join(
  __dirname,
  "../knowledge/raw/javascript/core/runtime-model"
);

/* =========================================================
   WALK DIRECTORY
========================================================= */

function walkDir(target) {

  if (!fs.existsSync(target)) {
    return [];
  }

  const stat = fs.statSync(target);

  // single markdown file
  if (stat.isFile()) {

    return target.endsWith(".md")
      ? [target]
      : [];
  }

  let results = [];

  const files = fs.readdirSync(target);

  files.forEach(file => {

    const filePath = path.join(target, file);

    const childStat = fs.statSync(filePath);

    if (childStat.isDirectory()) {

      results = results.concat(
        walkDir(filePath)
      );

    } else if (file.endsWith(".md")) {

      results.push(filePath);
    }
  });

  return results;
}

/* =========================================================
   HELPERS
========================================================= */

function isHeading(line = "") {
  return /^#{1,6}\s+/.test(line.trim());
}

function getHeadingLevel(line = "") {

  const match =
    line.trim().match(/^(#{1,6})\s+/);

  return match
    ? match[1].length
    : 0;
}

function getHeadingText(line = "") {

  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .trim();
}

function isFence(line = "") {
  return /^```/.test(line.trim());
}

function isHorizontalRule(line = "") {
  return /^-{3,}$/.test(line.trim());
}

function isEmpty(line = "") {
  return line.trim() === "";
}

function isList(line = "") {
  return /^(\-|\*|\+)\s+/.test(line.trim());
}

function isOrderedList(line = "") {
  return /^\d+\.\s+/.test(line.trim());
}

function normalizeList(line = "") {

  return line
    .trim()
    .replace(/^(\*|\+)\s+/, "- ");
}

/* =========================================================
   HEADING HIERARCHY REPAIR
========================================================= */

function repairHeadingHierarchy(lines) {

  const repaired = [];

  let inCodeBlock = false;

  const headingStack = [];

  const SECTION = 2;
  const SUB = 3;
  const SUBSUB = 4;

  const sectionPatterns = [
    /^definition$/i,
    /^intuition$/i,
    /^visualization$/i,
    /^mental model$/i,
    /^core responsibilities$/i,
    /^parsing phase$/i,
    /^interpreter$/i,
    /^jit/i,
    /^execution context$/i,
    /^garbage collection$/i,
    /^performance$/i,
    /^security$/i,
    /^edge cases?/i,
    /^common bugs?/i,
    /^related concepts?$/i,
    /^learn next$/i,
    /^summary$/i,
    /^real world/i,
    /^engine internals?/i,
    /^deoptimization$/i,
    /^inline caching/i,
    /^deoptimization/i,
    /^execution context/i,
    /^garbage collection/i,
    /^real world/i,
    /^common bugs?/i,
    /^performance/i,
    /^edge cases?/i,
    /^security/i,
    /^related concepts?/i,
    /^learn next/i,
    /^summary/i
  ];

  const subsectionPatterns = [
    /^example/i,
    /^deep dive/i,
    /^tokenization$/i,
    /^source code$/i,
    /^call stack$/i,
    /^bytecode/i,
    /^hot functions$/i,
    /^optimization pipeline$/i,
    /^inline caching$/i,
    /^prototype pollution$/i,
    /^popular javascript engines$/i,
    /^stable types/i,
    /^memory leak$/i,
    /^bug \d+/i,
    /^edge case \d+/i
  ];

  function matches(text, patterns) {

    return patterns.some(
      pattern => pattern.test(text)
    );
  }

  for (let i = 0; i < lines.length; i++) {

    let line = lines[i];

    const trimmed = line.trim();

    /* =========================================
       CODE BLOCK
    ========================================= */

    if (isFence(trimmed)) {

      inCodeBlock = !inCodeBlock;

      repaired.push(line);

      continue;
    }

    if (inCodeBlock) {

      repaired.push(line);

      continue;
    }

    /* =========================================
       NORMAL TEXT
    ========================================= */

    if (!isHeading(trimmed)) {

      repaired.push(line);

      continue;
    }

    const text =
      getHeadingText(trimmed);

    let level;

    /* =========================================
       FIRST HEADING => H1
    ========================================= */

    if (headingStack.length === 0) {

      level = 1;
    }

    /* =========================================
       MAJOR SECTION
    ========================================= */

    else if (
      matches(text, sectionPatterns)
    ) {

      level = SECTION;
    }

    /* =========================================
       SUBSECTION
    ========================================= */

    else if (
      matches(text, subsectionPatterns)
    ) {

      level = SUB;
    }

    /* =========================================
       DEFAULT CONTENT SUBSECTION
    ========================================= */
else {

  level = 2;
}

    /* =========================================
       PREVENT INVALID DEPTH
    ========================================= */

    level = Math.max(
      1,
      Math.min(level, 4)
    );

    headingStack.push(level);

    repaired.push(
      `${"#".repeat(level)} ${text}`
    );
  }

  return repaired;
}

/* =========================================================
   NORMALIZE MARKDOWN
========================================================= */

function normalizeMarkdown(content, frontmatter = {}) {

  /* =====================================================
     BASIC NORMALIZATION
  ===================================================== */

  content = String(content || "")
    .replace(/\uFEFF/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "  ");

  let lines = content.split("\n");

  /* =====================================================
     REPAIR HEADINGS
  ===================================================== */

  lines = repairHeadingHierarchy(lines);

  /* =====================================================
     REMOVE BROKEN TOP RULES
  ===================================================== */

  while (lines.length) {

    const first =
      String(lines[0] || "").trim();

    if (
      first === "" ||
      isHorizontalRule(first)
    ) {
      lines.shift();
      continue;
    }

    break;
  }

  const normalized = [];

  let inCodeBlock = false;

  const title =
    String(
      frontmatter.title ||
      frontmatter.id ||
      "Untitled"
    ).trim();

  /* =====================================================
     FIND FIRST HEADING
  ===================================================== */

  let firstHeadingIndex = -1;

  for (let i = 0; i < lines.length; i++) {

    if (isHeading(lines[i])) {

      firstHeadingIndex = i;

      break;
    }
  }

  /* =====================================================
     ENSURE H1
  ===================================================== */

  if (firstHeadingIndex === -1) {

    normalized.push(`# ${title}`);
    normalized.push("");

  } else {

    const firstHeadingText =
      getHeadingText(
        lines[firstHeadingIndex]
      );

    normalized.push(
      `# ${firstHeadingText || title}`
    );

    normalized.push("");
  }

  let firstHeadingConsumed = false;

  /* =====================================================
     MAIN LOOP
  ===================================================== */

  for (let i = 0; i < lines.length; i++) {

    let line = lines[i];

    const trimmed =
      String(line || "").trim();

    /* =================================================
       CODE BLOCK TOGGLE
    ================================================= */

    if (isFence(trimmed)) {

      if (
        normalized.length &&
        !isEmpty(
          normalized[normalized.length - 1]
        )
      ) {
        normalized.push("");
      }

      normalized.push(trimmed);

      inCodeBlock = !inCodeBlock;

      continue;
    }

    /* =================================================
       INSIDE CODE BLOCK
    ================================================= */

    if (inCodeBlock) {

      normalized.push(line);

      continue;
    }

    /* =================================================
       REMOVE HR
    ================================================= */

    if (isHorizontalRule(trimmed)) {
      continue;
    }

    /* =================================================
       HEADINGS
    ================================================= */

    if (isHeading(trimmed)) {

      const level =
        getHeadingLevel(trimmed);

      const text =
        getHeadingText(trimmed);

      if (!text) {
        continue;
      }

      /* =============================================
         SKIP DUPLICATED TOP H1
      ============================================= */

      if (!firstHeadingConsumed) {

        firstHeadingConsumed = true;

        continue;
      }

      let newLevel = level;

      if (newLevel < 2) {
        newLevel = 2;
      }

      if (newLevel > 3) {
        newLevel = 3;
      }

      line =
        `${"#".repeat(newLevel)} ${text}`;

      /* =============================================
         SPACING
      ============================================= */

      if (
        normalized.length &&
        !isEmpty(
          normalized[normalized.length - 1]
        )
      ) {
        normalized.push("");
      }

      normalized.push(line);
      normalized.push("");

      continue;
    }

    /* =================================================
       BULLET LIST
    ================================================= */

    if (isList(trimmed)) {

      normalized.push(
        normalizeList(trimmed)
      );

      continue;
    }

    /* =================================================
       ORDERED LIST
    ================================================= */

    if (isOrderedList(trimmed)) {

      normalized.push(trimmed);

      continue;
    }

    /* =================================================
       EMPTY LINE
    ================================================= */

    if (isEmpty(trimmed)) {

      if (
        normalized.length &&
        isEmpty(
          normalized[normalized.length - 1]
        )
      ) {
        continue;
      }

      normalized.push("");

      continue;
    }

    /* =================================================
       NORMAL TEXT
    ================================================= */

    normalized.push(line);
  }

  /* =====================================================
     CLEANUP
  ===================================================== */

  let result =
    normalized.join("\n");

  // remove duplicated separators
  result = result.replace(
    /^(?:\s*-{3,}\s*\n)+/g,
    ""
  );

  // collapse huge gaps
  result = result.replace(
    /\n{3,}/g,
    "\n\n"
  );

  // trim trailing spaces
  result = result.replace(
    /[ \t]+$/gm,
    ""
  );

  // spacing before headings
  result = result.replace(
    /([^\n])\n(#{1,6}\s+)/g,
    "$1\n\n$2"
  );

  // spacing after headings
  result = result.replace(
    /(#{1,6}\s+[^\n]+)\n([^\n])/g,
    "$1\n\n$2"
  );

  // spacing before fences
  result = result.replace(
    /([^\n])\n```/g,
    "$1\n\n```"
  );

  // remove accidental blank before fence close
  result = result.replace(
    /\n\n```/g,
    "\n```"
  );

  result = result
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return result;
}

/* =========================================================
   PROCESS FILE
========================================================= */

function processFile(filePath) {

  console.log(
    "NORMALIZING:",
    filePath
  );

  try {

    const raw = fs.readFileSync(
      filePath,
      "utf8"
    );

    const parsed = matter(raw);

    const normalizedContent =
      normalizeMarkdown(
        parsed.content,
        parsed.data
      );

    /* =====================================================
       CLEAN YAML
    ===================================================== */

    const yaml =
      matter
        .stringify("", parsed.data)
        .replace(/^---\n/, "")
        .replace(/\n---\n$/, "")
        .trim();

    /* =====================================================
       FINAL OUTPUT
    ===================================================== */

    const rebuilt =
`---
${yaml}
---

${normalizedContent}
`;

    fs.writeFileSync(
      filePath,
      rebuilt,
      "utf8"
    );

    console.log("DONE");

  } catch (err) {

    console.error(
      "ERROR:",
      filePath
    );

    console.error(err);
  }
}

/* =========================================================
   RUN
========================================================= */

const files = walkDir(ROOT_DIR);

console.log(
  "FILES FOUND:",
  files.length
);

files.forEach(processFile);

console.log(
  "ALL FILES NORMALIZED"
);