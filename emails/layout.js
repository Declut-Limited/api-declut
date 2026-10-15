/**
 * Shared Declut email frame (header banner, body, optional feature row, footer),
 * built with tables + inline styles so it renders in Gmail, Outlook and Apple Mail.
 * Every template in this folder renders its own body and passes it through `layout()`.
 *
 * Email clients can't load local files, so every image below is a public URL
 * (PNG, transparent background).
 */

const BRAND = '#2563EB';
const BRAND_TINT = '#EFF6FF';
const HEADING = '#111827';
const TEXT = '#374151';
const MUTED = '#6B7280';
const CARD = '#F8FAFC';
const BORDER = '#E5E7EB';
const FONT = "'Standerd', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// Hosted on Declut's Cloudinary (folder declut/email). Re-uploading with the same
// public_id replaces the image everywhere without touching this file.
const CDN = 'https://res.cloudinary.com/du8iw1efa/image/upload/declut/email';
const ASSETS = {
  logo: `${CDN}/logo.png`,
  banner: `${CDN}/header-banner.png`,
  iconEscrow: `${CDN}/icon-escrow.png`,
  iconPayments: `${CDN}/icon-payments.png`,
  iconSupport: `${CDN}/icon-support.png`,
  instagram: `${CDN}/social-instagram.png`,
  x: `${CDN}/social-x.png`,
  facebook: `${CDN}/social-facebook.png`,
  tiktok: `${CDN}/social-tiktok.png`,
  whatsapp: `${CDN}/social-whatsapp.png`,
};

const LINKS = {
  site: 'https://declut.com.ng',
  unsubscribe: 'https://declut.ng/unsubscribe',
  privacy: 'https://declut.ng/privacy-policy',
  terms: 'https://declut.ng/terms-of-use',
  support: 'mailto:support@declut.com.ng',
  instagram: 'https://www.instagram.com/declutapp',
  x: 'https://x.com/Declut_',
  facebook: 'https://www.facebook.com/share/1FaBrep8c9/',
  tiktok: 'https://www.tiktok.com/@REPLACE_ME',
  whatsapp: 'https://wa.me/REPLACE_ME',
};

const ADDRESS = 'Declut Ltd · 5 Ogunsiji Close, Ikeja, Lagos';

// Anything user-supplied (names, item titles, messages) goes through this before
// it's interpolated into HTML.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Building blocks for template bodies ----------

// Big opening line. `text` is HTML — escape anything user-supplied first.
function heading(text) {
  return `<h1 style="margin:0 0 10px;font-family:${FONT};font-size:28px;line-height:34px;font-weight:700;color:${HEADING};">${text}</h1>`;
}

function greeting(name) {
  return heading(`Hi ${escapeHtml(name || 'there')},`);
}

// "₦420,000" — amounts are whole naira throughout the API. Plain text (not an
// HTML entity) so it survives detailsTable's escaping.
function formatNaira(amount) {
  return `₦${Number(amount || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

function subtitle(text) {
  return `<p style="margin:0 0 28px;font-family:${FONT};font-size:15px;line-height:22px;color:${TEXT};">${text}</p>`;
}

function paragraph(text) {
  return `<p style="margin:0 0 20px;font-family:${FONT};font-size:16px;line-height:26px;color:${MUTED};">${text}</p>`;
}

// Free text typed by a person (admin messages, notification bodies): escaped,
// blank lines start a new paragraph, single line breaks are kept.
function richText(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => paragraph(escapeHtml(block).replace(/\n/g, '<br />')))
    .join('');
}

// Someone else's message quoted in a soft card (e.g. a contact form submission).
function messageBox(text) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
  <tr>
    <td style="background:${CARD};border-left:4px solid ${BRAND};border-radius:12px;padding:20px 22px;font-family:${FONT};font-size:16px;line-height:26px;color:${TEXT};">${escapeHtml(text).replace(/\n/g, '<br />')}</td>
  </tr>
</table>`;
}

