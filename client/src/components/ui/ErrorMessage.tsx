import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from './alert';
import { Button } from './button';

export interface ErrorMessageProps {
  message: string;
  title?: string;
  className?: string;
  onRetry?: () => void;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  message,
  title = 'Error',
  className,
  onRetry,
}) => {
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="h-4 w-4" />
      <div className="flex flex-col gap-1 w-full">
        {title && <AlertTitle className="font-semibold">{title}</AlertTitle>}
        <AlertDescription className="text-xs leading-relaxed">{message}</AlertDescription>
        {onRetry && (
          <div className="mt-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="h-7 px-2.5 text-xs gap-1.5 border-destructive/30 hover:bg-destructive/10 text-destructive"
            >
              <RefreshCw className="h-3 w-3" />
              Try Again
            </Button>
          </div>
        )}
      </div>
    </Alert>
  );
};

export default ErrorMessage;
