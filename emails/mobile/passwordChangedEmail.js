const { LINKS, greeting, subtitle, paragraph, detailsTable, button, layout } = require('../layout');

// "14 Sep 2026" and "09:41 GMT", shown in GMT (UTC) as in the design. Built by hand
// because Intl's en-GB short month is "Sept" on newer Node versions.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

function formatDate(date) {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function formatTime(date) {
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} GMT`;
}

/**
 * Security notice sent after a user's password is changed or reset.
 * @param {{ name: string, changedAt?: Date | string | number, supportUrl?: string }} params
 * @returns {{ subject: string, html: string }}
 */
function passwordChangedEmail({ name, changedAt = new Date(), supportUrl = LINKS.support }) {
  const when = new Date(changedAt);
  const date = formatDate(when);
  const time = formatTime(when);
  const subject = 'Your Declut password was changed';
  const body = `
            ${greeting(name)}
            ${subtitle('Your Declut password was successfully updated.')}
            ${paragraph(`Your Declut password was successfully changed on ${date} at ${time}.`)}
            ${paragraph("If you made this change, no further action is needed. If you didn't change your password, please contact our support team immediately and secure your account.")}
            ${detailsTable([
              ['Date', date],
              ['Time', time],
            ])}
            ${button('Contact Support', supportUrl)}`;

  return {
    subject,
    html: layout({
      title: subject,
      preheader: `Your password was changed on ${date} at ${time}. Not you? Contact support right away.`,
      body,
    }),
  };
}

module.exports = { passwordChangedEmail };
