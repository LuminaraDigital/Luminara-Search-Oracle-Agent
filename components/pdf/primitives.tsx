import React from 'react';
import {
  Document,
  Page,
  View,
  Text,
  H1,
  H2,
  H3,
  H4,
  Table,
  Row,
  Cell,
  Fixed,
  Link,
  Image,
  Strong,
  Em,
  Code,
  StyleSheet,
} from '@formepdf/react';
import type { Style, ViewProps, TextProps } from '@formepdf/react';
import type { ExecutivePdfTheme } from './theme';

export {
  Document,
  Page,
  View,
  Text,
  H1,
  H2,
  H3,
  H4,
  Table,
  Row,
  Cell,
  Fixed,
  Link,
  Image,
  Strong,
  Em,
  Code,
  StyleSheet,
};

export type { Style, ViewProps, TextProps };

/**
 * Section component with consistent padding and theme spacing.
 */
export const Section: React.FC<{
  children?: React.ReactNode;
  style?: Style;
  theme?: ExecutivePdfTheme;
}> = ({ children, style, theme }) => {
  const defaultStyle: Style = {
    marginBottom: theme?.spacing.sectionGap ?? 18,
  };
  return <View style={{ ...defaultStyle, ...style }}>{children}</View>;
};

/**
 * Status/Category Badge component inspired by pdfcn badge.
 */
export const Badge: React.FC<{
  label: string;
  tone?: 'primary' | 'success' | 'warning' | 'destructive' | 'info' | 'muted';
  theme: ExecutivePdfTheme;
  style?: Style;
}> = ({ label, tone = 'primary', theme, style }) => {
  const toneBgMap: Record<string, string> = {
    primary: theme.colors.primary,
    success: '#dcfce7',
    warning: '#fef3c7',
    destructive: '#fee2e2',
    info: '#e0f2fe',
    muted: '#f1f5f9',
  };

  const toneTextMap: Record<string, string> = {
    primary: theme.colors.primaryForeground,
    success: '#15803d',
    warning: '#b45309',
    destructive: '#b91c1c',
    info: '#0369a1',
    muted: '#475569',
  };

  return (
    <View
      style={{
        backgroundColor: toneBgMap[tone] || '#f1f5f9',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        alignSelf: 'flex-start',
        ...style,
      }}
    >
      <Text
        style={{
          fontSize: theme.typography.sizes.xs,
          color: toneTextMap[tone] || '#475569',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {label}
      </Text>
    </View>
  );
};

/**
 * Clean Divider line.
 */
export const Divider: React.FC<{
  color?: string;
  thickness?: number;
  marginVertical?: number;
  style?: Style;
}> = ({ color = '#e2e8f0', thickness = 1, marginVertical = 12, style }) => {
  return (
    <View
      style={{
        borderBottomWidth: thickness,
        borderBottomColor: color,
        marginVertical,
        width: '100%',
        ...style,
      }}
    />
  );
};
