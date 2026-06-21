import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const versionsRoot = join(root, "versions");
const manifestPath = join(versionsRoot, "manifest.json");
const versionsDocPath = join(root, "VERSIONS.md");

const trackedFiles = ["index.html", "styles.css", "app.js", "server.mjs", "README.md"];

function nowIso() {
  return new Date().toISOString();
}

function cleanName(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 48);
}

function versionNumber(value) {
  return `v${String(value).padStart(4, "0")}`;
}

function validDisplayVersion(value) {
  const version = String(value || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("版本号请使用 1.0.1 这种格式");
  return version;
}

async function readManifest() {
  if (!existsSync(manifestPath)) {
    return {
      schema: 1,
      current: null,
      nextNumber: 1,
      trackedFiles,
      versions: [],
    };
  }
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

async function writeManifest(manifest) {
  await mkdir(versionsRoot, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function fileHash(file) {
  const data = await readFile(join(root, file));
  return createHash("sha256").update(data).digest("hex");
}

async function collectHashes() {
  const hashes = {};
  for (const file of trackedFiles) {
    if (existsSync(join(root, file))) hashes[file] = await fileHash(file);
  }
  return hashes;
}

function resolveVersion(manifest, value) {
  const query = String(value || "").trim();
  const matches = manifest.versions.filter((item) => item.id === query || item.number === query || item.id.startsWith(`${query}_`));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error(`找不到版本：${query}`);
  throw new Error(`版本不唯一：${query}`);
}

async function snapshot(name, note = "") {
  const label = cleanName(name);
  if (!label) throw new Error("请提供版本名称，例如：中文字体优化恢复版");

  const manifest = await readManifest();
  const number = versionNumber(manifest.nextNumber);
  const id = `${number}_${label}`;
  const versionPath = join(versionsRoot, id);
  await mkdir(versionPath, { recursive: true });

  for (const file of trackedFiles) {
    const source = join(root, file);
    if (existsSync(source)) await copyFile(source, join(versionPath, file));
  }

  const entry = {
    id,
    number,
    name,
    note,
    createdAt: nowIso(),
    files: trackedFiles.filter((file) => existsSync(join(root, file))),
    hashes: await collectHashes(),
  };

  await writeFile(join(versionPath, "version.json"), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  manifest.current = id;
  manifest.nextNumber += 1;
  manifest.versions.push(entry);
  await writeManifest(manifest);
  await writeVersionsDoc(manifest);
  return entry;
}

async function release(displayVersion, name, note = "") {
  const version = validDisplayVersion(displayVersion);
  const label = cleanName(name);
  if (!label) throw new Error("请提供版本名称，例如：版本号嵌入右上角框内");

  const manifest = await readManifest();
  const id = `${version}_${label}`;
  if (manifest.versions.some((item) => item.id === id || item.number === version)) {
    throw new Error(`版本已存在：${version}`);
  }

  const versionPath = join(versionsRoot, id);
  await mkdir(versionPath, { recursive: true });

  for (const file of trackedFiles) {
    const source = join(root, file);
    if (existsSync(source)) await copyFile(source, join(versionPath, file));
  }

  const entry = {
    id,
    number: version,
    name,
    note,
    createdAt: nowIso(),
    files: trackedFiles.filter((file) => existsSync(join(root, file))),
    hashes: await collectHashes(),
  };

  await writeFile(join(versionPath, "version.json"), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  manifest.current = id;
  manifest.versions.push(entry);
  await writeManifest(manifest);
  await writeVersionsDoc(manifest);
  return entry;
}

async function restore(value) {
  const manifest = await readManifest();
  const target = resolveVersion(manifest, value);
  for (const file of target.files) {
    await copyFile(join(versionsRoot, target.id, file), join(root, file));
  }

  const updatedManifest = await readManifest();
  updatedManifest.current = target.id;
  await writeManifest(updatedManifest);
  await writeVersionsDoc(updatedManifest);
  return target;
}

async function writeVersionsDoc(manifest = null) {
  const data = manifest || (await readManifest());
  const lines = [
    "# 版本记录",
    "",
    "每次界面或功能调整后，都会保存为一个完整版本。版本目录在 `versions/`，可用版本号或完整目录名恢复。",
    "",
    "## 使用",
    "",
    "```bash",
    'node version-manager.mjs release 1.0.1 "更动内容名称"',
    'node version-manager.mjs snapshot "更动内容名称"',
    "node version-manager.mjs list",
    "node version-manager.mjs restore 1.0.1",
    "```",
    "",
    "## 当前版本",
    "",
    data.current ? `- ${data.current}` : "- 尚未保存",
    "",
    "## 历史",
    "",
  ];

  if (!data.versions.length) {
    lines.push("- 暂无版本。");
  } else {
    for (const item of data.versions) {
      lines.push(`- ${item.id}｜${item.createdAt}｜${item.name}${item.note ? `｜${item.note}` : ""}`);
    }
  }

  await writeFile(versionsDocPath, `${lines.join("\n")}\n`, "utf8");
}

async function listVersions() {
  const manifest = await readManifest();
  if (!manifest.versions.length) return "暂无版本。";
  return manifest.versions
    .map((item) => `${item.id}${item.id === manifest.current ? "  <- 当前" : ""}\n  ${item.createdAt}  ${item.name}`)
    .join("\n");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "release") {
    const entry = await release(args[0], args[1], args.slice(2).join(" "));
    console.log(`已保存正式版本：${entry.id}`);
    return;
  }
  if (command === "snapshot") {
    const entry = await snapshot(args[0], args.slice(1).join(" "));
    console.log(`已保存版本：${entry.id}`);
    return;
  }
  if (command === "restore") {
    const entry = await restore(args[0]);
    console.log(`已恢复版本：${entry.id}`);
    return;
  }
  if (command === "list") {
    console.log(await listVersions());
    return;
  }
  if (command === "files") {
    console.log(trackedFiles.map((file) => basename(file)).join("\n"));
    return;
  }
  console.log('用法：node version-manager.mjs release 1.0.1 "更动内容名称" | snapshot "更动内容名称" | list | restore 1.0.1');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
