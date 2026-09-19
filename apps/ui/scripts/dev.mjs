import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const usesPreviewBridge = process.argv.includes("--strictPort");
const args = process.argv.slice(2).flatMap((arg) => {
  if (arg === "--host") return ["--hostname"];
  if (arg === "--strictPort") return [];
  return [arg];
});

const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(process.execPath, [nextBin, usesPreviewBridge ? "start" : "dev", ...args], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