// Bulletproof button: a table cell carries the background so Outlook still shows it.
function button(label, url) {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 8px;">
  <tr>
    <td align="center" bgcolor="${BRAND}" style="border-radius:12px;background:${BRAND};">
      <a href="${url}" target="_blank" class="btn" style="display:inline-block;padding:16px 32px;font-family:${FONT};font-size:17px;line-height:22px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">${escapeHtml(label)}&nbsp;&nbsp;&rarr;</a>
    </td>
  </tr>
</table>`;
}

// Big highlighted code (OTPs, confirmation codes).
function codeBox(code) {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;">
  <tr>
    <td style="background:${BRAND_TINT};border-radius:12px;padding:18px 28px;font-family:${FONT};font-size:32px;line-height:36px;font-weight:700;letter-spacing:8px;color:${BRAND};">${escapeHtml(code)}</td>
  </tr>
</table>`;
}

// Large centred OTP from the design: the code split into two halves ("427 005"),
// each in its own soft card. Codes that don't split evenly fall back to one card.
function otpCode(code) {
  const value = String(code ?? '');
  const half = value.length % 2 === 0 && value.length >= 4 ? value.length / 2 : 0;
  const parts = half ? [value.slice(0, half), value.slice(half)] : [value];
  const cell = (part, i) => `
    <td class="otp-cell" style="${i ? 'padding-left:10px;' : ''}">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="otp-digits" style="background:${CARD};border-radius:18px;padding:12px 22px;font-family:${FONT};font-size:56px;line-height:72px;font-weight:500;letter-spacing:8px;color:${BRAND};">${escapeHtml(part)}</td>
      </tr></table>
    </td>`;
  return `
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:4px auto 24px;">
  <tr>${parts.map(cell).join('')}
  </tr>
</table>`;
}

// Full-width amber strip for warnings ("This code expires in 10 minutes...").
function notice(text) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
  <tr>
    <td align="center" style="background:#FFFBEB;border-radius:10px;padding:16px 20px;font-family:${FONT};font-size:15px;line-height:22px;color:#D97706;">${text}</td>
  </tr>
</table>`;
}

// Bordered card of label/value rows under a tinted "Details" header, as in the
// password-changed design. Also suits receipts (amount, item, reference...).
function detailsTable(rows, title = 'Details') {
  const body = rows
    .map(
      ([label, value], i) => `
  <tr>
    <td style="padding:20px;${i ? `border-top:1px solid ${BORDER};` : ''}font-family:${FONT};font-size:16px;line-height:22px;color:${MUTED};">${escapeHtml(label)}</td>
    <td align="right" style="padding:20px;${i ? `border-top:1px solid ${BORDER};` : ''}font-family:${FONT};font-size:16px;line-height:22px;font-weight:600;color:${HEADING};">${escapeHtml(value)}</td>
  </tr>`,
    )
    .join('');
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px;border:1px solid ${BORDER};border-collapse:separate;border-radius:14px;overflow:hidden;">
  <tr>
    <td colspan="2" style="padding:16px 20px;background:${CARD};border-bottom:1px solid ${BORDER};border-radius:14px 14px 0 0;font-family:${FONT};font-size:15px;line-height:20px;color:#9CA3AF;">${escapeHtml(title)}</td>
  </tr>${body}
</table>`;
}

// The three trust cards from the design. Always side by side, even on phones —
// they just tighten up there (see .feature* in the <style>).
function featureRow() {
  const card = (icon, label) => `
    <td class="feature" width="33.33%" valign="top" style="padding:0 5px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CARD};border-radius:14px;">
        <tr><td align="center" class="feature-pad" style="padding:24px 12px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td align="center" width="40" height="40" style="width:40px;height:40px;background:${BRAND_TINT};border-radius:10px;">
              <img src="${icon}" width="20" height="20" alt="" style="display:block;border:0;width:20px;height:20px;" />
            </td>
          </tr></table>
        </td></tr>
        <tr><td align="center" class="feature-pad feature-label" style="padding:6px 12px 24px;font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED};">${label}</td></tr>
      </table>
    </td>`;
  return `
<tr>
  <td class="px" style="padding:20px 34px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>${card(ASSETS.iconEscrow, 'Escrow Protected')}${card(ASSETS.iconPayments, 'Secure Payments')}${card(ASSETS.iconSupport, '24/7 Support')}
      </tr>
    </table>
  </td>
</tr>`;
}

function socialIcon(icon, url, alt) {
  return `
<td style="padding-left:8px;">
  <a href="${url}" target="_blank" style="display:block;width:40px;height:40px;background:${BRAND_TINT};border-radius:10px;text-align:center;">
    <img src="${icon}" width="20" height="20" alt="${alt}" style="display:inline-block;border:0;width:20px;height:20px;margin-top:10px;" />
  </a>
</td>`;
}

