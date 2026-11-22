import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Sparkles, X, RefreshCw } from 'lucide-react';
import { useDiscoverTools } from '../../hooks/useConnectors';

export const OAuthCallbackBanner: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isVisible, setIsVisible] = useState(false);

  const discoverMutation = useDiscoverTools();

  useEffect(() => {
    const connId = searchParams.get('connectionId');
    const status = searchParams.get('status');

    if (connId && status === 'success') {
      setIsVisible(true);

      // Auto-trigger tool discovery for the newly connected integration
      discoverMutation.mutate(connId);

      // Smoothly clean up the search params from the browser URL without full reload
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('connectionId');
      newParams.delete('status');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
        className="mb-6 relative overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-teal-500/10 p-4 shadow-sm backdrop-blur-md"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                Connection Authenticated Successfully!
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                {discoverMutation.isPending ? (
                  <span className="flex items-center gap-1.5 text-primary">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Synchronizing and discovering remote tools...
                  </span>
                ) : (
                  'Your credentials have been securely stored in the vault and tools are ready to use.'
                )}
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsVisible(false)}
            className="rounded-lg p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground transition-colors"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default OAuthCallbackBanner;
