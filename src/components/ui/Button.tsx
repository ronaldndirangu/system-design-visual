import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { UiIcon } from '../viz/icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type IconName = Parameters<typeof UiIcon>[0]['name'];

export function buttonClass(variant: ButtonVariant = 'secondary', className?: string) {
  return ['sdv-button', variant === 'secondary' ? '' : `sdv-button--${variant}`, className]
    .filter(Boolean)
    .join(' ');
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
  children: ReactNode;
}

/** Native button in one of four variants. Secondary is the default. */
export function Button({ variant, icon, className, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, className)} {...rest}>
      {icon && <UiIcon name={icon} />}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  /** Accessible name, also shown as the pointer tooltip. */
  label: string;
  icon: IconName;
  variant?: ButtonVariant;
}

/** Square icon-only button. */
export function IconButton({ label, icon, variant, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, ['sdv-button--icon', className].filter(Boolean).join(' '))}
      aria-label={label}
      title={label}
      {...rest}
    >
      <UiIcon name={icon} />
    </button>
  );
}
