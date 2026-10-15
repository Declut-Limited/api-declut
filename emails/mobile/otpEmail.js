const { greeting, subtitle, paragraph, otpCode, notice, button, layout } = require('../layout');

const COPY = {
  verify: {
    subject: 'Your Declut verification code',
    subtitle: 'Enter this 6-digit code to verify your email address.',
    intro: 'To complete verification, enter the 6-digit code below in the Declut app. This confirms your email address and keeps your account secure.',
    cta: 'Verify Email Address',
  },
  reset: {
    subject: 'Your Declut password reset code',
    subtitle: 'Enter this 6-digit code to reset your password.',
    intro: "To reset your password, enter the 6-digit code below in the Declut app. If you didn't request a reset, you can safely ignore this email.",
    cta: 'Reset Password',
  },
};

/**
 * One-time code email (sign-up verification or password reset).
 * The button only shows when a `ctaUrl` is passed — the code itself is
 * entered in the app, so there's no link to follow by default.
 * @param {{ name: string, otp: string, expiryMinutes: number, purpose?: 'verify' | 'reset', ctaUrl?: string }} params
 * @returns {{ subject: string, html: string }}
 */
function otpEmail({ name, otp, expiryMinutes, purpose = 'verify', ctaUrl }) {
  const copy = COPY[purpose] || COPY.verify;
  const body = `
            ${greeting(name)}
            ${subtitle(copy.subtitle)}
            ${paragraph(copy.intro)}
            ${paragraph(`The code is valid for ${expiryMinutes} minutes and can only be used once. Do not share it with anyone — Declut will never ask for your code.`)}
            ${otpCode(otp)}
            ${notice(`This code expires in ${expiryMinutes} minutes. Do not share it with anyone.`)}
            ${ctaUrl ? button(copy.cta, ctaUrl) : ''}`;

  return {
    subject: copy.subject,
    html: layout({
      title: copy.subject,
      preheader: `Your Declut code expires in ${expiryMinutes} minutes. Don't share it with anyone.`,
      body,
    }),
  };
}

module.exports = { otpEmail };
