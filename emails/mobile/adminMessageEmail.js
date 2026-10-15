const { escapeHtml, greeting, paragraph, richText, button, layout } = require('../layout');

/**
 * A one-off message from the Declut team to a user, e.g. an admin emailing a
 * seller about their listing (AdminService.emailSeller). Subject and message are
 * the admin's own words.
 * @param {{ name: string, subject: string, message: string, listingTitle?: string, ctaUrl?: string, ctaLabel?: string }} params
 * @returns {{ subject: string, html: string }}
 */
function adminMessageEmail({ name, subject, message, listingTitle, ctaUrl, ctaLabel = 'Open Declut' }) {
  const body = `
            ${greeting(name)}
            ${listingTitle ? paragraph(`This is about your listing <strong>${escapeHtml(listingTitle)}</strong>.`) : ''}
            ${richText(message)}
            ${ctaUrl ? button(ctaLabel, ctaUrl) : ''}`;

  return {
    subject,
    html: layout({
      title: subject,
      preheader: String(message ?? '').slice(0, 120),
      body,
    }),
  };
}

module.exports = { adminMessageEmail };
