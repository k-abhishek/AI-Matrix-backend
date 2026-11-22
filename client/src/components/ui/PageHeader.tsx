import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '../../utils/cn';
import ShinyText from './ShinyText';

export interface PageHeaderProps {
  /** Optional icon displayed in the eyebrow row */
  icon?: LucideIcon | React.ComponentType<{ className?: string }> | React.ReactNode;
  /** Eyebrow label, e.g. "Documentation & Knowledge Base" */
  eyebrow?: string | React.ReactNode;
  /** Page title string or custom ReactNode */
  title: string | React.ReactNode;
  /** Subtitle / descriptive summary */
  description?: string | React.ReactNode;
  /** Optional action buttons / controls to display on the right */
  actions?: React.ReactNode;
  /** Whether to apply ShinyText effect to title if title is a string (defaults to true) */
  shiny?: boolean;
  /** Optional container className overrides */
  className?: string;
  /** Whether to include a bottom border divider (defaults to false) */
  borderBottom?: boolean;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  icon: IconComponent,
  eyebrow,
  title,
  description,
  actions,
  shiny = true,
  className,
  borderBottom = false,
}) => {
  const renderIcon = () => {
    if (!IconComponent) return null;
    if (React.isValidElement(IconComponent)) return IconComponent;
    const Component = IconComponent as React.ComponentType<{ className?: string }>;
    return <Component className="h-4 w-4 shrink-0" />;
  };

  const renderTitle = () => {
    if (typeof title === 'string' && shiny) {
      return <ShinyText text={title} />;
    }
    return title;
  };

  return (
    <div
      className={cn(
        'flex flex-col md:flex-row md:items-center justify-between gap-4',
        borderBottom && 'border-b border-border/40 pb-5',
        className
      )}
    >
      <div className="flex flex-col gap-2">
        {(eyebrow || IconComponent) && (
          <div className="flex items-center gap-2 text-primary font-medium text-xs">
            {renderIcon()}
            {eyebrow && <span>{eyebrow}</span>}
          </div>
        )}

        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          {renderTitle()}
        </h1>

        {description && (
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
