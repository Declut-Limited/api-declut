const { escapeHtml, greeting, subtitle, paragraph, notice, button, layout } = require('../layout');

/**
 * Sent to a new admin created by another admin (AdminAuthService.createSubAdmin),
 * carrying their temporary login details.
 * @param {{ name: string, email: string, password: string, loginUrl: string, role?: string }} params
 * @returns {{ subject: string, html: string }}
 */
function subAdminInviteEmail({ name, email, password, loginUrl, role }) {
  const subject = "You've been added as a Declut admin";
  const roleText = role ? ` as <strong>${escapeHtml(role)}</strong>` : '';
  const body = `
            ${greeting(name)}
            ${subtitle("You've been added to the Declut admin portal.")}
            ${paragraph(`An admin account has been created for you${roleText} on the Declut admin portal. Use these details to sign in:`)}
            ${paragraph(`Email: <strong>${escapeHtml(email)}</strong><br />Password: <strong>${escapeHtml(password)}</strong>`)}
            ${notice('For your security, change this password after you first log in.')}
            ${button('Log In to Admin', loginUrl)}`;

  return {
    subject,
    html: layout({
      title: subject,
      preheader: 'Your Declut admin account is ready. Here are your login details.',
      body,
    }),
  };
}

module.exports = { subAdminInviteEmail };
