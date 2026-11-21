// Optional owner notifications via Resend. Never blocks or fails the visitor's request.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function notifyOwner(subject, rows, replyTo) {
  const key = process.env.RESEND_API_KEY, to = process.env.NOTIFY_EMAIL;
  if (!key || !to) return { sent: false, reason: "not configured" };
  const from = process.env.MAIL_FROM || "Pawfamily <onboarding@resend.dev>";
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1e1d20">
    <h2 style="font-weight:600">${esc(subject)}</h2>
    <table cellpadding="6" style="border-collapse:collapse">${rows.map(([k, v]) =>
      `<tr><td style="color:#66626a;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="white-space:pre-wrap">${esc(v || "—")}</td></tr>`).join("")}</table>
    <p style="color:#66626a;font-size:13px">Manage this in your Pawfamily dashboard.</p></div>`;
  const text = rows.map(([k, v]) => `${k}: ${v || "—"}`).join("\n");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: to.split(",").map(s => s.trim()).filter(Boolean), subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) console.error("Resend error", res.status, await res.text().catch(() => ""));
    return { sent: res.ok };
  } catch (e) {
    console.error("Resend request failed", e?.message);
    return { sent: false, reason: "request failed" };
  }
}
