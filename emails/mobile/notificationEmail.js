const { escapeHtml, greeting, subtitle, richText, detailsTable, button, layout } = require('../layout');

/**
 * Catch-all for in-app notifications that also go out by email
 * (NotificationsService's email channel): the notification's title becomes the
 * subject and subtitle, its body the text. Works for users and admins alike.
 * @param {{ name?: string, title: string, body: string, details?: Array<[string, string]>, ctaUrl?: string, ctaLabel?: string }} params
 * @returns {{ subject: string, html: string }}
 */
function notificationEmail({ name, title, body: text, details, ctaUrl, ctaLabel = 'Open Declut' }) {
  const body = `
            ${greeting(name)}
            ${subtitle(escapeHtml(title))}
            ${richText(text)}
            ${details && details.length ? detailsTable(details) : ''}
            ${ctaUrl ? button(ctaLabel, ctaUrl) : ''}`;

  return {
    subject: title,
    html: layout({
      title,
      preheader: String(text ?? '').slice(0, 120),
      body,
    }),
  };
}

module.exports = { notificationEmail };
