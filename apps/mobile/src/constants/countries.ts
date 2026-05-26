export interface CountryCodeInfo {
  code: string;        // Phone prefix (e.g. "+86")
  iso: string;         // ISO 3166-1 alpha-2 (e.g. "CN")
  nameEn: string;      // English name (e.g. "China")
  flag: string;        // Flag emoji (e.g. "🇨🇳")
  minLength: number;   // Minimum phone length
  maxLength: number;   // Maximum phone length
}

export const COUNTRY_CODES: CountryCodeInfo[] = [
  {
    "code": "+93",
    "iso": "AF",
    "nameEn": "Afghanistan",
    "flag": "🇦🇫",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+358",
    "iso": "AX",
    "nameEn": "Aland",
    "flag": "🇦🇽",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+355",
    "iso": "AL",
    "nameEn": "Albania",
    "flag": "🇦🇱",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+213",
    "iso": "DZ",
    "nameEn": "Algeria",
    "flag": "🇩🇿",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1684",
    "iso": "AS",
    "nameEn": "American Samoa",
    "flag": "🇦🇸",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+376",
    "iso": "AD",
    "nameEn": "Andorra",
    "flag": "🇦🇩",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+244",
    "iso": "AO",
    "nameEn": "Angola",
    "flag": "🇦🇴",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1264",
    "iso": "AI",
    "nameEn": "Anguilla",
    "flag": "🇦🇮",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+672",
    "iso": "AQ",
    "nameEn": "Antarctica",
    "flag": "🇦🇶",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1268",
    "iso": "AG",
    "nameEn": "Antigua and Barbuda",
    "flag": "🇦🇬",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+54",
    "iso": "AR",
    "nameEn": "Argentina",
    "flag": "🇦🇷",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+374",
    "iso": "AM",
    "nameEn": "Armenia",
    "flag": "🇦🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+297",
    "iso": "AW",
    "nameEn": "Aruba",
    "flag": "🇦🇼",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+247",
    "iso": "AC",
    "nameEn": "Ascension Island",
    "flag": "🇦🇨",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+61",
    "iso": "AU",
    "nameEn": "Australia",
    "flag": "🇦🇺",
    "minLength": 9,
    "maxLength": 9
  },
  {
    "code": "+43",
    "iso": "AT",
    "nameEn": "Austria",
    "flag": "🇦🇹",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+994",
    "iso": "AZ",
    "nameEn": "Azerbaijan",
    "flag": "🇦🇿",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1242",
    "iso": "BS",
    "nameEn": "Bahamas",
    "flag": "🇧🇸",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+973",
    "iso": "BH",
    "nameEn": "Bahrain",
    "flag": "🇧🇭",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+880",
    "iso": "BD",
    "nameEn": "Bangladesh",
    "flag": "🇧🇩",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1246",
    "iso": "BB",
    "nameEn": "Barbados",
    "flag": "🇧🇧",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+375",
    "iso": "BY",
    "nameEn": "Belarus",
    "flag": "🇧🇾",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+32",
    "iso": "BE",
    "nameEn": "Belgium",
    "flag": "🇧🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+501",
    "iso": "BZ",
    "nameEn": "Belize",
    "flag": "🇧🇿",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+229",
    "iso": "BJ",
    "nameEn": "Benin",
    "flag": "🇧🇯",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1441",
    "iso": "BM",
    "nameEn": "Bermuda",
    "flag": "🇧🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+975",
    "iso": "BT",
    "nameEn": "Bhutan",
    "flag": "🇧🇹",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+591",
    "iso": "BO",
    "nameEn": "Bolivia",
    "flag": "🇧🇴",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+5997",
    "iso": "BQ",
    "nameEn": "Bonaire",
    "flag": "🇧🇶",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+387",
    "iso": "BA",
    "nameEn": "Bosnia and Herzegovina",
    "flag": "🇧🇦",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+267",
    "iso": "BW",
    "nameEn": "Botswana",
    "flag": "🇧🇼",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+47",
    "iso": "BV",
    "nameEn": "Bouvet Island",
    "flag": "🇧🇻",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+55",
    "iso": "BR",
    "nameEn": "Brazil",
    "flag": "🇧🇷",
    "minLength": 10,
    "maxLength": 11
  },
  {
    "code": "+246",
    "iso": "IO",
    "nameEn": "British Indian Ocean Territory",
    "flag": "🇮🇴",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1284",
    "iso": "VG",
    "nameEn": "British Virgin Islands",
    "flag": "🇻🇬",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+673",
    "iso": "BN",
    "nameEn": "Brunei",
    "flag": "🇧🇳",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+359",
    "iso": "BG",
    "nameEn": "Bulgaria",
    "flag": "🇧🇬",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+226",
    "iso": "BF",
    "nameEn": "Burkina Faso",
    "flag": "🇧🇫",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+257",
    "iso": "BI",
    "nameEn": "Burundi",
    "flag": "🇧🇮",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+855",
    "iso": "KH",
    "nameEn": "Cambodia",
    "flag": "🇰🇭",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+237",
    "iso": "CM",
    "nameEn": "Cameroon",
    "flag": "🇨🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1",
    "iso": "CA",
    "nameEn": "Canada",
    "flag": "🇨🇦",
    "minLength": 10,
    "maxLength": 10
  },
  {
    "code": "+238",
    "iso": "CV",
    "nameEn": "Cape Verde",
    "flag": "🇨🇻",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1345",
    "iso": "KY",
    "nameEn": "Cayman Islands",
    "flag": "🇰🇾",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+236",
    "iso": "CF",
    "nameEn": "Central African Republic",
    "flag": "🇨🇫",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+235",
    "iso": "TD",
    "nameEn": "Chad",
    "flag": "🇹🇩",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+56",
    "iso": "CL",
    "nameEn": "Chile",
    "flag": "🇨🇱",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+86",
    "iso": "CN",
    "nameEn": "China",
    "flag": "🇨🇳",
    "minLength": 11,
    "maxLength": 11
  },
  {
    "code": "+61",
    "iso": "CX",
    "nameEn": "Christmas Island",
    "flag": "🇨🇽",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+61",
    "iso": "CC",
    "nameEn": "Cocos (Keeling) Islands",
    "flag": "🇨🇨",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+57",
    "iso": "CO",
    "nameEn": "Colombia",
    "flag": "🇨🇴",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+269",
    "iso": "KM",
    "nameEn": "Comoros",
    "flag": "🇰🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+682",
    "iso": "CK",
    "nameEn": "Cook Islands",
    "flag": "🇨🇰",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+506",
    "iso": "CR",
    "nameEn": "Costa Rica",
    "flag": "🇨🇷",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+385",
    "iso": "HR",
    "nameEn": "Croatia",
    "flag": "🇭🇷",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+53",
    "iso": "CU",
    "nameEn": "Cuba",
    "flag": "🇨🇺",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+5999",
    "iso": "CW",
    "nameEn": "Curacao",
    "flag": "🇨🇼",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+357",
    "iso": "CY",
    "nameEn": "Cyprus",
    "flag": "🇨🇾",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+420",
    "iso": "CZ",
    "nameEn": "Czech Republic",
    "flag": "🇨🇿",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+243",
    "iso": "CD",
    "nameEn": "Democratic Republic of the Congo",
    "flag": "🇨🇩",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+45",
    "iso": "DK",
    "nameEn": "Denmark",
    "flag": "🇩🇰",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+253",
    "iso": "DJ",
    "nameEn": "Djibouti",
    "flag": "🇩🇯",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1767",
    "iso": "DM",
    "nameEn": "Dominica",
    "flag": "🇩🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1809",
    "iso": "DO",
    "nameEn": "Dominican Republic",
    "flag": "🇩🇴",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+670",
    "iso": "TL",
    "nameEn": "East Timor",
    "flag": "🇹🇱",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+593",
    "iso": "EC",
    "nameEn": "Ecuador",
    "flag": "🇪🇨",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+20",
    "iso": "EG",
    "nameEn": "Egypt",
    "flag": "🇪🇬",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+503",
    "iso": "SV",
    "nameEn": "El Salvador",
    "flag": "🇸🇻",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+240",
    "iso": "GQ",
    "nameEn": "Equatorial Guinea",
    "flag": "🇬🇶",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+291",
    "iso": "ER",
    "nameEn": "Eritrea",
    "flag": "🇪🇷",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+372",
    "iso": "EE",
    "nameEn": "Estonia",
    "flag": "🇪🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+268",
    "iso": "SZ",
    "nameEn": "Eswatini",
    "flag": "🇸🇿",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+251",
    "iso": "ET",
    "nameEn": "Ethiopia",
    "flag": "🇪🇹",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+500",
    "iso": "FK",
    "nameEn": "Falkland Islands",
    "flag": "🇫🇰",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+298",
    "iso": "FO",
    "nameEn": "Faroe Islands",
    "flag": "🇫🇴",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+679",
    "iso": "FJ",
    "nameEn": "Fiji",
    "flag": "🇫🇯",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+358",
    "iso": "FI",
    "nameEn": "Finland",
    "flag": "🇫🇮",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+33",
    "iso": "FR",
    "nameEn": "France",
    "flag": "🇫🇷",
    "minLength": 9,
    "maxLength": 9
  },
  {
    "code": "+594",
    "iso": "GF",
    "nameEn": "French Guiana",
    "flag": "🇬🇫",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+689",
    "iso": "PF",
    "nameEn": "French Polynesia",
    "flag": "🇵🇫",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+262",
    "iso": "TF",
    "nameEn": "French Southern Territories",
    "flag": "🇹🇫",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+241",
    "iso": "GA",
    "nameEn": "Gabon",
    "flag": "🇬🇦",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+220",
    "iso": "GM",
    "nameEn": "Gambia",
    "flag": "🇬🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+995",
    "iso": "GE",
    "nameEn": "Georgia",
    "flag": "🇬🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+49",
    "iso": "DE",
    "nameEn": "Germany",
    "flag": "🇩🇪",
    "minLength": 10,
    "maxLength": 11
  },
  {
    "code": "+233",
    "iso": "GH",
    "nameEn": "Ghana",
    "flag": "🇬🇭",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+350",
    "iso": "GI",
    "nameEn": "Gibraltar",
    "flag": "🇬🇮",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+30",
    "iso": "GR",
    "nameEn": "Greece",
    "flag": "🇬🇷",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+299",
    "iso": "GL",
    "nameEn": "Greenland",
    "flag": "🇬🇱",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1473",
    "iso": "GD",
    "nameEn": "Grenada",
    "flag": "🇬🇩",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+590",
    "iso": "GP",
    "nameEn": "Guadeloupe",
    "flag": "🇬🇵",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1671",
    "iso": "GU",
    "nameEn": "Guam",
    "flag": "🇬🇺",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+502",
    "iso": "GT",
    "nameEn": "Guatemala",
    "flag": "🇬🇹",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+44",
    "iso": "GG",
    "nameEn": "Guernsey",
    "flag": "🇬🇬",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+224",
    "iso": "GN",
    "nameEn": "Guinea",
    "flag": "🇬🇳",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+245",
    "iso": "GW",
    "nameEn": "Guinea-Bissau",
    "flag": "🇬🇼",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+592",
    "iso": "GY",
    "nameEn": "Guyana",
    "flag": "🇬🇾",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+509",
    "iso": "HT",
    "nameEn": "Haiti",
    "flag": "🇭🇹",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+61",
    "iso": "HM",
    "nameEn": "Heard Island and McDonald Islands",
    "flag": "🇭🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+504",
    "iso": "HN",
    "nameEn": "Honduras",
    "flag": "🇭🇳",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+852",
    "iso": "HK",
    "nameEn": "Hong Kong",
    "flag": "🇭🇰",
    "minLength": 8,
    "maxLength": 8
  },
  {
    "code": "+36",
    "iso": "HU",
    "nameEn": "Hungary",
    "flag": "🇭🇺",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+354",
    "iso": "IS",
    "nameEn": "Iceland",
    "flag": "🇮🇸",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+91",
    "iso": "IN",
    "nameEn": "India",
    "flag": "🇮🇳",
    "minLength": 10,
    "maxLength": 10
  },
  {
    "code": "+62",
    "iso": "ID",
    "nameEn": "Indonesia",
    "flag": "🇮🇩",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+98",
    "iso": "IR",
    "nameEn": "Iran",
    "flag": "🇮🇷",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+964",
    "iso": "IQ",
    "nameEn": "Iraq",
    "flag": "🇮🇶",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+353",
    "iso": "IE",
    "nameEn": "Ireland",
    "flag": "🇮🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+44",
    "iso": "IM",
    "nameEn": "Isle of Man",
    "flag": "🇮🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+972",
    "iso": "IL",
    "nameEn": "Israel",
    "flag": "🇮🇱",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+39",
    "iso": "IT",
    "nameEn": "Italy",
    "flag": "🇮🇹",
    "minLength": 9,
    "maxLength": 10
  },
  {
    "code": "+225",
    "iso": "CI",
    "nameEn": "Ivory Coast",
    "flag": "🇨🇮",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1876",
    "iso": "JM",
    "nameEn": "Jamaica",
    "flag": "🇯🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+81",
    "iso": "JP",
    "nameEn": "Japan",
    "flag": "🇯🇵",
    "minLength": 9,
    "maxLength": 10
  },
  {
    "code": "+44",
    "iso": "JE",
    "nameEn": "Jersey",
    "flag": "🇯🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+962",
    "iso": "JO",
    "nameEn": "Jordan",
    "flag": "🇯🇴",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+7",
    "iso": "KZ",
    "nameEn": "Kazakhstan",
    "flag": "🇰🇿",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+254",
    "iso": "KE",
    "nameEn": "Kenya",
    "flag": "🇰🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+686",
    "iso": "KI",
    "nameEn": "Kiribati",
    "flag": "🇰🇮",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+377",
    "iso": "XK",
    "nameEn": "Kosovo",
    "flag": "🇽🇰",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+965",
    "iso": "KW",
    "nameEn": "Kuwait",
    "flag": "🇰🇼",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+996",
    "iso": "KG",
    "nameEn": "Kyrgyzstan",
    "flag": "🇰🇬",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+856",
    "iso": "LA",
    "nameEn": "Laos",
    "flag": "🇱🇦",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+371",
    "iso": "LV",
    "nameEn": "Latvia",
    "flag": "🇱🇻",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+961",
    "iso": "LB",
    "nameEn": "Lebanon",
    "flag": "🇱🇧",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+266",
    "iso": "LS",
    "nameEn": "Lesotho",
    "flag": "🇱🇸",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+231",
    "iso": "LR",
    "nameEn": "Liberia",
    "flag": "🇱🇷",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+218",
    "iso": "LY",
    "nameEn": "Libya",
    "flag": "🇱🇾",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+423",
    "iso": "LI",
    "nameEn": "Liechtenstein",
    "flag": "🇱🇮",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+370",
    "iso": "LT",
    "nameEn": "Lithuania",
    "flag": "🇱🇹",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+352",
    "iso": "LU",
    "nameEn": "Luxembourg",
    "flag": "🇱🇺",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+853",
    "iso": "MO",
    "nameEn": "Macao",
    "flag": "🇲🇴",
    "minLength": 8,
    "maxLength": 8
  },
  {
    "code": "+261",
    "iso": "MG",
    "nameEn": "Madagascar",
    "flag": "🇲🇬",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+265",
    "iso": "MW",
    "nameEn": "Malawi",
    "flag": "🇲🇼",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+60",
    "iso": "MY",
    "nameEn": "Malaysia",
    "flag": "🇲🇾",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+960",
    "iso": "MV",
    "nameEn": "Maldives",
    "flag": "🇲🇻",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+223",
    "iso": "ML",
    "nameEn": "Mali",
    "flag": "🇲🇱",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+356",
    "iso": "MT",
    "nameEn": "Malta",
    "flag": "🇲🇹",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+692",
    "iso": "MH",
    "nameEn": "Marshall Islands",
    "flag": "🇲🇭",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+596",
    "iso": "MQ",
    "nameEn": "Martinique",
    "flag": "🇲🇶",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+222",
    "iso": "MR",
    "nameEn": "Mauritania",
    "flag": "🇲🇷",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+230",
    "iso": "MU",
    "nameEn": "Mauritius",
    "flag": "🇲🇺",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+262",
    "iso": "YT",
    "nameEn": "Mayotte",
    "flag": "🇾🇹",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+52",
    "iso": "MX",
    "nameEn": "Mexico",
    "flag": "🇲🇽",
    "minLength": 10,
    "maxLength": 10
  },
  {
    "code": "+691",
    "iso": "FM",
    "nameEn": "Micronesia",
    "flag": "🇫🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+373",
    "iso": "MD",
    "nameEn": "Moldova",
    "flag": "🇲🇩",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+377",
    "iso": "MC",
    "nameEn": "Monaco",
    "flag": "🇲🇨",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+976",
    "iso": "MN",
    "nameEn": "Mongolia",
    "flag": "🇲🇳",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+382",
    "iso": "ME",
    "nameEn": "Montenegro",
    "flag": "🇲🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1664",
    "iso": "MS",
    "nameEn": "Montserrat",
    "flag": "🇲🇸",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+212",
    "iso": "MA",
    "nameEn": "Morocco",
    "flag": "🇲🇦",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+258",
    "iso": "MZ",
    "nameEn": "Mozambique",
    "flag": "🇲🇿",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+95",
    "iso": "MM",
    "nameEn": "Myanmar (Burma)",
    "flag": "🇲🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+264",
    "iso": "NA",
    "nameEn": "Namibia",
    "flag": "🇳🇦",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+674",
    "iso": "NR",
    "nameEn": "Nauru",
    "flag": "🇳🇷",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+977",
    "iso": "NP",
    "nameEn": "Nepal",
    "flag": "🇳🇵",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+31",
    "iso": "NL",
    "nameEn": "Netherlands",
    "flag": "🇳🇱",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+687",
    "iso": "NC",
    "nameEn": "New Caledonia",
    "flag": "🇳🇨",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+64",
    "iso": "NZ",
    "nameEn": "New Zealand",
    "flag": "🇳🇿",
    "minLength": 8,
    "maxLength": 10
  },
  {
    "code": "+505",
    "iso": "NI",
    "nameEn": "Nicaragua",
    "flag": "🇳🇮",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+227",
    "iso": "NE",
    "nameEn": "Niger",
    "flag": "🇳🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+234",
    "iso": "NG",
    "nameEn": "Nigeria",
    "flag": "🇳🇬",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+683",
    "iso": "NU",
    "nameEn": "Niue",
    "flag": "🇳🇺",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+672",
    "iso": "NF",
    "nameEn": "Norfolk Island",
    "flag": "🇳🇫",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+850",
    "iso": "KP",
    "nameEn": "North Korea",
    "flag": "🇰🇵",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+389",
    "iso": "MK",
    "nameEn": "North Macedonia",
    "flag": "🇲🇰",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1670",
    "iso": "MP",
    "nameEn": "Northern Mariana Islands",
    "flag": "🇲🇵",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+47",
    "iso": "NO",
    "nameEn": "Norway",
    "flag": "🇳🇴",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+968",
    "iso": "OM",
    "nameEn": "Oman",
    "flag": "🇴🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+92",
    "iso": "PK",
    "nameEn": "Pakistan",
    "flag": "🇵🇰",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+680",
    "iso": "PW",
    "nameEn": "Palau",
    "flag": "🇵🇼",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+970",
    "iso": "PS",
    "nameEn": "Palestine",
    "flag": "🇵🇸",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+507",
    "iso": "PA",
    "nameEn": "Panama",
    "flag": "🇵🇦",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+675",
    "iso": "PG",
    "nameEn": "Papua New Guinea",
    "flag": "🇵🇬",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+595",
    "iso": "PY",
    "nameEn": "Paraguay",
    "flag": "🇵🇾",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+51",
    "iso": "PE",
    "nameEn": "Peru",
    "flag": "🇵🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+63",
    "iso": "PH",
    "nameEn": "Philippines",
    "flag": "🇵🇭",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+64",
    "iso": "PN",
    "nameEn": "Pitcairn Islands",
    "flag": "🇵🇳",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+48",
    "iso": "PL",
    "nameEn": "Poland",
    "flag": "🇵🇱",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+351",
    "iso": "PT",
    "nameEn": "Portugal",
    "flag": "🇵🇹",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1787",
    "iso": "PR",
    "nameEn": "Puerto Rico",
    "flag": "🇵🇷",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+974",
    "iso": "QA",
    "nameEn": "Qatar",
    "flag": "🇶🇦",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+242",
    "iso": "CG",
    "nameEn": "Republic of the Congo",
    "flag": "🇨🇬",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+262",
    "iso": "RE",
    "nameEn": "Reunion",
    "flag": "🇷🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+40",
    "iso": "RO",
    "nameEn": "Romania",
    "flag": "🇷🇴",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+7",
    "iso": "RU",
    "nameEn": "Russia",
    "flag": "🇷🇺",
    "minLength": 10,
    "maxLength": 10
  },
  {
    "code": "+250",
    "iso": "RW",
    "nameEn": "Rwanda",
    "flag": "🇷🇼",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+590",
    "iso": "BL",
    "nameEn": "Saint Barthelemy",
    "flag": "🇧🇱",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+290",
    "iso": "SH",
    "nameEn": "Saint Helena",
    "flag": "🇸🇭",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1869",
    "iso": "KN",
    "nameEn": "Saint Kitts and Nevis",
    "flag": "🇰🇳",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1758",
    "iso": "LC",
    "nameEn": "Saint Lucia",
    "flag": "🇱🇨",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+590",
    "iso": "MF",
    "nameEn": "Saint Martin",
    "flag": "🇲🇫",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+508",
    "iso": "PM",
    "nameEn": "Saint Pierre and Miquelon",
    "flag": "🇵🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1784",
    "iso": "VC",
    "nameEn": "Saint Vincent and the Grenadines",
    "flag": "🇻🇨",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+685",
    "iso": "WS",
    "nameEn": "Samoa",
    "flag": "🇼🇸",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+378",
    "iso": "SM",
    "nameEn": "San Marino",
    "flag": "🇸🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+239",
    "iso": "ST",
    "nameEn": "Sao Tome and Principe",
    "flag": "🇸🇹",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+966",
    "iso": "SA",
    "nameEn": "Saudi Arabia",
    "flag": "🇸🇦",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+221",
    "iso": "SN",
    "nameEn": "Senegal",
    "flag": "🇸🇳",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+381",
    "iso": "RS",
    "nameEn": "Serbia",
    "flag": "🇷🇸",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+248",
    "iso": "SC",
    "nameEn": "Seychelles",
    "flag": "🇸🇨",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+232",
    "iso": "SL",
    "nameEn": "Sierra Leone",
    "flag": "🇸🇱",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+65",
    "iso": "SG",
    "nameEn": "Singapore",
    "flag": "🇸🇬",
    "minLength": 8,
    "maxLength": 8
  },
  {
    "code": "+1721",
    "iso": "SX",
    "nameEn": "Sint Maarten",
    "flag": "🇸🇽",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+421",
    "iso": "SK",
    "nameEn": "Slovakia",
    "flag": "🇸🇰",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+386",
    "iso": "SI",
    "nameEn": "Slovenia",
    "flag": "🇸🇮",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+677",
    "iso": "SB",
    "nameEn": "Solomon Islands",
    "flag": "🇸🇧",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+252",
    "iso": "SO",
    "nameEn": "Somalia",
    "flag": "🇸🇴",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+27",
    "iso": "ZA",
    "nameEn": "South Africa",
    "flag": "🇿🇦",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+500",
    "iso": "GS",
    "nameEn": "South Georgia and the South Sandwich Islands",
    "flag": "🇬🇸",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+82",
    "iso": "KR",
    "nameEn": "South Korea",
    "flag": "🇰🇷",
    "minLength": 9,
    "maxLength": 10
  },
  {
    "code": "+211",
    "iso": "SS",
    "nameEn": "South Sudan",
    "flag": "🇸🇸",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+34",
    "iso": "ES",
    "nameEn": "Spain",
    "flag": "🇪🇸",
    "minLength": 9,
    "maxLength": 9
  },
  {
    "code": "+94",
    "iso": "LK",
    "nameEn": "Sri Lanka",
    "flag": "🇱🇰",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+249",
    "iso": "SD",
    "nameEn": "Sudan",
    "flag": "🇸🇩",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+597",
    "iso": "SR",
    "nameEn": "Suriname",
    "flag": "🇸🇷",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+4779",
    "iso": "SJ",
    "nameEn": "Svalbard and Jan Mayen",
    "flag": "🇸🇯",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+46",
    "iso": "SE",
    "nameEn": "Sweden",
    "flag": "🇸🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+41",
    "iso": "CH",
    "nameEn": "Switzerland",
    "flag": "🇨🇭",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+963",
    "iso": "SY",
    "nameEn": "Syria",
    "flag": "🇸🇾",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+886",
    "iso": "TW",
    "nameEn": "Taiwan",
    "flag": "🇹🇼",
    "minLength": 9,
    "maxLength": 9
  },
  {
    "code": "+992",
    "iso": "TJ",
    "nameEn": "Tajikistan",
    "flag": "🇹🇯",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+255",
    "iso": "TZ",
    "nameEn": "Tanzania",
    "flag": "🇹🇿",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+66",
    "iso": "TH",
    "nameEn": "Thailand",
    "flag": "🇹🇭",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+228",
    "iso": "TG",
    "nameEn": "Togo",
    "flag": "🇹🇬",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+690",
    "iso": "TK",
    "nameEn": "Tokelau",
    "flag": "🇹🇰",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+676",
    "iso": "TO",
    "nameEn": "Tonga",
    "flag": "🇹🇴",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1868",
    "iso": "TT",
    "nameEn": "Trinidad and Tobago",
    "flag": "🇹🇹",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+290",
    "iso": "TA",
    "nameEn": "Tristan da Cunha",
    "flag": "🇹🇦",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+216",
    "iso": "TN",
    "nameEn": "Tunisia",
    "flag": "🇹🇳",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+90",
    "iso": "TR",
    "nameEn": "Türkiye",
    "flag": "🇹🇷",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+993",
    "iso": "TM",
    "nameEn": "Turkmenistan",
    "flag": "🇹🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1649",
    "iso": "TC",
    "nameEn": "Turks and Caicos Islands",
    "flag": "🇹🇨",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+688",
    "iso": "TV",
    "nameEn": "Tuvalu",
    "flag": "🇹🇻",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1",
    "iso": "UM",
    "nameEn": "U.S. Minor Outlying Islands",
    "flag": "🇺🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+1340",
    "iso": "VI",
    "nameEn": "U.S. Virgin Islands",
    "flag": "🇻🇮",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+256",
    "iso": "UG",
    "nameEn": "Uganda",
    "flag": "🇺🇬",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+380",
    "iso": "UA",
    "nameEn": "Ukraine",
    "flag": "🇺🇦",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+971",
    "iso": "AE",
    "nameEn": "United Arab Emirates",
    "flag": "🇦🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+44",
    "iso": "GB",
    "nameEn": "United Kingdom",
    "flag": "🇬🇧",
    "minLength": 9,
    "maxLength": 10
  },
  {
    "code": "+1",
    "iso": "US",
    "nameEn": "United States",
    "flag": "🇺🇸",
    "minLength": 10,
    "maxLength": 10
  },
  {
    "code": "+598",
    "iso": "UY",
    "nameEn": "Uruguay",
    "flag": "🇺🇾",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+998",
    "iso": "UZ",
    "nameEn": "Uzbekistan",
    "flag": "🇺🇿",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+678",
    "iso": "VU",
    "nameEn": "Vanuatu",
    "flag": "🇻🇺",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+379",
    "iso": "VA",
    "nameEn": "Vatican City",
    "flag": "🇻🇦",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+58",
    "iso": "VE",
    "nameEn": "Venezuela",
    "flag": "🇻🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+84",
    "iso": "VN",
    "nameEn": "Vietnam",
    "flag": "🇻🇳",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+681",
    "iso": "WF",
    "nameEn": "Wallis and Futuna",
    "flag": "🇼🇫",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+212",
    "iso": "EH",
    "nameEn": "Western Sahara",
    "flag": "🇪🇭",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+967",
    "iso": "YE",
    "nameEn": "Yemen",
    "flag": "🇾🇪",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+260",
    "iso": "ZM",
    "nameEn": "Zambia",
    "flag": "🇿🇲",
    "minLength": 8,
    "maxLength": 11
  },
  {
    "code": "+263",
    "iso": "ZW",
    "nameEn": "Zimbabwe",
    "flag": "🇿🇼",
    "minLength": 8,
    "maxLength": 11
  }
];
