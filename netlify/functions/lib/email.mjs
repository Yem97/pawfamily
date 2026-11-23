// Email via Resend. Optional: if RESEND_API_KEY is missing, nothing is sent and nothing fails.
// Note: until a domain is verified in Resend, it only delivers to the Resend account's own address.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY);
export const ownerEmailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL);

export async function sendEmail({ to, subject, html, text, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  const recipients = (Array.isArray(to) ? to : String(to || "").split(",")).map(s => s.trim()).filter(Boolean);
  if (!key || !recipients.length) return { sent: false, reason: "not configured" };
  const from = process.env.MAIL_FROM || "Pawfamily <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: recipients, subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) console.error("Resend error", res.status, await res.text().catch(() => ""));
    return { sent: res.ok };
  } catch (e) {
    console.error("Resend request failed", e?.message);
    return { sent: false, reason: "request failed" };
  }
}

const wrap = inner => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1e1d20;max-width:560px">${inner}</div>`;

/** Owner alert with a table of fields. */
export function notifyOwner(subject, rows, replyTo) {
  if (!process.env.NOTIFY_EMAIL) return Promise.resolve({ sent: false, reason: "not configured" });
  const html = wrap(`<h2 style="font-weight:600">${esc(subject)}</h2>
    <table cellpadding="6" style="border-collapse:collapse">${rows.map(([k, v]) =>
      `<tr><td style="color:#66626a;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="white-space:pre-wrap">${esc(v || "—")}</td></tr>`).join("")}</table>
    <p style="color:#66626a;font-size:13px">Manage this in your Pawfamily dashboard.</p>`);
  return sendEmail({ to: process.env.NOTIFY_EMAIL, subject, html, text: rows.map(([k, v]) => `${k}: ${v || "—"}`).join("\n"), replyTo });
}

/** Waiting-list alert to a member of the public. */
export function sendPetAlert({ to, name, rescueName, pet, petLine, fee, petUrl, unsubscribeUrl, replyTo }) {
  const subject = `${pet} is looking for a home at ${rescueName}`;
  const html = wrap(`<p>Hi ${esc(name)},</p>
    <p>You asked us to let you know when a pet matching your wishes arrives. Meet <b>${esc(pet)}</b>: ${esc(petLine)}${fee ? `, adoption fee ${esc(fee)}` : ""}.</p>
    <p><a href="${esc(petUrl)}" style="display:inline-block;background:#1e1d20;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">Meet ${esc(pet)}</a></p>
    <p style="color:#66626a;font-size:13px">You're receiving this because you joined the ${esc(rescueName)} waiting list. <a href="${esc(unsubscribeUrl)}">Stop these emails</a>.</p>`);
  const text = `Hi ${name},\n\nMeet ${pet}: ${petLine}${fee ? `, adoption fee ${fee}` : ""}.\n${petUrl}\n\nStop these emails: ${unsubscribeUrl}`;
  return sendEmail({ to, subject, html, text, replyTo });
}
