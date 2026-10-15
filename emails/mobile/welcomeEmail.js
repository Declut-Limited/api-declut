const { LINKS, greeting, subtitle, paragraph, button, layout } = require('../layout');

/**
 * Sent once a new user has verified their email and can log in.
 * @param {{ name: string, ctaUrl?: string }} params
 * @returns {{ subject: string, html: string }}
 */
function welcomeEmail({ name, ctaUrl = LINKS.site }) {
  const subject = 'Welcome to Declut — your account is ready';
  const body = `
            ${greeting(name)}
            ${subtitle('Your account has been created. Start decluttering today.')}
            ${paragraph('Your Declut account is ready. You can now buy and sell pre-loved items with confidence — every transaction is protected by our secure escrow system.')}
            ${paragraph('Browse thousands of listings, save items you love, and start decluttering your home by listing items you no longer need.')}
            ${button('Explore Listings', ctaUrl)}`;

  return {
    subject,
    html: layout({
      title: subject,
      preheader: 'Your Declut account is ready. Buy and sell pre-loved items with escrow protection.',
      body,
    }),
  };
}

module.exports = { welcomeEmail };
