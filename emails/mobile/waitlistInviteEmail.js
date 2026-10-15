const { LINKS, heading, subtitle, richText, button, layout } = require('../layout');

/**
 * Sent by an admin to someone on the waitlist. The body is entirely the admin's
 * own message (content is their call, not ours), framed in the Declut design.
 * @param {{ message: string, subject?: string, ctaUrl?: string, ctaLabel?: string }} params
 * @returns {{ subject: string, html: string }}
 */
function waitlistInviteEmail({ message, subject = "You're invited to Declut", ctaUrl = LINKS.site, ctaLabel = 'Get Started' }) {
  const body = `
            ${heading("You're invited to Declut")}
            ${subtitle('Your spot on the waitlist is ready.')}
            ${richText(message)}
            ${ctaUrl ? button(ctaLabel, ctaUrl) : ''}`;

  return {
    subject,
    html: layout({
      title: subject,
      preheader: 'Your spot on the Declut waitlist is ready. Buy and sell pre-loved items with escrow protection.',
      body,
    }),
  };
}

module.exports = { waitlistInviteEmail };
