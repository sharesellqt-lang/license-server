const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

/* =========================================================
   PATH CONFIG
========================================================= */

const ROOT_DIR = path.join(__dirname, "../knowledge/raw");

const OUTPUT_FILE = path.join(
  __dirname,
  "../docs/data/keywords.json"
);

/* =========================================================
   HELPERS
========================================================= */

function walkDir(dir) {

  let results = [];

  if (!fs.existsSync(dir)) {
    console.error("❌ ROOT DIR NOT FOUND:", dir);
    return results;
  }

  const list = fs.readdirSync(dir);

  list.forEach(file => {

    const filePath = path.join(dir, file);

    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {

      results = results.concat(walkDir(filePath));

    } else if (file.endsWith(".md")) {

      results.push(filePath);
    }
  });

  return results;
}

function normalizeArray(value) {

  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map(String).map(s => s.trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map(s => s.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeId(str) {

  return String(str)
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/\s+/g, "-");
}

/* =========================================================
   NORMALIZE CONCEPT LIST
========================================================= */

function normalizeConceptList(value) {

  if (!value) return [];

  // YAML chuẩn:
  // related:
  //   - execution-context
  if (Array.isArray(value)) {
    return value
      .map(v => String(v).trim())
      .filter(Boolean);
  }

  // fallback cho AI sinh lỗi:
  // related:
  //   * execution-context
  //   * call-stack
  if (typeof value === "string") {

    return value
      .split(/\r?\n/)
      .map(line =>
        line
          .replace(/^[-*]\s*/, "")
          .trim()
      )
      .filter(Boolean);
  }

  // trường hợp AI sinh object:
  // related:
  //   execution-context: xxx
  //   call-stack: xxx
  if (
    typeof value === "object" &&
    value !== null
  ) {
    return Object.keys(value);
  }

  return [];
}

function parseOrder(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 999999;
}

/* =========================================================
   BLOCK TYPE
========================================================= */

function detectBlockType(title) {

  const clean = title.toLowerCase();

  if (clean.includes("definition")) {
    return "definition";
  }

  if (clean.includes("intuition")) {
    return "intuition";
  }

  if (clean.includes("example")) {
    return "example";
  }

  if (clean.includes("deep dive")) {
    return "deep_dive";
  }

  if (clean.includes("summary")) {
    return "summary";
  }

  if (clean.includes("mental model")) {
    return "mental_model";
  }

  if (clean.includes("execution flow")) {
    return "execution_flow";
  }

  if (clean.includes("visualization")) {
    return "visualization";
  }

  if (clean.includes("performance")) {
    return "performance";
  }

  if (clean.includes("security")) {
    return "security";
  }

  if (clean.includes("common bugs")) {
    return "common_bugs";
  }

  if (clean.includes("common mistakes")) {
    return "mistakes";
  }

  if (clean.includes("edge cases")) {
    return "edge_cases";
  }

  if (clean.includes("real world")) {
    return "real_world";
  }

  if (clean.includes("engine internals")) {
    return "engine_internals";
  }

  if (clean.includes("related concepts")) {
    return "related_concepts";
  }

  if (clean.includes("learn next")) {
    return "learn_next";
  }

  return "text";
}

/* =========================================================
   PARSE BLOCKS
========================================================= */

function parseBlocks(content) {

  const blocks = [];

  content =
    content.replace(
      /\r\n/g,
      "\n"
    );

  content =
    content = content.replace(
    /^---\n[\s\S]*?\n---\n?/,
    ""
  );

  const regex = /^##\s+(.+)$/gm;

  const matches =
    [...content.matchAll(
      regex
    )];

  if (!matches.length) {

    return [{
      type: "text",
      title: "Content",
      body: content.trim()
    }];
  }

  for (let i = 0; i < matches.length; i++) {

    const start =
      matches[i].index;

    const end =
      i + 1 < matches.length
        ? matches[i + 1].index
        : content.length;

    let section =
      content
        .slice(start, end)
        .trim();

    const lines =
      section.split("\n");

    const heading =
      lines.shift()
        .replace(
          /^##\s*/,
          ""
        )
        .trim();

    const type =
      detectBlockType(
        heading
      );

    let body =
      lines.join("\n")
        .trim();

    body =
      body.replace(
        /^#\s.+$/gm,
        ""
      );

    /* extract FIRST code block only */

    let code = null;

    const codeMatch =
      body.match(
        /```([\s\S]*?)```/
      );

    if (codeMatch) {

      code =
        codeMatch[1]
          .replace(
            /^[a-zA-Z]+\n?/,
            ""
          )
          .trim();
    }

    /* remove code from body */

    const cleanBody =
      body.replace(
        /```[\s\S]*?```/g,
        ""
      ).trim();

    blocks.push({

      type,

      title: heading,

      ...(cleanBody
        ? { body: cleanBody }
        : {}),

      ...(code
        ? { code }
        : {})

    });
  }

  return blocks;
}

function normalizeArray(value) {

  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map(v => String(v).trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map(v => v.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeConceptList(list) {

  return normalizeArray(list)
    .map(item => {

      const idx =
        item.indexOf(":");

      if (idx === -1) {
        return item.trim();
      }

      return item
        .slice(0, idx)
        .trim();

    })
    .filter(Boolean);

}

function sanitizeMarkdown(raw) {

  let text = String(raw || "").trim();

  text = text.replace(
    /^`{3,4}(markdown|md)?\s*/i,
    ""
  );

  text = text.replace(
    /\n?`{3,4}\s*$/i,
    ""
  );

  return text.trim();
}

function stripCodeWrapper(text) {
  let t = String(text || "");

  // chỉ remove wrapper ngoài cùng, KHÔNG đụng YAML
  t = t.replace(/^```(?:md|markdown)?\s*\n/, "");
  t = t.replace(/\n```$/, "");

  return t.trim();
}
/* =========================================================
   BUILD KEYWORDS
========================================================= */
function buildKeywords() {

  console.log("🚀 BUILD START");

  const files = walkDir(ROOT_DIR);

  console.log("📂 FILES FOUND:", files.length);

  const keywords = [];

  files.forEach(filePath => {

    try {

      console.log("📄 PARSING:", filePath);

    const raw = fs.readFileSync(filePath, "utf8");

    const cleaned = stripCodeWrapper(raw); // chỉ xử lý ```md nếu có

    const parsed = matter(cleaned);

      const data = parsed.data || {};

      // =========================
      // NORMALIZE FRONTMATTER
      // =========================

      data.tags =
        normalizeArray(data.tags);

      data.prerequisites =
        normalizeConceptList(
          data.prerequisites
        );

      data.related =
        normalizeConceptList(
          data.related
        );

      data.next =
        normalizeConceptList(
          data.next
        );

      console.log(
        "FILE:",
        path.basename(filePath)
      );

      console.log(
        "DATA:",
        data
      );

      const content =
        parsed.content || "";

      /* =====================================================
         BUILD PATH
      ===================================================== */

      const relative =
        path.relative(
          ROOT_DIR,
          filePath
        );

      const segments =
        relative.split(path.sep);

      // remove filename
      segments.pop();

      const pathTree =
        segments.map(name => ({
          name,
          type: "folder"
        }));

      /* =====================================================
         FILE INFO
      ===================================================== */

      const fileName =
        path.basename(
          filePath,
          ".md"
        );

      const id =
        data.id ||
        normalizeId(fileName);

      const title =
        data.title ||
        fileName;

      /* =====================================================
         PARSE BLOCKS
      ===================================================== */

      const blocks =
        parseBlocks(content);

      /* =====================================================
         BUILD ITEM
      ===================================================== */

      const item = {

        id,

        title,

        access:
          (
            data.access ||
            "pro"
          ).toLowerCase(),

        category:
          data.category ||
          segments[0] ||
          "general",

        path:
          pathTree,

        summary: {

          short:
            typeof data.summary === "string"
              ? data.summary
              : data.summary?.short || "",

          intuition:
            typeof data.summary === "object"
              ? data.summary?.intuition || ""
              : ""

        },

        content: {
          blocks
        },

        relations: {

          prerequisites:
            data.prerequisites,

          related:
            data.related,

          next:
            data.next

        },

        meta: {

          order:
            Number(
              data.order ?? 999999
            ),

          difficulty:
            String(
              data.difficulty ||
              "beginner"
            ),

          importance:
            String(
              data.importance ||
              "medium"
            ),

          tags:
            data.tags,

          estimated_time:
            data.estimated_time || ""

        }

      };

      keywords.push(item);

      console.log(
        "✅ BUILT:",
        id
      );

    } catch (err) {
  console.error("❌ ERROR PARSING FILE:", filePath);
  console.error(err?.message || err);
  return; // quan trọng: skip rõ ràng
}

  });

  /* =========================================================
     ENSURE OUTPUT DIR
  ========================================================= */

  const outputDir =
    path.dirname(
      OUTPUT_FILE
    );

  if (!fs.existsSync(outputDir)) {

    fs.mkdirSync(
      outputDir,
      {
        recursive: true
      }
    );

  }

  /* =========================================================
     SORT ORDER
  ========================================================= */

keywords.sort((a, b) => {
  const orderA = parseOrder(a.meta?.order);
  const orderB = parseOrder(b.meta?.order);

  if (orderA !== orderB) return orderA - orderB;

  if (a.category !== b.category) {
    return (a.category || "").localeCompare(b.category || "");
  }

  return (a.title || "").localeCompare(b.title || "en");
});

  /* =========================================================
     WRITE JSON
  ========================================================= */

  fs.writeFileSync(

    OUTPUT_FILE,

    JSON.stringify(
      keywords,
      null,
      2
    ),

    "utf8"

  );

  console.log(
    "🔥 keywords.json generated"
  );

  console.log(
    "📦 TOTAL:",
    keywords.length
  );

  console.log(
    "📁 OUTPUT:",
    OUTPUT_FILE
  );

}
/* =========================================================
   RUN
========================================================= */

buildKeywords();