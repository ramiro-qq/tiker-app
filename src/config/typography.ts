export type FontSizeMode = 'small' | 'medium' | 'large';

export const fontSizeOptions: { value: FontSizeMode; label: string }[] = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
];

export function applyFontSize(mode: FontSizeMode) {
  document.documentElement.dataset.fontSize = mode;
}
