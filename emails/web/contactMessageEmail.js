const { escapeHtml, heading, subtitle, paragraph, messageBox, button, layout } = require('../layout');

/**
 * Sent to CONTACT_ADMIN_EMAIL (not the submitter) when someone fills in the
 * website's "Get in touch" form. The button replies straight to the sender.
 * @param {{ name: string, email: string, phone?: string, message: string }} params
 * @returns {{ subject: string, html: string }}
 */
function contactMessageEmail({ name, email, phone, message }) {
  const subject = `New contact form submission from ${name}`;
  const contact = [escapeHtml(email), phone ? escapeHtml(phone) : ''].filter(Boolean).join(' &middot; ');
  const replyUrl = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Re: your message to Declut')}`;
  const body = `
            ${heading('New message from the website')}
            ${subtitle(`${escapeHtml(name)} sent a message through the "Get in touch" form.`)}
            ${paragraph(`<strong>${escapeHtml(name)}</strong><br />${contact}`)}
            ${messageBox(message)}
            ${button(`Reply to ${name}`, replyUrl)}`;

  return {
    subject,
    html: layout({
      title: subject,
      preheader: String(message ?? '').slice(0, 120),
      body,
      features: false,
    }),
  };
}

module.exports = { contactMessageEmail };
