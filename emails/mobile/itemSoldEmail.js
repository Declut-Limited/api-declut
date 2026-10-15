const { escapeHtml, heading, subtitle, paragraph, detailsTable, button, formatNaira, layout } = require('../layout');

/**
 * Sent to the seller once a buyer has paid for their listing (funds held in escrow).
 * The button only shows when a `ctaUrl` is passed (an app link to the sale).
 * @param {{ name: string, itemTitle: string, orderNumber: string, amount: number, ctaUrl?: string }} params
 *   orderNumber is the transaction's reference (TXN-YYYY-#####); amount is in naira.
 * @returns {{ subject: string, html: string }}
 */
function itemSoldEmail({ name, itemTitle, orderNumber, amount, ctaUrl }) {
  const subject = `You made a sale — ${itemTitle}`;
  const body = `
            ${heading(`Exciting news, ${escapeHtml(name || 'there')}!`)}
            ${subtitle('Someone has purchased your item. Payment is held in escrow.')}
            ${paragraph("Your listing has been purchased and payment is held securely in escrow. We'll release the funds to you once the buyer confirms they've collected and inspected the item.")}
            ${paragraph('Get the item ready — the buyer will be in touch to arrange pickup.')}
            ${detailsTable([
              ['Item Sold', itemTitle],
              ['Sale Price', formatNaira(amount)],
              ['Order #', orderNumber],
            ])}
            ${ctaUrl ? button('View Sale Details', ctaUrl) : ''}`;

  return {
    subject,
    html: layout({
      title: subject,
      preheader: `Your item sold for ${formatNaira(amount)}. Payment is held in escrow until the buyer collects it.`,
      body,
    }),
  };
}

module.exports = { itemSoldEmail };
