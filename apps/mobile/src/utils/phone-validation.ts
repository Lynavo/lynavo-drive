const CHINA_PHONE_RE = /^1[3-9]\d{9}$/;

export function isValidChinaPhone(phone: string): boolean {
  return CHINA_PHONE_RE.test(phone);
}

export function maskPhone(phone: string): string {
  if (phone.length !== 11) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(7);
}
