import React from 'react';
import { marked, type Token, type Tokens } from 'marked';
import {
  View,
  Text,
  Table,
  Row,
  Cell,
  Divider,
  type Style,
} from './primitives';
import type { ExecutivePdfTheme } from './theme';

interface MarkdownRendererProps {
  content: string;
  theme: ExecutivePdfTheme;
}

/**
 * Render inline tokens (bold, italics, code, links, plain text) to Forme PDF text nodes.
 */
function renderInlineTokens(tokens: Token[] | undefined, theme: ExecutivePdfTheme): React.ReactNode {
  if (!tokens || tokens.length === 0) return null;

  return tokens.map((t, idx) => {
    switch (t.type) {
      case 'strong': {
        const strongTok = t as Tokens.Strong;
        return (
          <Text key={idx} style={{ fontWeight: 700, color: theme.colors.foreground }}>
            {strongTok.tokens ? renderInlineTokens(strongTok.tokens, theme) : strongTok.text}
          </Text>
        );
      }
      case 'em': {
        const emTok = t as Tokens.Em;
        return (
          <Text key={idx} style={{ fontStyle: 'italic', color: theme.colors.foreground }}>
            {emTok.tokens ? renderInlineTokens(emTok.tokens, theme) : emTok.text}
          </Text>
        );
      }
      case 'codespan': {
        const codeTok = t as Tokens.Codespan;
        return (
          <Text
            key={idx}
            style={{
              fontFamily: theme.typography.codeFontFamily,
              fontSize: theme.typography.sizes.sm,
              backgroundColor: '#f1f5f9',
              color: '#0f172a',
            }}
          >
            {` ${codeTok.text} `}
          </Text>
        );
      }
      case 'link': {
        const linkTok = t as Tokens.Link;
        return (
          <Text
            key={idx}
            href={linkTok.href}
            style={{
              color: theme.colors.primary,
              textDecoration: 'underline',
            }}
          >
            {linkTok.tokens ? renderInlineTokens(linkTok.tokens, theme) : linkTok.text}
          </Text>
        );
      }
      case 'text':
      default: {
        const textTok = t as Tokens.Text;
        if (textTok.tokens && textTok.tokens.length > 0) {
          return <React.Fragment key={idx}>{renderInlineTokens(textTok.tokens, theme)}</React.Fragment>;
        }
        return <React.Fragment key={idx}>{textTok.text}</React.Fragment>;
      }
    }
  });
}

