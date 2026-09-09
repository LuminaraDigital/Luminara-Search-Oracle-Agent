import { ThemeId, LuminaraTheme } from '../../types';

export const THEMES: Record<ThemeId, LuminaraTheme> = {
  'liquid-gold': {
    id: 'liquid-gold',
    name: 'Liquid Gold',
    tagline: 'Obsidian luxury with liquid gold specular highlights',
    previewColors: ['#0A0A0B', '#BF953F', '#FCF6BA', '#AA771C'],
    palette: {
      primaryGold: '#BF953F',
      goldLight: '#FCF6BA',
      goldDark: '#AA771C',
      goldGradient: 'linear-gradient(135deg, #BF953F 0%, #FCF6BA 50%, #B38728 100%)',
      bgDark: '#050505',
      bgObsidian: '#0A0A0B',
      bgSurface: 'rgba(255, 255, 255, 0.03)',
      borderGold: 'rgba(191, 149, 63, 0.35)',
      borderMuted: 'rgba(255, 255, 255, 0.08)',
      textPrimary: '#FCF6BA',
      textSecondary: '#9CA3AF',
      accentGlow: 'rgba(191, 149, 63, 0.25)',
      badgeBg: 'rgba(191, 149, 63, 0.15)',
    }
  },
  'vantablack': {
    id: 'vantablack',
    name: 'Vantablack Monolith',
    tagline: 'Absolute zero absorption with brushed titanium accents',
    previewColors: ['#000000', '#E5E7EB', '#FFFFFF', '#4B5563'],
    palette: {
      primaryGold: '#E5E7EB',
      goldLight: '#FFFFFF',
      goldDark: '#9CA3AF',
      goldGradient: 'linear-gradient(135deg, #9CA3AF 0%, #FFFFFF 50%, #6B7280 100%)',
      bgDark: '#000000',
      bgObsidian: '#050505',
      bgSurface: 'rgba(255, 255, 255, 0.04)',
      borderGold: 'rgba(255, 255, 255, 0.25)',
      borderMuted: 'rgba(255, 255, 255, 0.10)',
      textPrimary: '#FFFFFF',
      textSecondary: '#9CA3AF',
      accentGlow: 'rgba(255, 255, 255, 0.15)',
      badgeBg: 'rgba(255, 255, 255, 0.12)',
    }
  },
  'tokyo-night': {
    id: 'tokyo-night',
    name: 'Tokyo Cyberpunk',
    tagline: 'Deep neon indigo inspired by midnight Shinjuku',
    previewColors: ['#1A1B26', '#7AA2F7', '#BB9AF7', '#2AC3DE'],
    palette: {
      primaryGold: '#7AA2F7',
      goldLight: '#BB9AF7',
      goldDark: '#3D59A1',
      goldGradient: 'linear-gradient(135deg, #7AA2F7 0%, #BB9AF7 50%, #2AC3DE 100%)',
      bgDark: '#0F1017',
      bgObsidian: '#16161E',
      bgSurface: 'rgba(122, 162, 247, 0.05)',
      borderGold: 'rgba(122, 162, 247, 0.40)',
      borderMuted: 'rgba(122, 162, 247, 0.12)',
      textPrimary: '#C0CAF5',
      textSecondary: '#787C99',
      accentGlow: 'rgba(122, 162, 247, 0.30)',
      badgeBg: 'rgba(122, 162, 247, 0.18)',
    }
  },
  'rose-pine': {
    id: 'rose-pine',
    name: 'Rose Pine Sanctuary',
    tagline: 'Nordic velvet pine with warm rose and muted gold',
    previewColors: ['#191724', '#EB6F92', '#F6C177', '#31748F'],
    palette: {
      primaryGold: '#EB6F92',
      goldLight: '#F6C177',
      goldDark: '#B4637A',
      goldGradient: 'linear-gradient(135deg, #EB6F92 0%, #F6C177 50%, #EA9A97 100%)',
      bgDark: '#12101B',
      bgObsidian: '#191724',
      bgSurface: 'rgba(235, 111, 146, 0.05)',
      borderGold: 'rgba(235, 111, 146, 0.35)',
      borderMuted: 'rgba(235, 111, 146, 0.12)',
      textPrimary: '#E0DEF4',
      textSecondary: '#908CAA',
      accentGlow: 'rgba(235, 111, 146, 0.25)',
      badgeBg: 'rgba(235, 111, 146, 0.15)',
    }
  },
  'cyber-emerald': {
    id: 'cyber-emerald',
    name: 'Cyber Emerald',
    tagline: 'High-contrast monochrome matrix terminal obsidian',
    previewColors: ['#060D0A', '#10B981', '#34D399', '#059669'],
    palette: {
      primaryGold: '#10B981',
      goldLight: '#34D399',
      goldDark: '#047857',
      goldGradient: 'linear-gradient(135deg, #10B981 0%, #6EE7B7 50%, #059669 100%)',
      bgDark: '#030805',
      bgObsidian: '#08120D',
      bgSurface: 'rgba(16, 185, 129, 0.04)',
      borderGold: 'rgba(16, 185, 129, 0.38)',
      borderMuted: 'rgba(16, 185, 129, 0.12)',
      textPrimary: '#A7F3D0',
      textSecondary: '#6EE7B7',
      accentGlow: 'rgba(16, 185, 129, 0.25)',
      badgeBg: 'rgba(16, 185, 129, 0.15)',
    }
  }
};