function logoLockup(size) {
  const textSize = Math.round(size * 0.55);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="padding-right:14px;"><img src="${ASSETS.logo}" width="${size}" height="${size}" alt="Declut" style="display:block;border:0;width:${size}px;height:${size}px;" /></td>
    <td style="font-family:${FONT};font-size:${textSize}px;line-height:${size}px;font-weight:800;color:${BRAND};letter-spacing:-0.5px;">Declut</td>
  </tr>
</table>`;
}

/**
 * Wraps a template body in the full Declut frame.
 * @param {object} opts
 * @param {string} opts.title       <title> and fallback subject.
 * @param {string} opts.preheader   Hidden preview line shown in the inbox list.
 * @param {string} opts.body        HTML built from the helpers above.
 * @param {boolean} [opts.features] Show the three trust cards (default true).
 */
function layout({ title, preheader, body, features = true }) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light only" />
<title>${escapeHtml(title)}</title>
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
  img { border:0; outline:none; text-decoration:none; }
  table { border-collapse:collapse; }
  @media only screen and (max-width:620px) {
    .container { width:100% !important; }
    .px { padding-left:20px !important; padding-right:20px !important; }
    .header-logo { padding:28px 20px !important; }
    .banner { width:150px !important; height:auto !important; }
    .feature { padding:0 3px !important; }
    .feature-pad { padding-left:4px !important; padding-right:4px !important; }
    .feature-label { font-size:12px !important; line-height:16px !important; }
    .footer-col { display:block !important; width:100% !important; text-align:left !important; }
    .footer-social { padding-top:20px !important; }
    .btn { display:block !important; text-align:center !important; }
    .otp-digits { font-size:40px !important; line-height:52px !important; letter-spacing:5px !important; padding:10px 14px !important; }
    .otp-cell { padding-left:6px !important; }
    .otp-cell:first-child { padding-left:0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#FFFFFF;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader || '')}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;">
  <tr>
    <td align="center" style="padding:0;">
      <!-- Fluid: fills the phone screen edge to edge even where media queries are
           ignored (some Gmail apps), capped at 600px on wider screens. Outlook
           desktop ignores max-width, so it gets a fixed 600px wrapper instead. -->
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" class="container" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;">

        <!-- Header -->
        <tr>
          <td style="background:${BRAND_TINT};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="header-logo" valign="middle" style="padding:40px 34px;">${logoLockup(52)}</td>
                <td align="right" valign="bottom" style="padding:16px 0 0;">
                  <img class="banner" src="${ASSETS.banner}" width="200" height="127" alt="" style="display:block;border:0;width:200px;height:127px;" />
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td class="px" style="padding:44px 40px 12px;">${body}
          </td>
        </tr>
${features ? featureRow() : '<tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>'}
        <!-- Footer -->
        <tr>
          <td style="border-top:1px solid ${BORDER};"></td>
        </tr>
        <tr>
          <td class="px" style="padding:32px 40px 36px;">
            ${logoLockup(30)}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
              <tr>
                <td class="footer-col" valign="bottom" style="font-family:${FONT};font-size:13px;line-height:22px;color:${MUTED};">
                  ${ADDRESS}<br />
                  <a href="${LINKS.unsubscribe}" style="color:${BRAND};text-decoration:none;">Unsubscribe</a> &middot;
                  <a href="${LINKS.privacy}" style="color:${BRAND};text-decoration:none;">Privacy Policy</a> &middot;
                  <a href="${LINKS.terms}" style="color:${BRAND};text-decoration:none;">Terms of Use</a>
                </td>
                <td class="footer-col footer-social" align="right" valign="bottom">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right" style="display:inline-table;">
                    <tr>${socialIcon(ASSETS.instagram, LINKS.instagram, 'Instagram')}${socialIcon(ASSETS.x, LINKS.x, 'X')}${socialIcon(ASSETS.facebook, LINKS.facebook, 'Facebook')}${socialIcon(ASSETS.tiktok, LINKS.tiktok, 'TikTok')}${socialIcon(ASSETS.whatsapp, LINKS.whatsapp, 'WhatsApp')}</tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
}

module.exports = {
  BRAND,
  LINKS,
  escapeHtml,
  heading,
  greeting,
  formatNaira,
  subtitle,
  paragraph,
  richText,
  messageBox,
  button,
  codeBox,
  otpCode,
  notice,
  detailsTable,
  layout,
};
