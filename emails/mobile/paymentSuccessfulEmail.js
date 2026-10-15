const { escapeHtml, heading, subtitle, paragraph, detailsTable, button, formatNaira, layout } = require('../layout');

/**
 * Sent to the buyer once their payment is confirmed and the funds are in escrow.
 * The button only shows when a `ctaUrl` is passed (an app link to the order).
 * @param {{ name: string, itemTitle: string, orderNumber: string, amount: number, sellerName: string, ctaUrl?: string }} params
 *   orderNumber is the transaction's reference (TXN-YYYY-#####); amount is in naira.
 * @returns {{ subject: string, html: string }}
 */
function paymentSuccessfulEmail({ name, itemTitle, orderNumber, amount, sellerName, ctaUrl }) {
  const subject = `Payment confirmed — ${itemTitle}`;
  const body = `
            ${heading(`Great news, ${escapeHtml(name || 'there')}!`)}
            ${subtitle("Your payment was successful. Here's your order summary.")}
            ${paragraph("Your payment has been processed and your order is confirmed. Declut will hold the funds securely in escrow until you've had a chance to inspect the item.")}
            ${paragraph('The seller has been notified and will prepare the item for collection.')}
            ${detailsTable([
              ['Item', itemTitle],
              ['Order #', orderNumber],
              ['Amount Paid', formatNaira(amount)],
              ['Seller Name', sellerName],
            ])}
            ${ctaUrl ? button('View Order', ctaUrl) : ''}`;

  return {
    subject,
    html: layout({
      title: subject,
      preheader: `Your ${formatNaira(amount)} payment is safe in escrow until you've inspected the item.`,
      body,
    }),
  };
}

module.exports = { paymentSuccessfulEmail };
