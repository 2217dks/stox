/**
 * Minimal, dependency-free notification templates.
 *
 * The notification row already contains the human-readable title and message
 * produced by the event source, so the templates only need to wrap that text
 * in a small, safe HTML shell. Values are escaped because a symbol or message
 * could one day contain user-influenced text.
 */

const DEFAULT_FRONTEND_URL = "http://localhost:3000";

function resolvePreferencesUrl(env = process.env) {
  const base = String(
    env.FRONTEND_URL || env.CLIENT_URL || DEFAULT_FRONTEND_URL,
  ).replace(/\/+$/, "");

  return `${base}/settings/notifications`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapHtml({ title, message, data, preferencesUrl }) {
  const rows = Object.entries(data || {})
    .filter(
      ([key, value]) =>
        key !== "channels" && value !== undefined && value !== null,
    )
    .map(([key, value]) => {
      const display =
        typeof value === "object" ? JSON.stringify(value) : value;

      return `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(display)}</td></tr>`;
    })
    .join("");

  const preferencesLink = preferencesUrl
    ? `<p style="color:#718096;font-size:12px;">You are receiving this because notifications are enabled for your stox account. <a href="${escapeHtml(preferencesUrl)}">Manage notification preferences</a>.</p>`
    : `<p style="color:#718096;font-size:12px;">You are receiving this because notifications are enabled for your stox account.</p>`;

  return `<!DOCTYPE html>
<html>
  <body style="font-family: Arial, sans-serif; color: #1a202c;">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
    ${rows ? `<table>${rows}</table>` : ""}
    ${preferencesLink}
  </body>
</html>`;
}

function renderNotificationTemplate(notification, { preferencesUrl } = {}) {
  const title = notification.title || "Notification from stox";
  const message = notification.message || "";

  return {
    subject: title,
    text: message,
    html: wrapHtml({
      title,
      message,
      data: notification.data,
      preferencesUrl: preferencesUrl ?? resolvePreferencesUrl(),
    }),
  };
}

module.exports = {
  DEFAULT_FRONTEND_URL,
  escapeHtml,
  renderNotificationTemplate,
  resolvePreferencesUrl,
  wrapHtml,
};
