import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { useConnectionTools, useExecuteTool } from '../../hooks/useConnectors';
import {
  Wrench,
  Play,
  Search,
  Code,
  CheckCircle2,
  AlertCircle,
  Clock,
  Terminal,
  Loader2,
  Copy,
  Check,
} from 'lucide-react';
import type { ConnectorConnection, ConnectorTool } from '../../types';
import { cn } from '../../utils/cn';

interface ToolExplorerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: ConnectorConnection | null;
}

export const ToolExplorerModal: React.FC<ToolExplorerModalProps> = ({
  open,
  onOpenChange,
  connection,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTool, setSelectedTool] = useState<ConnectorTool | null>(null);
  const [jsonParams, setJsonParams] = useState<string>('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<any | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const { data: tools = [], isLoading } = useConnectionTools(
    connection?.id || '',
    Boolean(connection?.id && open)
  );

  const executeMutation = useExecuteTool();

  // Filter tools by search keyword
  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return tools;
    const q = searchQuery.toLowerCase();
    return tools.filter(
      (t) =>
        t.displayName.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
    );
  }, [tools, searchQuery]);

  // Set default selected tool on first load
  React.useEffect(() => {
    if (filteredTools.length > 0 && (!selectedTool || !filteredTools.some((t) => t.id === selectedTool.id))) {
      handleSelectTool(filteredTools[0]);
    }
  }, [filteredTools]);

  const handleSelectTool = (tool: ConnectorTool) => {
    setSelectedTool(tool);
    setExecutionResult(null);

    // Generate sample JSON template based on schema properties
    const sample: Record<string, any> = {};
    const props = tool.inputSchema?.properties || {};
    Object.entries(props).forEach(([key, val]: [string, any]) => {
      if (val.default !== undefined) {
        sample[key] = val.default;
      } else if (val.type === 'string') {
        sample[key] = val.examples?.[0] || '';
      } else if (val.type === 'number' || val.type === 'integer') {
        sample[key] = 0;
      } else if (val.type === 'boolean') {
        sample[key] = false;
      } else if (val.type === 'array') {
        sample[key] = [];
      } else {
        sample[key] = {};
      }
    });

    setJsonParams(JSON.stringify(sample, null, 2));
  };

  const handleRunTool = async () => {
    if (!connection || !selectedTool) return;

    let parsed = {};
    try {
      parsed = JSON.parse(jsonParams);
      setJsonError(null);
    } catch {
      setJsonError('Invalid JSON in tool parameters. Please verify your parameter formatting.');
      return;
    }

    try {
      const res = await executeMutation.mutateAsync({
        connectionId: connection.id,
        toolName: selectedTool.name,
        parameters: parsed,
      });
      setExecutionResult(res);
    } catch (err: any) {
      setExecutionResult({
        success: false,
        error: err.message || 'Execution failed',
        durationMs: 0,
      });
    }
  };

  const handleCopyResult = () => {
    if (!executionResult) return;
    navigator.clipboard.writeText(JSON.stringify(executionResult, null, 2));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] h-[750px] flex flex-col p-0 overflow-hidden bg-card/95 backdrop-blur-md border-border/80 shadow-2xl">
        <DialogHeader className="p-5 pb-3 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Wrench className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-foreground">
                  Tool Explorer & Sandbox Playground
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Inspect schemas and execute tools for{' '}
                  <span className="font-semibold text-foreground">{connection?.name}</span>
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Modal Body: Split 2-pane layout */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left Pane: Searchable Tools List */}
          <div className="w-72 shrink-0 border-r border-border/60 flex flex-col bg-muted/20">
            {/* Search Input */}
            <div className="p-3 border-b border-border/40">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground z-10" />
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tools..."
                  className="pl-8 h-8 text-xs"
                />
              </div>
            </div>

            {/* Tool List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-xs">Loading discovered tools...</span>
                </div>
              ) : filteredTools.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground px-4">
                  No tools found matching your search.
                </div>
              ) : (
                filteredTools.map((tool) => {
                  const isSelected = selectedTool?.id === tool.id;
                  return (
                    <button
                      key={tool.id}
                      onClick={() => handleSelectTool(tool)}
                      className={cn(
                        'w-full text-left rounded-lg p-2.5 transition-all text-xs border outline-none',
                        isSelected
                          ? 'bg-background border-primary/40 shadow-xs text-foreground font-semibold'
                          : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-mono">{tool.displayName || tool.name}</span>
                        {tool.requiresApproval && (
                          <span className="shrink-0 rounded bg-amber-500/10 border border-amber-500/20 px-1 py-0.2 text-[9px] text-amber-500 font-mono">
                            approval
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground font-normal line-clamp-1 mt-0.5">
                        {tool.description}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Pane: Tool Details & Sandbox Execution Playground */}
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-5 scrollbar-thin">
            {selectedTool ? (
              <div className="space-y-5">
                {/* Tool Header */}
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-bold text-foreground font-mono">
                      {selectedTool.name}
                    </h3>
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground font-mono">
                      {selectedTool.displayName}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                    {selectedTool.description}
                  </p>
                </div>

                {/* Parameters Schema Inspection */}
                <div>
                  <h4 className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Code className="h-3.5 w-3.5 text-primary" />
                    Input Parameters Schema
                  </h4>
                  <div className="rounded-lg border border-border/60 bg-muted/30 overflow-hidden text-xs">
                    {selectedTool.inputSchema?.properties &&
                    Object.keys(selectedTool.inputSchema.properties).length > 0 ? (
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-border/60 bg-muted/60 text-[10px] text-muted-foreground uppercase font-mono">
                            <th className="p-2 pl-3">Parameter</th>
                            <th className="p-2">Type</th>
                            <th className="p-2">Required</th>
                            <th className="p-2 pr-3">Description</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40 font-mono text-[11px]">
                          {Object.entries(selectedTool.inputSchema.properties).map(
                            ([paramName, schema]: [string, any]) => {
                              const isRequired =
                                selectedTool.inputSchema?.required?.includes(paramName);
                              return (
                                <tr key={paramName} className="hover:bg-muted/40">
                                  <td className="p-2 pl-3 font-semibold text-foreground">
                                    {paramName}
                                  </td>
                                  <td className="p-2 text-primary">{schema.type || 'any'}</td>
                                  <td className="p-2">
                                    {isRequired ? (
                                      <span className="text-red-500 font-bold">Yes</span>
                                    ) : (
                                      <span className="text-muted-foreground">No</span>
                                    )}
                                  </td>
                                  <td className="p-2 pr-3 text-muted-foreground font-sans text-xs">
                                    {schema.description || '—'}
                                  </td>
                                </tr>
                              );
                            }
                          )}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-3 text-center text-xs text-muted-foreground">
                        This tool accepts no arguments (void).
                      </div>
                    )}
                  </div>
                </div>

                {/* Interactive Live Playground */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5 text-primary" />
                      Test Execution Arguments (JSON)
                    </h4>
                    <Button
                      size="sm"
                      onClick={handleRunTool}
                      disabled={executeMutation.isPending}
                      className="h-7 px-3 text-xs gap-1.5 font-semibold shadow-xs"
                    >
                      {executeMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5 fill-current" />
                      )}
                      <span>Run Tool</span>
                    </Button>
                  </div>

                  {jsonError && (
                    <Alert variant="destructive" className="mb-2 py-2 text-xs">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="text-xs">{jsonError}</AlertDescription>
                    </Alert>
                  )}

                  <Textarea
                    value={jsonParams}
                    onChange={(e) => {
                      setJsonParams(e.target.value);
                      if (jsonError) setJsonError(null);
                    }}
                    rows={5}
                    className="w-full font-mono text-xs placeholder:text-muted-foreground"
                    placeholder="{}"
                  />
                </div>

                {/* Execution Result Box */}
                {executionResult && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
                          Response
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.2 text-[10px] font-bold uppercase font-mono',
                            executionResult.success
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-red-500/10 text-red-600 dark:text-red-400'
                          )}
                        >
                          {executionResult.success ? (
                            <>
                              <CheckCircle2 className="h-3 w-3" /> SUCCESS
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-3 w-3" /> FAILED
                            </>
                          )}
                        </span>
                        {executionResult.durationMs !== undefined && (
                          <span className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {executionResult.durationMs}ms
                          </span>
                        )}
                      </div>

                      <button
                        onClick={handleCopyResult}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {isCopied ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-500" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" /> Copy JSON
                          </>
                        )}
                      </button>
                    </div>

                    <pre className="rounded-lg border border-border/80 bg-muted/40 p-3 text-xs font-mono text-foreground overflow-x-auto max-h-56 scrollbar-thin">
                      {JSON.stringify(executionResult, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-20">
                <Wrench className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <span className="text-xs">Select a tool from the list to inspect and test.</span>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ToolExplorerModal;
