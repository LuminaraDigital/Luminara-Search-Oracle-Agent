/**
 * Executive Report Theme Configuration
 * Inspired by shadcn-labs/pdfcn executive & corporate themes,
 * customized for Luminara white-label agency deliverables.
 */

export interface ExecutivePdfTheme {
  colors: {
    primary: string;
    primaryForeground: string;
    accent: string;
    background: string;
    foreground: string;
    muted: string;
    mutedForeground: string;
    border: string;
    card: string;
    cardBorder: string;
    success: string;
    warning: string;
    destructive: string;
    info: string;
  };
  typography: {
    fontFamily: string;
    codeFontFamily: string;
    sizes: {
      xs: number;
      sm: number;
      base: number;
      md: number;
      lg: number;
      xl: number;
      xxl: number;
      title: number;
    };
  };
  spacing: {
    pageMargin: {
      top: number;
      bottom: number;
      left: number;
      right: number;
    };
    sectionGap: number;
    itemGap: number;
  };
}

export function createExecutiveTheme(customPrimaryColor = '#BF953F'): ExecutivePdfTheme {
  return {
    colors: {
      primary: customPrimaryColor || '#BF953F',
      primaryForeground: '#ffffff',
      accent: '#D4AF37',
      background: '#ffffff',
      foreground: '#0f172a',
      muted: '#f8fafc',
      mutedForeground: '#64748b',
      border: '#e2e8f0',
      card: '#fcfcfd',
      cardBorder: '#e2e8f0',
      success: '#10b981',
      warning: '#f59e0b',
      destructive: '#ef4444',
      info: '#0284c7',
    },
    typography: {
      fontFamily: 'Helvetica, Arial, sans-serif',
      codeFontFamily: 'Courier, monospace',
      sizes: {
        xs: 8,
        sm: 9,
        base: 10,
        md: 11,
        lg: 13,
        xl: 16,
        xxl: 20,
        title: 24,
      },
    },
    spacing: {
      pageMargin: {
        top: 48,
        bottom: 54,
        left: 48,
        right: 48,
      },
      sectionGap: 20,
      itemGap: 10,
    },
  };
}
