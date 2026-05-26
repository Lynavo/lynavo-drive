const CHINA_PHONE_RE = /^1[3-9]\d{9}$/;

export function isValidChinaPhone(phone: string): boolean {
  return CHINA_PHONE_RE.test(phone);
}

export function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length === 0) return '***';

  let countryCode = '';
  let nationalNumber = trimmed;

  if (trimmed.startsWith('+')) {
    const prefixes = ['+886', '+852', '+853', '+86', '+65', '+44', '+1'];
    let matched = false;
    for (const prefix of prefixes) {
      if (trimmed.startsWith(prefix)) {
        countryCode = prefix;
        nationalNumber = trimmed.slice(prefix.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (trimmed.length > 3) {
        countryCode = trimmed.slice(0, 3);
        nationalNumber = trimmed.slice(3);
      } else {
        countryCode = '+';
        nationalNumber = trimmed.slice(1);
      }
    }
  }

  const len = nationalNumber.length;
  if (len <= 4) {
    return '***';
  }

  let maskedNational = '';
  if (len <= 7) {
    maskedNational = nationalNumber[0] + '***' + nationalNumber[len - 1];
  } else if (len <= 9) {
    maskedNational = nationalNumber.slice(0, 2) + '****' + nationalNumber.slice(len - 2);
  } else {
    maskedNational = nationalNumber.slice(0, 3) + '****' + nationalNumber.slice(len - 4);
  }

  return countryCode + maskedNational;
}
