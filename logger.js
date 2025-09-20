import fs from "fs";
import path from "path";

const LOG_DIR = "./logs";
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

const LOG_FILE = path.join(LOG_DIR, `bot-log-${new Date().toISOString().slice(0, 10)}.log`);

export function logToFile(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}
