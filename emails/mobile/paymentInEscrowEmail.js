const { greeting, subtitle, paragraph, detailsTable, button, formatNaira, layout } = require('../layout');

/**
 * Follow-up to paymentSuccessfulEmail, sent to the buyer a while after paying:
 * a reminder that the money is held in escrow until they confirm collection.
 * The button only shows when a `ctaUrl` is passed (e.g. a link to chat or call the seller).
 * @param {{ name: string, itemTitle: string, orderNumber: string, amount: number, ctaUrl?: string }} params
 *   orderNumber is the transaction's reference (TXN-YYYY-#####); amount is in naira.
 * @returns {{ subject: string, html: string }}
 */
function paymentInEscrowEmail({ name, itemTitle, orderNumber, amount, ctaUrl }) {
  const subject = 'Your payment is safe in Declut escrow';
  const body = `
            ${greeting(name)}
            ${subtitle('Your payment is safely held by Declut until collection.')}
            ${paragraph(`Your payment of ${formatNaira(amount)} is now securely held in Declut escrow. The funds will only be released to the seller once you confirm the item has been collected and inspected.`)}
            ${paragraph("You're fully protected until you're happy.")}
            ${detailsTable([
              ['Amount in Escrow', formatNaira(amount)],
              ['Item', itemTitle],
              ['Order #', orderNumber],
            ])}
            ${ctaUrl ? button('Contact Seller', ctaUrl) : ''}`;

  return {
    subject,
    html: layout({
      title: subject,
      preheader: `${formatNaira(amount)} is held in escrow until you confirm collection.`,
      body,
    }),
  };
}

module.exports = { paymentInEscrowEmail };