const THEME_STORAGE_KEY = 'luminara_active_theme';
const ADVANCED_UI_KEY = 'luminara_advanced_ui';

function advancedUiEnabled(): boolean {
  try {
    return localStorage.getItem(ADVANCED_UI_KEY) === '1';
  } catch {
    return false;
  }
}

class ThemingService {
  private currentThemeId: ThemeId = 'liquid-gold';
  private listeners: Array<(theme: LuminaraTheme) => void> = [];

  constructor() {
    try {
      // Level 4 product path: Liquid Gold only unless developer tools are on.
      if (!advancedUiEnabled()) {
        this.currentThemeId = 'liquid-gold';
      } else {
        const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId;
        if (saved && THEMES[saved]) {
          this.currentThemeId = saved;
        }
      }
    } catch {
      this.currentThemeId = 'liquid-gold';
    }
  }

  public getTheme(): LuminaraTheme {
    return THEMES[this.ensureProductTheme()];
  }

  public getThemeId(): ThemeId {
    return this.ensureProductTheme();
  }

  public listThemes(): LuminaraTheme[] {
    if (!advancedUiEnabled()) return [THEMES['liquid-gold']];
    return Object.values(THEMES);
  }

  public setTheme(id: ThemeId): LuminaraTheme {
    const resolved = !advancedUiEnabled() ? 'liquid-gold' : id;
    if (!THEMES[resolved]) return this.getTheme();
    this.currentThemeId = resolved;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, resolved);
    } catch {
      // storage disabled
    }
    this.applyCssVariables(THEMES[resolved]);
    this.notifyListeners(THEMES[resolved]);
    return THEMES[resolved];
  }

  public cycleTheme(): LuminaraTheme {
    if (!advancedUiEnabled()) return this.setTheme('liquid-gold');
    const themeIds: ThemeId[] = ['liquid-gold', 'vantablack', 'tokyo-night', 'rose-pine', 'cyber-emerald'];
    const currentIndex = themeIds.indexOf(this.currentThemeId);
    const nextIndex = (currentIndex + 1) % themeIds.length;
    return this.setTheme(themeIds[nextIndex]);
  }

  /** Force Liquid Gold whenever advanced UI is off (product craft lock). */
  public ensureProductTheme(): ThemeId {
    if (!advancedUiEnabled() && this.currentThemeId !== 'liquid-gold') {
      this.setTheme('liquid-gold');
    }
    return this.currentThemeId;
  }

  public applyCssVariables(theme: LuminaraTheme): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const { palette } = theme;

    root.style.setProperty('--color-gold-primary', palette.primaryGold);
    root.style.setProperty('--color-gold-light', palette.goldLight);
    root.style.setProperty('--color-gold-dark', palette.goldDark);
    root.style.setProperty('--color-bg-dark', palette.bgDark);
    root.style.setProperty('--color-bg-obsidian', palette.bgObsidian);
    root.style.setProperty('--color-border-gold', palette.borderGold);
    root.style.setProperty('--color-text-primary', palette.textPrimary);
    root.style.setProperty('--color-accent-glow', palette.accentGlow);
    root.setAttribute('data-luminara-theme', theme.id);
  }

  public subscribe(fn: (theme: LuminaraTheme) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  private notifyListeners(theme: LuminaraTheme): void {
    this.listeners.forEach(fn => fn(theme));
  }
}

export const themingService = new ThemingService();
