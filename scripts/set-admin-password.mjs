import { randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const password = process.argv[2];
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const outputArg = process.argv[3] || "data/admin-auth.json";
const outputPath = isAbsolute(outputArg) ? outputArg : resolve(projectRoot, outputArg);

if (!password) {
  console.error("Usage: node scripts/set-admin-password.mjs <password> [outputPath]");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const passwordHash = createHash("sha256").update(`${salt}:${password}`).digest("hex");

const payload = {
  salt,
  passwordHash,
  algorithm: "sha256",
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
