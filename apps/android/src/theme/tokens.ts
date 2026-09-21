export type ThemeId = 'bg1' | 'bg2' | 'bg3' | 'bg4' | 'bg5' | 'bg6';

export type ThemeTokens = {
  id: ThemeId;
  name: string;
  family: string;
  colors: {
    accent: string;
    secondary: string;
    canvas: string;
    surface: string;
    ink: string;
    muted: string;
    border: string;
    danger: string;
  };
};

export const THEMES: Record<ThemeId, ThemeTokens> = {
  bg1: { id: 'bg1', name: '星糖梦境', family: 'star-dream', colors: { accent: '#FFD85C', secondary: '#7663CF', canvas: '#FFF7D4', surface: '#FFFFFF', ink: '#2B2240', muted: '#766E85', border: '#EADFAE', danger: '#D76666' } },
  bg2: { id: 'bg2', name: '晴空蜜桃', family: 'sky-peach', colors: { accent: '#78DCEC', secondary: '#F39BAC', canvas: '#F2FBFF', surface: '#FFFFFF', ink: '#244661', muted: '#6E8797', border: '#C9EAF1', danger: '#D76576' } },
  bg3: { id: 'bg3', name: '莓果心动', family: 'berry-love', colors: { accent: '#FF6462', secondary: '#E98BAA', canvas: '#FFF2DF', surface: '#FFFFFF', ink: '#4A293B', muted: '#896B78', border: '#F1CFBF', danger: '#C94D50' } },
  bg4: { id: 'bg4', name: '奶杏布丁', family: 'matcha-roast', colors: { accent: '#FFD569', secondary: '#D48C70', canvas: '#FFF7E9', surface: '#FFFFFF', ink: '#523442', muted: '#8C7475', border: '#F2D6B5', danger: '#C65E64' } },
  bg5: { id: 'bg5', name: '青柠糖球', family: 'soda-coast', colors: { accent: '#B8E878', secondary: '#78C5B0', canvas: '#F1FFF6', surface: '#FFFFFF', ink: '#28544D', muted: '#6E8982', border: '#CDE9D4', danger: '#C65D63' } },
  bg6: { id: 'bg6', name: '蜜桃心语', family: 'neon-sakura', colors: { accent: '#FF9A86', secondary: '#E98BAA', canvas: '#FFF3EF', surface: '#FFFFFF', ink: '#513346', muted: '#8D707A', border: '#F2D0C6', danger: '#C9575B' } }
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

export function getTheme(id?: string): ThemeTokens {
  return THEMES[(id as ThemeId) || 'bg1'] ?? THEMES.bg1;
}
