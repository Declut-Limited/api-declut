// Only Nigeria is supported right now — explicit instruction ("country code
// must be +234"). Splits a validated raw phone (RegisterDto's own
// ^(?:\+234[789]\d{9}|0[789]\d{9})$ shape) into {phoneNumber, countryCode},
// stripping the country code and any leading 0 so phoneNumber is always the
// bare local subscriber number.
const NIGERIA_COUNTRY_CODE = '+234';

export function normalizeNigerianPhone(raw: string): {
  phoneNumber: string;
  countryCode: string;
} {
  let digits = raw.trim();
  if (digits.startsWith('+234')) {
    digits = digits.slice(4);
  } else if (digits.startsWith('234')) {
    digits = digits.slice(3);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return { phoneNumber: digits, countryCode: NIGERIA_COUNTRY_CODE };
}
