import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = 1280;
const HEIGHT = 640;
const FPS = 24;
const DURATION = 8;
const FRAME_COUNT = FPS * DURATION;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const outputDirectory = resolve(repositoryRoot, 'pics');
const logoPath = resolve(repositoryRoot, 'pics/banner-logo.png');
const logoData = readFileSync(logoPath).toString('base64');

const colors = {
  surface: '#FFFFFF',
  surfaceMuted: '#EEF4F8',
  border: '#D9E5ED',
  ink: '#17354A',
  muted: '#7890A1',
  primary: '#168CF2',
  primarySoft: '#DCEEFF',
  cyan: '#14B8D4',
  success: '#20A96B',
  successSoft: '#DDF7EA',
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smooth = (start, end, value) => {
  const progress = clamp((value - start) / (end - start));
  return progress * progress * (3 - 2 * progress);
};
const easeOutBack = (value) => {
  const progress = clamp(value);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (progress - 1) ** 3 + c1 * (progress - 1) ** 2;
};
const format = (value) => Number(value.toFixed(3));

function folderIcon(x, y, size, fill, opacity = 1) {
  return `<g opacity="${format(opacity)}">
    <path d="M ${x} ${y + size * 0.24} Q ${x} ${y} ${x + size * 0.24} ${y} H ${x + size * 0.48} L ${x + size * 0.62} ${y + size * 0.15} H ${x + size * 0.84} Q ${x + size} ${y + size * 0.15} ${x + size} ${y + size * 0.34} V ${y + size * 0.8} Q ${x + size} ${y + size} ${x + size * 0.8} ${y + size} H ${x + size * 0.2} Q ${x} ${y + size} ${x} ${y + size * 0.8} Z" fill="${fill}"/>
  </g>`;
}

function checkIcon(cx, cy, radius, opacity = 1) {
  return `<g opacity="${format(opacity)}" transform="translate(${2 * cx} 0) scale(-1 1)">
    <g transform="translate(${cx} ${cy}) scale(${format(0.72 + 0.28 * easeOutBack(opacity))}) translate(${-cx} ${-cy})">
      <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${colors.success}"/>
      <path d="M ${cx - radius * 0.48} ${cy} L ${cx - radius * 0.12} ${cy + radius * 0.34} L ${cx + radius * 0.54} ${cy - radius * 0.4}" fill="none" stroke="#FFFFFF" stroke-width="${radius * 0.2}" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </g>`;
}

function playBadge(cx, cy, radius, opacity = 1) {
  return `<g opacity="${format(opacity)}">
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="#17354A" fill-opacity="0.78"/>
    <path d="M ${cx + radius * 0.34} ${cy - radius * 0.48} L ${cx - radius * 0.42} ${cy} L ${cx + radius * 0.34} ${cy + radius * 0.48} Z" fill="#FFFFFF"/>
  </g>`;
}

function photoThumbnail(id, x, y, width, height, variant, opacity = 1) {
  const palettes = [
    ['#BEE8F5', '#4BA7C9', '#1C668D'],
    ['#FFE4C4', '#F3A25D', '#A85A53'],
    ['#DDF2DB', '#79B77B', '#386B58'],
    ['#E9E2FA', '#9C82CF', '#564584'],
    ['#FBE2EA', '#D9809C', '#8A4960'],
    ['#DDEBFA', '#6999D2', '#315883'],
  ];
  const [sky, hill, foreground] = palettes[variant % palettes.length];
  return `<g opacity="${format(opacity)}">
    <defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="7"/></clipPath></defs>
    <g clip-path="url(#${id})">
      <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${sky}"/>
      <circle cx="${x + width * 0.73}" cy="${y + height * 0.26}" r="${Math.min(width, height) * 0.12}" fill="#FFFFFF" opacity="0.88"/>
      <path d="M ${x - 2} ${y + height * 0.86} L ${x + width * 0.36} ${y + height * 0.38} L ${x + width * 0.68} ${y + height * 0.77} L ${x + width + 2} ${y + height * 0.48} V ${y + height + 2} H ${x - 2} Z" fill="${hill}"/>
      <path d="M ${x - 2} ${y + height * 0.95} L ${x + width * 0.38} ${y + height * 0.69} L ${x + width * 0.7} ${y + height * 0.91} L ${x + width + 2} ${y + height * 0.72} V ${y + height + 2} H ${x - 2} Z" fill="${foreground}"/>
    </g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="7" fill="none" stroke="#FFFFFF" stroke-opacity="0.62"/>
  </g>`;
}

function bezierPoint(progress, start, control, end) {
  const inverse = 1 - progress;
  return {
    x:
      inverse * inverse * start.x +
      2 * inverse * progress * control.x +
      progress * progress * end.x,
    y:
      inverse * inverse * start.y +
      2 * inverse * progress * control.y +
      progress * progress * end.y,
  };
}

function deviceChrome() {
  return `<g filter="url(#device-shadow)">
    <rect x="150" y="185" width="720" height="340" rx="20" fill="#17354A"/>
    <rect x="164" y="199" width="692" height="312" rx="10" fill="${colors.surface}"/>
    <circle cx="510" cy="192" r="3" fill="#7890A1"/>
    <path d="M 132 525 H 888 L 849 558 H 171 Z" fill="#D7E1E8"/>
    <path d="M 132 525 H 888 L 878 537 H 142 Z" fill="#EEF3F6"/>
    <path d="M 438 525 H 582 L 568 537 H 452 Z" fill="#C4D0D9"/>
  </g>
  <g filter="url(#device-shadow)">
    <rect x="932" y="205" width="178" height="365" rx="35" fill="#17354A"/>
    <rect x="941" y="214" width="160" height="347" rx="27" fill="${colors.surface}"/>
    <rect x="991" y="220" width="60" height="7" rx="3.5" fill="#17354A"/>
    <circle cx="1061" cy="223.5" r="3.5" fill="#294D62"/>
  </g>`;
}

function laptopBaseUi() {
  return `<g clip-path="url(#laptop-screen)">
    <rect x="164" y="199" width="692" height="312" fill="${colors.surface}"/>
    <rect x="164" y="199" width="692" height="34" fill="#F4F8FB"/>
    <circle cx="184" cy="216" r="4" fill="#EF6B63"/>
    <circle cx="198" cy="216" r="4" fill="#F0B553"/>
    <circle cx="212" cy="216" r="4" fill="#55B980"/>
    <rect x="164" y="233" width="91" height="278" fill="#F7FAFC"/>
    <rect x="180" y="255" width="58" height="8" rx="4" fill="${colors.border}"/>
    <rect x="180" y="278" width="44" height="7" rx="3.5" fill="${colors.border}"/>
    <rect x="180" y="301" width="52" height="7" rx="3.5" fill="${colors.border}"/>
    <rect x="180" y="324" width="38" height="7" rx="3.5" fill="${colors.border}"/>
    <line x1="255" y1="233" x2="255" y2="511" stroke="${colors.border}"/>
  </g>`;
}

function pairUi(time, opacity) {
  const digitCount = time >= 7.2 ? 0 : Math.floor(smooth(0.38, 1.05, time) * 6.01);
  const digits = ['5', '1', '7', '2', '8', '4'];
  const successOpacity = smooth(1.12, 1.38, time) * (1 - smooth(1.62, 1.9, time));
  let laptopDigits = '';
  let phoneDigits = '';

  digits.forEach((digit, index) => {
    const laptopX = 342 + index * 72;
    const phoneX = 957 + (index % 3) * 45;
    const phoneY = 327 + Math.floor(index / 3) * 52;
    laptopDigits += `<rect x="${laptopX}" y="330" width="54" height="66" rx="9" fill="${successOpacity > 0.2 ? colors.successSoft : colors.surfaceMuted}" stroke="${successOpacity > 0.2 ? colors.success : colors.border}"/>
      <text x="${laptopX + 27}" y="376" text-anchor="middle" transform="translate(${2 * (laptopX + 27)} 0) scale(-1 1)" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="31" font-weight="700" fill="${colors.ink}">${digit}</text>`;
    phoneDigits += `<rect x="${phoneX}" y="${phoneY}" width="35" height="40" rx="8" fill="${index < digitCount ? colors.primarySoft : colors.surfaceMuted}" stroke="${index < digitCount ? colors.primary : colors.border}"/>
      ${index < digitCount ? `<circle cx="${phoneX + 17.5}" cy="${phoneY + 20}" r="5" fill="${colors.primary}"/>` : ''}`;
  });

  return `<g opacity="${format(opacity)}" clip-path="url(#laptop-screen)">
    <rect x="285" y="268" width="40" height="40" rx="10" fill="${colors.primarySoft}"/>
    <path d="M 296 287 H 314 M 305 278 V 296" stroke="${colors.primary}" stroke-width="4" stroke-linecap="round"/>
    ${laptopDigits}
    <rect x="402" y="424" width="196" height="9" rx="4.5" fill="${colors.border}"/>
    <rect x="437" y="446" width="126" height="7" rx="3.5" fill="${colors.surfaceMuted}"/>
    ${checkIcon(635, 363, 21, successOpacity)}
  </g>
  <g opacity="${format(opacity)}" clip-path="url(#phone-screen)">
    <rect x="958" y="253" width="68" height="9" rx="4.5" fill="${colors.ink}"/>
    <rect x="958" y="272" width="104" height="6" rx="3" fill="${colors.border}"/>
    ${phoneDigits}
    <rect x="958" y="457" width="126" height="36" rx="18" fill="${digitCount === 6 ? colors.primary : colors.surfaceMuted}"/>
    <path d="M 1011 475 H 1032 M 1018 468 L 1011 475 L 1018 482" fill="none" stroke="${digitCount === 6 ? '#FFFFFF' : colors.muted}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${checkIcon(1021, 520, 18, successOpacity)}
  </g>`;
}

function galleryUi(time, opacity) {
  const uploads = Array.from({ length: 3 }, (_, index) =>
    smooth(1.92 + index * 0.4, 2.5 + index * 0.4, time),
  );
  let laptopPhotos = '';
  let phonePhotos = '';
  let flyingPhotos = '';

  for (let index = 0; index < 6; index += 1) {
    const laptopX = 303 + (index % 3) * 145;
    const laptopY = 307 + Math.floor(index / 3) * 94;
    const laptopOpacity = index < 3 ? uploads[index] : 0.16;
    laptopPhotos += photoThumbnail(
      `desktop-${index}`,
      laptopX,
      laptopY,
      124,
      76,
      index,
      laptopOpacity,
    );
    if (index === 2) laptopPhotos += playBadge(laptopX + 62, laptopY + 38, 14, laptopOpacity);

    const phoneX = 954 + (index % 3) * 43;
    const phoneY = 287 + Math.floor(index / 3) * 58;
    phonePhotos += photoThumbnail(`mobile-${index}`, phoneX, phoneY, 37, 51, index, 1);
    if (index === 2) phonePhotos += playBadge(phoneX + 18.5, phoneY + 25.5, 8, 1);
  }

  uploads.forEach((progress, index) => {
    if (progress <= 0 || progress >= 1) return;
    const point = bezierPoint(
      progress,
      { x: 1008, y: 366 },
      { x: 786, y: 262 },
      { x: 510, y: 351 },
    );
    const scale = 0.66 + 0.34 * Math.sin(Math.PI * progress);
    flyingPhotos += `<g transform="translate(${format(point.x)} ${format(point.y)}) scale(${format(scale)}) translate(-28 -20)" filter="url(#card-shadow)">
      ${photoThumbnail(`flying-${index}`, 0, 0, 56, 40, index, Math.sin(Math.PI * progress))}
      ${index === 2 ? playBadge(28, 20, 9, Math.sin(Math.PI * progress)) : ''}
    </g>`;
  });

  return `<g opacity="${format(opacity)}" clip-path="url(#laptop-screen)">
    <rect x="180" y="348" width="58" height="26" rx="7" fill="${colors.primarySoft}"/>
    ${folderIcon(190, 353, 17, colors.primary)}
    <rect x="289" y="258" width="105" height="11" rx="5.5" fill="${colors.ink}"/>
    <rect x="289" y="280" width="171" height="7" rx="3.5" fill="${colors.border}"/>
    ${laptopPhotos}
  </g>
  <g opacity="${format(opacity)}" clip-path="url(#phone-screen)">
    <rect x="954" y="252" width="76" height="9" rx="4.5" fill="${colors.ink}"/>
    <rect x="1064" y="249" width="22" height="22" rx="7" fill="${colors.primarySoft}"/>
    <path d="M 1069 260 H 1081 M 1075 254 V 266" stroke="${colors.primary}" stroke-width="2.5" stroke-linecap="round"/>
    ${phonePhotos}
    <rect x="954" y="430" width="132" height="9" rx="4.5" fill="${colors.surfaceMuted}"/>
    <rect x="954" y="430" width="${format(132 * uploads[2])}" height="9" rx="4.5" fill="${colors.primary}"/>
    <circle cx="1020" cy="474" r="22" fill="${colors.primarySoft}"/>
    <path d="M 1008 474 H 1032 M 1020 462 V 486" stroke="${colors.primary}" stroke-width="3" stroke-linecap="round"/>
  </g>
  <g opacity="${format(opacity)}">${flyingPhotos}</g>`;
}

function fileRows(x, y, width, rowHeight, selectedIndex, opacity = 1) {
  let rows = '';
  for (let index = 0; index < 4; index += 1) {
    const rowY = y + index * rowHeight;
    const selected = index === selectedIndex;
    rows += `<rect x="${x}" y="${rowY}" width="${width}" height="${rowHeight - 7}" rx="7" fill="${selected ? colors.primarySoft : colors.surface}" stroke="${selected ? colors.primary : colors.border}" stroke-opacity="${selected ? 0.7 : 1}"/>
      ${folderIcon(x + 11, rowY + 10, 20, selected ? colors.primary : '#9DB1BF')}
      <rect x="${x + 43}" y="${rowY + 11}" width="${width * (0.34 + index * 0.06)}" height="7" rx="3.5" fill="${selected ? colors.ink : colors.muted}"/>
      <rect x="${x + 43}" y="${rowY + 25}" width="${width * 0.2}" height="5" rx="2.5" fill="${colors.border}"/>
      <path d="M ${x + width - 13} ${rowY + 16} L ${x + width - 19} ${rowY + 22} L ${x + width - 13} ${rowY + 28}" fill="none" stroke="${selected ? colors.primary : colors.muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return `<g opacity="${format(opacity)}">${rows}</g>`;
}

function fileTypeIcon(x, y, size, type, selected = false) {
  const tint = selected ? colors.primary : colors.muted;
  const soft = selected ? colors.primarySoft : colors.surfaceMuted;
  if (type === 'image') {
    return `<g>
      <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="4" fill="${soft}"/>
      <circle cx="${x + size * 0.7}" cy="${y + size * 0.28}" r="${size * 0.1}" fill="${tint}"/>
      <path d="M ${x + 3} ${y + size - 4} L ${x + size * 0.42} ${y + size * 0.46} L ${x + size * 0.65} ${y + size * 0.7} L ${x + size - 3} ${y + size * 0.4} V ${y + size - 3} Z" fill="${tint}"/>
    </g>`;
  }
  if (type === 'archive') {
    return `<g>
      <rect x="${x + 3}" y="${y}" width="${size - 6}" height="${size}" rx="4" fill="${soft}"/>
      <path d="M ${x + size * 0.5} ${y + 3} V ${y + size - 4}" stroke="${tint}" stroke-width="2" stroke-dasharray="2 3"/>
      <rect x="${x + size * 0.39}" y="${y + size * 0.58}" width="${size * 0.22}" height="${size * 0.18}" rx="2" fill="${tint}"/>
    </g>`;
  }
  return `<g>
    <path d="M ${x + 2} ${y} H ${x + size * 0.62} L ${x + size - 2} ${y + size * 0.36} V ${y + size} H ${x + 2} Z" fill="${soft}"/>
    <path d="M ${x + size * 0.62} ${y} V ${y + size * 0.36} H ${x + size - 2}" fill="none" stroke="${tint}" stroke-width="1.5"/>
    <path d="M ${x + 7} ${y + size * 0.57} H ${x + size - 7} M ${x + 7} ${y + size * 0.72} H ${x + size * 0.72}" stroke="${tint}" stroke-width="1.8" stroke-linecap="round"/>
  </g>`;
}

function documentRows(
  x,
  y,
  width,
  rowHeight,
  opacity = 1,
  selectedIndex = -1,
  showDownload = false,
  count = 4,
) {
  let rows = '';
  const types = ['document', 'image', 'archive', 'document'];
  for (let index = 0; index < count; index += 1) {
    const rowY = y + index * rowHeight;
    const selected = index === selectedIndex;
    rows += `<rect x="${x}" y="${rowY}" width="${width}" height="${rowHeight - 7}" rx="7" fill="${selected ? colors.primarySoft : colors.surface}" stroke="${selected ? colors.primary : colors.border}"/>
      ${fileTypeIcon(x + 11, rowY + 8, 27, types[index], selected)}
      <rect x="${x + 43}" y="${rowY + 11}" width="${width * (0.3 + index * 0.05)}" height="7" rx="3.5" fill="${selected ? colors.ink : colors.muted}"/>
      <rect x="${x + 43}" y="${rowY + 25}" width="${width * 0.2}" height="5" rx="2.5" fill="${colors.border}"/>`;
    if (showDownload && selected) {
      const iconX = x + width - 23;
      const iconY = rowY + 20;
      rows += `<circle cx="${iconX}" cy="${iconY}" r="13" fill="${colors.primary}"/>
        <path d="M ${iconX} ${iconY - 7} V ${iconY + 4} M ${iconX - 5} ${iconY} L ${iconX} ${iconY + 5} L ${iconX + 5} ${iconY} M ${iconX - 6} ${iconY + 8} H ${iconX + 6}" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }
  return `<g opacity="${format(opacity)}">${rows}</g>`;
}

function browserUi(time, opacity) {
  const openProgress = smooth(4.08, 4.34, time);
  const contentsProgress = smooth(4.35, 4.62, time);
  const selectedIndex = openProgress > 0.45 ? 1 : -1;
  return `<g opacity="${format(opacity)}" clip-path="url(#laptop-screen)">
    <rect x="180" y="278" width="58" height="26" rx="7" fill="${colors.primarySoft}"/>
    ${folderIcon(190, 283, 17, colors.primary)}
    <rect x="180" y="313" width="58" height="26" rx="7" fill="${openProgress > 0.45 ? colors.primarySoft : 'transparent'}"/>
    ${folderIcon(190, 318, 17, openProgress > 0.45 ? colors.primary : '#9DB1BF')}
    <rect x="285" y="256" width="146" height="11" rx="5.5" fill="${colors.ink}"/>
    <path d="M 286 289 H 823" stroke="${colors.border}"/>
    ${fileRows(285, 307, 538, 45, selectedIndex)}
  </g>
  <g opacity="${format(opacity)}" clip-path="url(#phone-screen)">
    <path d="M 954 258 L 962 266 L 954 274" fill="none" stroke="${colors.ink}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="976" y="255" width="75" height="9" rx="4.5" fill="${colors.ink}"/>
    <g transform="translate(0 ${format(-5 * contentsProgress)})">
      ${fileRows(951, 294, 140, 54, selectedIndex, 1 - contentsProgress)}
    </g>
    <g transform="translate(0 ${format(7 * (1 - contentsProgress))})">
      ${documentRows(951, 294, 140, 54, contentsProgress, -1, false, 4)}
    </g>
  </g>`;
}

function downloadUi(time, opacity) {
  const selected = smooth(5.48, 5.7, time);
  const transfer = smooth(5.84, 6.56, time);
  const completed = smooth(6.55, 6.78, time);
  const point = bezierPoint(transfer, { x: 520, y: 369 }, { x: 785, y: 268 }, { x: 1020, y: 514 });
  const flyingOpacity = transfer > 0 && transfer < 1 ? Math.sin(Math.PI * transfer) : 0;

  return `<g opacity="${format(opacity)}" clip-path="url(#laptop-screen)">
    <rect x="180" y="313" width="58" height="26" rx="7" fill="${colors.primarySoft}"/>
    ${folderIcon(190, 318, 17, colors.primary)}
    <rect x="285" y="256" width="146" height="11" rx="5.5" fill="${colors.ink}"/>
    <path d="M 286 289 H 823" stroke="${colors.border}"/>
    ${documentRows(285, 307, 538, 45, 1, selected > 0.45 ? 1 : -1, false, 4)}
  </g>
  <g opacity="${format(opacity)}" clip-path="url(#phone-screen)">
    <path d="M 954 258 L 962 266 L 954 274" fill="none" stroke="${colors.ink}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="976" y="255" width="75" height="9" rx="4.5" fill="${colors.ink}"/>
    ${documentRows(951, 294, 140, 54, 1, selected > 0.45 ? 1 : -1, true, 3)}
    <rect x="954" y="468" width="132" height="9" rx="4.5" fill="${colors.surfaceMuted}"/>
    <rect x="954" y="468" width="${format(132 * transfer)}" height="9" rx="4.5" fill="${completed > 0.1 ? colors.success : colors.primary}"/>
    ${folderIcon(1002, 502, 38, completed > 0.1 ? colors.success : '#9DB1BF')}
    ${checkIcon(1061, 522, 15, completed)}
  </g>
  <g opacity="${format(opacity * flyingOpacity)}" transform="translate(${format(point.x)} ${format(point.y)}) scale(${format(0.82 + 0.18 * Math.sin(Math.PI * transfer))}) translate(-20 -20)" filter="url(#card-shadow)">
    <rect x="-4" y="-4" width="48" height="48" rx="9" fill="${colors.surface}"/>
    ${fileTypeIcon(4, 4, 32, 'image', true)}
  </g>`;
}

function connectionLayer(time) {
  const connectionProgress = smooth(1.02, 1.42, time) * (1 - smooth(7.08, 7.48, time));
  const connectionFlash =
    Math.sin(Math.PI * smooth(1.2, 1.55, time)) * (1 - smooth(1.55, 1.75, time));
  const uploadDirection = smooth(1.78, 2.0, time) * (1 - smooth(3.3, 3.58, time));
  const downloadDirection = smooth(5.52, 5.78, time) * (1 - smooth(6.86, 7.12, time));
  let arrows = '';

  [874, 899, 924].forEach((x, index) => {
    const y = index === 1 ? 335 : 344;
    const uploadPulse = 0.48 + 0.52 * Math.sin(time * 8 - index * 0.9) ** 2;
    const downloadPulse = 0.48 + 0.52 * Math.sin(time * 8 + index * 0.9) ** 2;
    arrows += `<path d="M ${x + 6} ${y - 6} L ${x - 2} ${y} L ${x + 6} ${y + 6}" fill="none" stroke="${colors.primary}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="${format(uploadDirection * uploadPulse)}"/>
      <path d="M ${x - 6} ${y - 6} L ${x + 2} ${y} L ${x - 6} ${y + 6}" fill="none" stroke="${colors.cyan}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="${format(downloadDirection * downloadPulse)}"/>`;
  });

  return `<g>
    <path d="M 850 366 C 884 320 904 320 944 354" pathLength="1" fill="none" stroke="${colors.primary}" stroke-width="${format(4 + connectionFlash * 2)}" stroke-linecap="round" stroke-dasharray="1" stroke-dashoffset="${format(1 - connectionProgress)}" opacity="${format(connectionProgress)}"/>
    ${arrows}
  </g>`;
}

function frameSvg(frame) {
  const time = frame / FPS;
  const pairOpacity = clamp(1 - smooth(1.62, 1.92, time) + smooth(7.25, 7.62, time));
  const galleryOpacity = smooth(1.66, 1.92, time) * (1 - smooth(3.42, 3.7, time));
  const browserOpacity = smooth(3.45, 3.72, time) * (1 - smooth(5.27, 5.55, time));
  const downloadOpacity = smooth(5.28, 5.55, time) * (1 - smooth(7.12, 7.45, time));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <filter id="device-shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="9" stdDeviation="11" flood-color="#17354A" flood-opacity="0.14"/>
    </filter>
    <filter id="card-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#17354A" flood-opacity="0.18"/>
    </filter>
    <clipPath id="laptop-screen"><rect x="164" y="199" width="692" height="312" rx="10"/></clipPath>
    <clipPath id="phone-screen"><rect x="941" y="214" width="160" height="347" rx="27"/></clipPath>
  </defs>
  <g id="brand">
    <image href="data:image/png;base64,${logoData}" x="420" y="48" width="86" height="86" preserveAspectRatio="xMidYMid meet"/>
    <text x="520" y="108" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="42" font-weight="720" letter-spacing="0" fill="${colors.primary}">Lynavo Drive</text>
  </g>
  <g id="devices" transform="translate(${WIDTH} 0) scale(-1 1)">
    ${deviceChrome()}
    ${connectionLayer(time)}
    ${laptopBaseUi()}
    ${pairUi(time, pairOpacity)}
    ${galleryUi(time, galleryOpacity)}
    ${browserUi(time, browserOpacity)}
    ${downloadUi(time, downloadOpacity)}
  </g>
</svg>`;
}

async function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForChrome(port) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return;
    } catch {
      // Chrome has not opened its debugging port yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error('Chrome did not start its debugging endpoint.');
}

async function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const eventWaiters = new Map();
  let nextId = 1;

  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolveCommand, rejectCommand } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) rejectCommand(new Error(message.error.message));
      else resolveCommand(message.result);
      return;
    }

    const waiters = eventWaiters.get(message.method);
    if (waiters?.length) waiters.shift()(message.params);
  });

  return {
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolveCommand, rejectCommand) => {
        pending.set(id, { resolveCommand, rejectCommand });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    waitForEvent(method) {
      return new Promise((resolveEvent) => {
        const waiters = eventWaiters.get(method) ?? [];
        waiters.push(resolveEvent);
        eventWaiters.set(method, waiters);
      });
    },
    close() {
      socket.close();
    },
  };
}

async function rasterizeFrames(framesDirectory) {
  const chromePath =
    process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const profileDirectory = mkdtempSync(join(tmpdir(), 'lynavo-drive-chrome-'));
  const port = await getFreePort();
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-gpu',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--no-default-browser-check',
      '--no-first-run',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDirectory}`,
    ],
    { stdio: 'ignore' },
  );

  try {
    await waitForChrome(port);
    const pageResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: 'PUT',
    });
    const page = await pageResponse.json();
    const client = await createCdpClient(page.webSocketDebuggerUrl);

    try {
      await client.send('Page.enable');
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: WIDTH,
        height: HEIGHT,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await client.send('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 0, g: 0, b: 0, a: 0 },
      });

      for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
        const stem = `frame-${String(frame).padStart(3, '0')}`;
        const loaded = client.waitForEvent('Page.loadEventFired');
        await client.send('Page.navigate', {
          url: `file://${join(framesDirectory, `${stem}.svg`)}`,
        });
        await loaded;
        const screenshot = await client.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
        });
        writeFileSync(join(framesDirectory, `${stem}.png`), Buffer.from(screenshot.data, 'base64'));
      }
    } finally {
      client.close();
    }
  } finally {
    if (chrome.exitCode === null) {
      const exited = new Promise((resolveExit) => chrome.once('exit', resolveExit));
      chrome.kill('SIGTERM');
      await exited;
    }
    rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function run() {
  mkdirSync(outputDirectory, { recursive: true });
  const framesDirectory = mkdtempSync(join(tmpdir(), 'lynavo-drive-banner-'));

  try {
    for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
      const filename = `frame-${String(frame).padStart(3, '0')}.svg`;
      writeFileSync(join(framesDirectory, filename), frameSvg(frame));
    }

    await rasterizeFrames(framesDirectory);
    const inputPattern = join(framesDirectory, 'frame-%03d.png');
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-framerate',
        String(FPS),
        '-start_number',
        '0',
        '-i',
        inputPattern,
        '-frames:v',
        String(FRAME_COUNT),
        '-c:v',
        'apng',
        '-plays',
        '0',
        '-compression_level',
        '9',
        '-f',
        'apng',
        join(outputDirectory, 'banner.png'),
      ],
      { stdio: 'inherit' },
    );

    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-framerate',
        String(FPS),
        '-start_number',
        '0',
        '-i',
        inputPattern,
        '-frames:v',
        String(FRAME_COUNT),
        '-filter_complex',
        '[0:v]split[a][b];[a]palettegen=max_colors=160:reserve_transparent=1:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle:alpha_threshold=64',
        '-loop',
        '0',
        join(outputDirectory, 'banner.gif'),
      ],
      { stdio: 'inherit' },
    );

    chmodSync(join(outputDirectory, 'banner.png'), 0o644);
    chmodSync(join(outputDirectory, 'banner.gif'), 0o644);

    console.log(`Rendered ${FRAME_COUNT} frames at ${FPS} fps to ${outputDirectory}`);
  } finally {
    rmSync(framesDirectory, { recursive: true, force: true });
  }
}

await run();
