import React, { forwardRef } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning' | 'info';
/** `xs` is a compact pill, `icon` is square padding for icon-only buttons, `none` applies no sizing so the caller supplies its own. */
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'none';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and disables the button. */
  loading?: boolean;
}

const BASE =
  'inline-flex items-center justify-center gap-1.5 font-bold uppercase tracking-wider select-none transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-gold to-gold-dark text-black shadow-lg hover:from-gold-light hover:to-gold focus-visible:ring-gold active:scale-[0.98] active:from-gold-dark active:to-gold-dark disabled:hover:from-gold disabled:hover:to-gold-dark disabled:active:scale-100',
  secondary:
    'border border-gold/40 text-gold-light bg-transparent hover:bg-gold/10 hover:border-gold focus-visible:ring-gold active:scale-[0.98] active:bg-gold/20 disabled:hover:bg-transparent disabled:hover:border-gold/40 disabled:active:scale-100',
  ghost:
    'text-gray-300 bg-transparent hover:text-white hover:bg-white/5 focus-visible:ring-gold active:scale-[0.98] active:bg-white/10 disabled:hover:text-gray-400 disabled:hover:bg-transparent disabled:active:scale-100',
  danger:
    'bg-danger-600 text-white shadow-lg hover:bg-danger-500 focus-visible:ring-danger-400 active:scale-[0.98] active:bg-danger-700 disabled:hover:bg-danger-600 disabled:active:scale-100',
  success:
    'bg-success-600 text-white shadow-lg hover:bg-success-500 focus-visible:ring-success-400 active:scale-[0.98] active:bg-success-700 disabled:hover:bg-success-600 disabled:active:scale-100',
  warning:
    'bg-warning-600 text-black shadow-lg hover:bg-warning-500 focus-visible:ring-warning-400 active:scale-[0.98] active:bg-warning-700 disabled:hover:bg-warning-600 disabled:active:scale-100',
  info:
    'bg-info-600 text-white shadow-lg hover:bg-info-500 focus-visible:ring-info-400 active:scale-[0.98] active:bg-info-700 disabled:hover:bg-info-600 disabled:active:scale-100',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'px-2 py-0.5 text-[9px] rounded',
  sm: 'px-3 py-1.5 text-[10px] rounded-xl',
  md: 'px-4 py-2 text-xs rounded-xl',
  lg: 'px-6 py-3 text-sm rounded-xl',
  icon: 'p-1 rounded-lg',
  none: '',
};

export const Spinner: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <span
    aria-hidden="true"
    className={`inline-block rounded-full border-2 border-current border-t-transparent animate-spin ${className}`}
  />
);

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className = '', children, type = 'button', ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export default Button;
