import { createHash } from "node:crypto";

export function hashContent(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function hashFileContent(fileContent: string) {
  return hashContent(fileContent);
}
