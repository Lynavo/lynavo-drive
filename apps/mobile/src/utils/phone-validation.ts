const CHINA_PHONE_RE = /^1[3-9]\d{9}$/;

export function isValidChinaPhone(phone: string): boolean {
  return CHINA_PHONE_RE.test(phone);
}

export function maskPhone(phone: string): string {
  if (phone.length < 8) return '***';
  return phone.slice(0, phone.length - 8) + '****' + phone.slice(phone.length - 4);
}
