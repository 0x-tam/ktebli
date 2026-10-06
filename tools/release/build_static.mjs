import { copyFile, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = join(root, "site-dist");
const files = ["index.html", "order.html", "website.css", "website.js"];

try {
  const existing = await lstat(output);
  if (!existing.isDirectory() || existing.isSymbolicLink())
    throw new Error("Static output must be a real directory");
  for (const name of await readdir(output)) {
    if (!files.includes(name))
      throw new Error("Unexpected file in static output: " + name);
    const item = await lstat(join(output, name));
    if (!item.isFile() || item.isSymbolicLink())
      throw new Error("Static output contains a non-regular file");
  }
  await rm(output, { recursive: true });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await mkdir(output);
for (const name of files) {
  const source = join(root, name);
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Public asset must be a regular file: " + name);
  await copyFile(source, join(output, name));
}
process.stdout.write(`Built ${files.length} reviewed public assets.\n`);
