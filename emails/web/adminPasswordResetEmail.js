const { greeting, subtitle, paragraph, notice, button, layout } = require('../layout');

// "10 minutes", "1 hour", "2 hours" for the expiry strip.
function formatExpiry(minutes) {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Sent to an admin who requested a password reset from the admin portal.
 * The link carries the raw reset token (see AdminAuthService.forgotPassword).
 * @param {{ name: string, resetLink: string, expiryMinutes: number }} params
 * @returns {{ subject: string, html: string }}
 */
function adminPasswordResetEmail({ name, resetLink, expiryMinutes }) {
  const expiry = formatExpiry(expiryMinutes);
  const subject = 'Reset your Declut admin password';
  const body = `
            ${greeting(name)}
            ${subtitle('We received a request to reset your password.')}
            ${paragraph('We received a request to reset the password for your Declut account. Click the button below to choose a new password.')}
            ${paragraph("If you didn't request a password reset, please ignore this email — your password will remain unchanged.")}
            ${notice(`This link expires in ${expiry} for your security.`)}
            ${button('Reset Password', resetLink)}`;

  return {
    subject,
    html: layout({
      title: subject,
      preheader: `Choose a new password for your Declut admin account. This link expires in ${expiry}.`,
      body,
    }),
  };
}

module.exports = { adminPasswordResetEmail };
