import React, { useState, useRef, useEffect } from 'react';
import {
  Activity,
  RefreshCw,
  Wrench,
  Trash2,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import SpotlightCard from './SpotlightCard';
import ConnectorIcon from './ConnectorIcon';
import StatusBadge from '../ui/StatusBadge';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import type { ConnectorConnection } from '../../types';
import { formatDate } from '../../utils/helpers';
import { cn } from '../../utils/cn';

interface ConnectionCardProps {
  connection: ConnectorConnection;
  onTest: (id: string) => Promise<any>;
  onDiscover: (id: string) => Promise<any>;
  onInspectTools: (connection: ConnectorConnection) => void;
  onDelete: (id: string) => Promise<any>;
}

export const ConnectionCard: React.FC<ConnectionCardProps> = ({
  connection,
  onTest,
  onDiscover,
  onInspectTools,
  onDelete,
}) => {
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [testResult, setTestResult] = useState<{ isHealthy: boolean; message?: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMenuOpen]);

  const handleTest = async () => {
    try {
      setIsTesting(true);
      setTestResult(null);
      const res = await onTest(connection.id);
      setTestResult({
        isHealthy: res.isHealthy,
        message: res.message || (res.isHealthy ? 'Connected & Healthy' : 'Health check failed'),
      });
    } catch (err: any) {
      setTestResult({
        isHealthy: false,
        message: err.message || 'Connection test failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDiscover = async () => {
    try {
      setIsSyncing(true);
      await onDiscover(connection.id);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleConfirmDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      setIsDeleting(true);
      await onDelete(connection.id);
      setIsMenuOpen(false);
    } catch (err) {
      console.error('Failed to disconnect:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const toolsCount = connection._count?.tools ?? connection.tools?.length ?? 0;
  const def = connection.connectorDefinition;

  return (
    <SpotlightCard className="flex flex-col justify-between h-full bg-card/80 backdrop-blur-sm transition-all hover:translate-y-[-2px]">
      <div>
        {/* Header row: Icon + Names + Status Badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <ConnectorIcon
              connectorKey={def?.key}
              name={def?.name || connection.name}
              iconUrl={def?.iconUrl}
            />
            <div className="min-w-0">
              <h3 className="font-semibold text-sm text-foreground truncate leading-tight">
                {connection.name}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground truncate">
                {def?.name || 'Custom Connection'}
              </p>
            </div>
          </div>

          <StatusBadge
            status={connection.status}
            variant={
              connection.status === 'CONNECTED'
                ? 'success'
                : connection.status === 'ERROR'
                ? 'error'
                : connection.status === 'INITIALIZING'
                ? 'warning'
                : 'info'
            }
          />
        </div>

        {/* Base URL / Endpoint info if applicable */}
        {connection.baseUrl && (
          <div className="mt-3.5 rounded-lg bg-muted/40 border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground font-mono truncate">
            {connection.baseUrl}
          </div>
        )}

        {/* Error message banner if status === 'ERROR' */}
        {connection.lastErrorMessage && connection.status === 'ERROR' && (
          <Alert variant="destructive" className="mt-3 p-2 text-xs">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="line-clamp-2 leading-relaxed text-xs">
              {connection.lastErrorMessage}
            </AlertDescription>
          </Alert>
        )}

        {/* Test Result Feedback */}
        {testResult && (
          <div
            className={cn(
              'mt-3 flex items-center gap-2 rounded-lg border p-2 text-xs transition-all',
              testResult.isHealthy
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
            )}
          >
            {testResult.isHealthy ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">{testResult.message}</span>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-2 text-center text-xs border border-border/40">
          <div>
            <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
              Discovered Tools
            </span>
            <span className="font-bold text-foreground font-mono text-sm">
              {toolsCount}
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
              Last Tested
            </span>
            <span className="font-medium text-foreground text-[11px] truncate flex items-center justify-center gap-1 mt-0.5">
              <Clock className="h-3 w-3 text-muted-foreground" />
              {connection.lastTestedAt ? formatDate(connection.lastTestedAt) : 'Never'}
            </span>
          </div>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="mt-5 flex items-center justify-between gap-1.5 border-t border-border/40 pt-3">
        <div className="flex items-center gap-1.5">
          {/* Test Health Button */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleTest}
            disabled={isTesting}
            className="h-8 px-2.5 text-xs gap-1 border-border/70 hover:bg-muted"
            title="Ping & Test Connection Health"
          >
            <Activity className={cn('h-3.5 w-3.5 text-primary', isTesting && 'animate-spin')} />
            <span>Test</span>
          </Button>

          {/* Sync / Discover Tools Button */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleDiscover}
            disabled={isSyncing}
            className="h-8 px-2.5 text-xs gap-1 border-border/70 hover:bg-muted"
            title="Discover MCP Tools and Resources"
          >
            <RefreshCw className={cn('h-3.5 w-3.5 text-muted-foreground', isSyncing && 'animate-spin')} />
            <span>Sync</span>
          </Button>

          {/* Inspect Tools Playground */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onInspectTools(connection)}
            className="h-8 px-2.5 text-xs gap-1 border-border/70 hover:bg-muted"
            title="Inspect & Execute Discovered Tools"
          >
            <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Tools</span>
          </Button>
        </div>

        {/* Delete Trigger & Confirmation Dropdown */}
        <div className="relative">
          <Button
            ref={buttonRef}
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsMenuOpen((prev) => !prev);
            }}
            disabled={isDeleting}
            aria-label={`Disconnect ${connection.name}`}
            aria-expanded={isMenuOpen}
            aria-haspopup="dialog"
            className={cn(
              'h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors',
              (isMenuOpen || isDeleting) && 'text-destructive bg-destructive/10'
            )}
            title="Disconnect integration"
          >
            {isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-destructive" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>

          {/* Confirmation Dropdown Menu */}
          {isMenuOpen && (
            <div
              ref={menuRef}
              role="dialog"
              aria-label="Confirm disconnection"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="absolute right-0 bottom-full mb-1.5 z-50 w-52 rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 duration-150"
            >
              <p className="text-xs font-semibold text-foreground">Disconnect?</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                Are you sure you want to disconnect <span className="font-medium text-foreground">{connection.name}</span>?
              </p>
              <div className="mt-2.5 flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsMenuOpen(false);
                  }}
                  disabled={isDeleting}
                  className="px-2 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors font-medium cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-destructive disabled:opacity-50"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Disconnecting...</span>
                    </>
                  ) : (
                    <span>Disconnect</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </SpotlightCard>
  );
};

export default ConnectionCard;
