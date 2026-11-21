// Generates the values to paste into Netlify > Site configuration > Environment variables.
// Usage: npm run hash-password -- "the owner's password"
import { randomBytes } from "node:crypto";
import { hashPassword } from "../netlify/functions/lib/auth.mjs";

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error('Usage: npm run hash-password -- "a password of at least 10 characters"');
  process.exit(1);
}
console.log("\nPaste these into Netlify (Site configuration > Environment variables):\n");
console.log("ADMIN_PASSWORD_HASH =", await hashPassword(password));
console.log("SESSION_SECRET      =", randomBytes(32).toString("base64url"));
console.log("ADMIN_EMAIL         = (the owner's email address)\n");
console.log("Keep these private. Never commit them to GitHub.\n");
