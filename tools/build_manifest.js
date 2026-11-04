// Lists every file the phone must download for offline use, with a content hash as the version.
// Run last, after editing anything in docs/:  node tools/build_manifest.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DOCS = path.resolve(__dirname, "..", "docs");
const SKIP = new Set(["files.json", "sw.js", ".nojekyll", "README.md"]);
const files = [];
const all = crypto.createHash("sha256");

(function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const rel = path.relative(DOCS, full).split(path.sep).join("/");
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (!SKIP.has(rel)) {
      const buf = fs.readFileSync(full);
      const hash = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
      all.update(rel + hash);
      files.push({ path: rel, size: buf.length, hash });
    }
  }
})(DOCS);

const version = all.digest("hex").slice(0, 12);
const total = files.reduce((a, f) => a + f.size, 0);
fs.writeFileSync(path.join(DOCS, "files.json"), JSON.stringify({ version, total, files }, null, 0));
console.log(`files.json: ${files.length} files, ${(total / 1e6).toFixed(1)} MB, version ${version}`);