/**
 * Renders structured markdown content into native Forme PDF elements with professional agency styling.
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, theme }) => {
  if (!content || !content.trim()) return null;

  const tokens = marked.lexer(content);

  return (
    <View style={{ display: 'flex', flexDirection: 'column' }}>
      {tokens.map((token, index) => {
        switch (token.type) {
          case 'heading': {
            const h = token as Tokens.Heading;
            const headingSizes: Record<number, number> = {
              1: theme.typography.sizes.xl,
              2: theme.typography.sizes.lg,
              3: theme.typography.sizes.md,
              4: theme.typography.sizes.base,
              5: theme.typography.sizes.sm,
              6: theme.typography.sizes.xs,
            };

            const fontSize = headingSizes[h.depth] || theme.typography.sizes.md;
            const isTopLevel = h.depth <= 2;

            return (
              <View
                key={index}
                wrap={false}
                style={{
                  marginTop: isTopLevel ? 14 : 10,
                  marginBottom: 6,
                  borderBottomWidth: isTopLevel ? 1 : 0,
                  borderBottomColor: theme.colors.border,
                  paddingBottom: isTopLevel ? 4 : 0,
                }}
              >
                <Text
                  style={{
                    fontSize,
                    fontWeight: 700,
                    color: isTopLevel ? theme.colors.foreground : theme.colors.primary,
                    letterSpacing: -0.2,
                  }}
                >
                  {h.tokens ? renderInlineTokens(h.tokens, theme) : h.text}
                </Text>
              </View>
            );
          }

          case 'paragraph': {
            const p = token as Tokens.Paragraph;
            return (
              <View key={index} style={{ marginBottom: 7 }}>
                <Text
                  style={{
                    fontSize: theme.typography.sizes.base,
                    lineHeight: 1.5,
                    color: theme.colors.foreground,
                  }}
                >
                  {p.tokens ? renderInlineTokens(p.tokens, theme) : p.text}
                </Text>
              </View>
            );
          }

          case 'list': {
            const list = token as Tokens.List;
            return (
              <View key={index} style={{ marginBottom: 10, paddingLeft: 4 }}>
                {list.items.map((item, itemIdx) => (
                  <View
                    key={itemIdx}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      marginBottom: 4,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: theme.typography.sizes.base,
                        color: theme.colors.primary,
                        fontWeight: 700,
                        width: 14,
                        marginRight: 4,
                      }}
                    >
                      {list.ordered ? `${Number(list.start || 1) + itemIdx}.` : '•'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: theme.typography.sizes.base,
                          lineHeight: 1.45,
                          color: theme.colors.foreground,
                        }}
                      >
                        {item.tokens ? renderInlineTokens(item.tokens, theme) : item.text}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            );
          }

          case 'table': {
            const table = token as Tokens.Table;
            return (
              <View
                key={index}
                wrap={false}
                style={{
                  marginVertical: 10,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: 4,
                }}
              >
                <Table>
                  {/* Table Header */}
                  <Row
                    header
                    style={{
                      backgroundColor: '#f8fafc',
                      borderBottomWidth: 1,
                      borderBottomColor: theme.colors.border,
                    }}
                  >
                    {table.header.map((cell, cIdx) => (
                      <Cell
                        key={cIdx}
                        style={{
                          padding: 6,
                          borderRightWidth: cIdx < table.header.length - 1 ? 1 : 0,
                          borderRightColor: theme.colors.border,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: theme.typography.sizes.sm,
                            fontWeight: 700,
                            color: theme.colors.foreground,
                          }}
                        >
                          {cell.tokens ? renderInlineTokens(cell.tokens, theme) : cell.text}
                        </Text>
                      </Cell>
                    ))}
                  </Row>

                  {/* Table Body */}
                  {table.rows.map((row, rIdx) => (
                    <Row
                      key={rIdx}
                      style={{
                        backgroundColor: rIdx % 2 === 1 ? '#fafafa' : '#ffffff',
                        borderBottomWidth: rIdx < table.rows.length - 1 ? 1 : 0,
                        borderBottomColor: theme.colors.border,
                      }}
                    >
                      {row.map((cell, cIdx) => (
                        <Cell
                          key={cIdx}
                          style={{
                            padding: 6,
                            borderRightWidth: cIdx < row.length - 1 ? 1 : 0,
                            borderRightColor: theme.colors.border,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: theme.typography.sizes.sm,
                              color: theme.colors.foreground,
                            }}
                          >
                            {cell.tokens ? renderInlineTokens(cell.tokens, theme) : cell.text}
                          </Text>
                        </Cell>
                      ))}
                    </Row>
                  ))}
                </Table>
              </View>
            );
          }

          case 'blockquote': {
            const bq = token as Tokens.Blockquote;
            return (
              <View
                key={index}
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: theme.colors.primary,
                  backgroundColor: '#f8fafc',
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  marginVertical: 8,
                  borderRadius: 2,
                }}
              >
                <Text
                  style={{
                    fontSize: theme.typography.sizes.base,
                    fontStyle: 'italic',
                    color: theme.colors.foreground,
                    lineHeight: 1.45,
                  }}
                >
                  {bq.tokens ? renderInlineTokens(bq.tokens, theme) : bq.text}
                </Text>
              </View>
            );
          }

          case 'code': {
            const code = token as Tokens.Code;
            return (
              <View
                key={index}
                wrap={false}
                style={{
                  backgroundColor: '#0f172a',
                  padding: 10,
                  borderRadius: 4,
                  marginVertical: 8,
                }}
              >
                <Text
                  style={{
                    fontFamily: theme.typography.codeFontFamily,
                    fontSize: theme.typography.sizes.xs,
                    color: '#10b981',
                    lineHeight: 1.4,
                  }}
                >
                  {code.text}
                </Text>
              </View>
            );
          }

          case 'hr': {
            return (
              <Divider
                key={index}
                color={theme.colors.border}
                thickness={1}
                marginVertical={10}
              />
            );
          }

          default:
            return null;
        }
      })}
    </View>
  );
};
